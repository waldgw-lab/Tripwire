/**
 * Explicit offline development harness. Importing this file starts no API,
 * collector, provider, interactive draft or automation job.
 */
import { readFile, writeFile } from "node:fs/promises";
import { pool, type PoolClient } from "@workspace/db";
import { corpusPlan, splitIds, masterSheets, type Inventory, type CorpusArticle } from "./source-search-corpus";
import { exactPassage, nonnegativeInteger, sourceKey, sourceUrl, titleKey } from "./source-search-rules";
import { captureContent, mergeArticleContent } from "./tripwire-content";
import { archiveArticle } from "./tripwire-content-storage";
import { parseByline } from "./tripwire-bylines";
import { classifyContent } from "./tripwire-classification";
import { WORKSPACE_OWNER as W } from "./tripwire-access";
import { publicationUpdate } from "./tripwire-publication";
import type { RecordData } from "./tripwire-store";

type Row = Record<string, any>;
const allowedTables = new Set(["tripwire_records", "tripwire_entity_captures", "tripwire_entity_evidence",
  "tripwire_claim_families", "tripwire_source_occurrences", "tripwire_attributed_claims", "tripwire_claim_sources", "tripwire_source_matches"]);
export class BatchWriter {
  sequence = 0;
  constructor(public client: PoolClient, public batch: string) {}
  async put(table: string, keys: Row, values: Row) {
    if (!allowedTables.has(table)) throw new Error("Unsupported journal table");
    const where = Object.keys(keys).map((k, i) => `"${k}"=$${i + 1}`).join(" AND ");
    const prior = (await this.client.query(`select * from ${table} where ${where} for update`, Object.values(keys))).rows[0] ?? null;
    const data = { ...keys, ...values };
    if (prior) {
      if (Object.entries(data).every(([k, v]) => JSON.stringify(prior[k]) === JSON.stringify(v))) return prior;
      // Only article JSON is enrichable. Immutable analytical records never overwritten.
      if (table !== "tripwire_records") throw new Error("Immutable batch identity collision");
      await this.client.query(`update ${table} set data=$1,updated_at=now() where ${where.replace(/\$(\d+)/g, (_, n) => `$${Number(n) + 1}`)}`, [values.data, ...Object.values(keys)]);
    } else {
      const columns = Object.keys(data);
      await this.client.query(`insert into ${table} (${columns.map(c => `"${c}"`).join(",")}) values (${columns.map((_, i) => `$${i + 1}`).join(",")})`,
        Object.values(data).map(v => v !== null && typeof v === "object" && !(v instanceof Date) ? JSON.stringify(v) : v));
    }
    const after = (await this.client.query(`select * from ${table} where ${where}`, Object.values(keys))).rows[0];
    await this.client.query("insert into tripwire_source_changes(batch_id,sequence,table_name,row_key,before_image,after_image) values($1,$2,$3,$4,$5,$6)",
      [this.batch, ++this.sequence, table, keys, prior, after]);
    return after;
  }
}

export async function rollbackBatch(client: PoolClient, batch: string, commit = false) {
  await client.query("BEGIN");
  try {
    await client.query("select pg_advisory_xact_lock(hashtext($1))", [`articles:${W}`]);
    // Bounded offline import: prevent public inserts racing the exact-URL snapshot.
    await client.query("lock table tripwire_records in share row exclusive mode");
    const current = (await client.query("select * from tripwire_source_batches where id=$1 for update", [batch])).rows[0];
    if (!current || current.status !== "applied") throw new Error("No applied batch found");
    const changes = (await client.query("select * from tripwire_source_changes where batch_id=$1 order by sequence desc", [batch])).rows;
    for (const ch of changes) {
      if (!allowedTables.has(ch.table_name)) throw new Error("Unsupported rollback table");
      const keys = ch.row_key;
      const where = Object.keys(keys).map((k, i) => `"${k}"=$${i + 1}`).join(" AND ");
      const row = (await client.query(`select * from ${ch.table_name} where ${where} for update`, Object.values(keys))).rows[0];
      if (JSON.stringify(sorted(row)) !== JSON.stringify(sorted(ch.after_image))) throw new Error(`Rollback blocked by subsequent edit: ${ch.table_name}`);
      if (ch.table_name === "tripwire_records") {
        const baseId = row.data.baseId ?? row.id;
        // Legacy and evidence references use JSON/text IDs rather than article foreign keys.
        const dependencies = await client.query(`select 1 from tripwire_records where kind='claim' and id not in
          (select after_image->>'id' from tripwire_source_changes where batch_id=$1 and table_name='tripwire_records')
          and data::text like $2 union all select 1 from tripwire_entity_captures where article_id=$3
          and id not in(select after_image->>'id' from tripwire_source_changes where batch_id=$1 and table_name='tripwire_entity_captures') limit 1`,
          [batch, `%${baseId}%`, baseId]);
        const publicBase = (await client.query("select 1 from tripwire_records where owner='public' and id=$1 and id<>$2", [baseId, row.id])).rowCount;
        if (!ch.before_image && !publicBase && dependencies.rowCount) throw new Error("Rollback blocked by subsequent article references");
      }
      if (ch.before_image) {
        const cols = Object.keys(ch.before_image).filter(k => !Object.hasOwn(keys, k));
        await client.query(`update ${ch.table_name} set ${cols.map((k, i) => `"${k}"=$${Object.keys(keys).length + i + 1}`).join(",")} where ${where}`,
          [...Object.values(keys), ...cols.map(k => { const v = ch.before_image[k]; return v && typeof v === "object" ? JSON.stringify(v) : v; })]);
      } else await client.query(`delete from ${ch.table_name} where ${where}`, Object.values(keys));
    }
    await client.query("update tripwire_source_batches set status='rolled-back' where id=$1", [batch]);
    await client.query(commit ? "COMMIT" : "ROLLBACK");
    return { batch, changes: changes.length, committed: commit };
  } catch (error) { await client.query("ROLLBACK"); throw error; }
}
const sorted = (v: any): any => v instanceof Date ? v.toISOString() : Array.isArray(v) ? v.map(sorted) : v && typeof v === "object" ?
  Object.fromEntries(Object.keys(v).sort().map(k => [k, sorted(v[k])])) : v;

export async function runBackfill(input: Inventory, apply = false) {
  if (process.env.NODE_ENV === "production") throw new Error("Development backfill is forbidden in production");
  const plan = corpusPlan(input), batch = `source-search-${plan.hash.slice(0, 20)}`;
  const client = await pool.connect();
  const report: Row = { batch, inputHash: plan.hash, mode: apply ? "apply" : "dry-run", articleInputs: plan.dispositions,
    segments: plan.segments.map(({ raw, text, ...s }) => ({ ...s, rawHash: sourceKey(raw), characters: text.length })),
    tables: Object.fromEntries(Object.entries(input.sheets).map(([n, s]) => [n, s.rows.length])),
    created: 0, enriched: 0, unchanged: 0, quarantined: [], rows: [], content: [], conflicts: [], legacyClaimsPreserved: 0 };
  try {
    await client.query("BEGIN");
    await client.query("select pg_advisory_xact_lock(hashtext('tripwire-source-backfill'))");
    // Same lock as interactive edits; row locks also protect against public collector updates.
    await client.query("select pg_advisory_xact_lock(hashtext($1))", [`articles:${W}`]);
    const prior = (await client.query("select * from tripwire_source_batches where input_hash=$1", [plan.hash])).rows[0];
    if (prior) {
      if (prior.status !== "applied") throw new Error("This batch was rolled back; review before creating a new input version");
      await client.query("ROLLBACK");
      return { ...prior.report, mode: "no-op", alreadyApplied: true };
    }
    const original = (await client.query("select * from tripwire_records where owner in ('public',$1) and kind in ('article','claim') for update", [W])).rows;
    report.before = { articles: original.filter(r => r.kind === "article").length, claims: original.filter(r => r.kind === "claim").length };
    report.legacyClaimsPreserved = report.before.claims;
    const automationBefore = (await client.query("select * from tripwire_entity_automation where workspace=$1", [W])).rows;
    await client.query("insert into tripwire_source_batches(id,input_hash,status,manifest,report) values($1,$2,'applied',$3,$4)", [batch, plan.hash, JSON.stringify(input.manifest), report]);
    const writer = new BatchWriter(client, batch);
    const put = (table: string, keys: Row, values: Row) => writer.put(table, keys, values);
    const inputRows = new Map<string, Row>();
    const retain = async (sheet: string, row: string | number, data: unknown, resolution: Row) => {
      inputRows.set(`${sheet}:${row}`, resolution);
      await client.query("insert into tripwire_source_inputs(batch_id,sheet,row_key,hash,data,resolution) values($1,$2,$3,$4,$5,$6) on conflict(batch_id,sheet,row_key) do update set resolution=excluded.resolution",
        [batch, sheet, String(row), sourceKey(data), JSON.stringify(data), resolution]);
    };
    for (const [sheet, s] of Object.entries(input.sheets)) for (const r of s.rows) await retain(sheet, r.row, r.data, { status: "retained-context", supplied: true });
    for (const [file, paragraphs] of Object.entries(input.documents)) await retain(file, "document", { paragraphs }, { status: "retained-user-supplied-document" });
    const docs = new Map<string, string>();
    const articleMap = new Map<string, { id: string; data: Row; capture?: Row; text?: string }>();
    const importCredits = (a: CorpusArticle) => {
      const ids = a.rows.map(r => r.data["Document ID"]?.replace(/^"|"$/g, ""));
      const rows = input.sheets["Document Journalists"]?.rows.filter(r => ids.includes(r.data["Document ID"])) ?? [];
      const mapped = rows.flatMap(({ data: d }) => {
        const type = d["Contribution Type"];
        const role = type === "Editor" ? "editing" : ["Engineer", "Music", "Producer"].includes(type ?? "") ? "other" :
          d["Contributor Flag"] === "Yes" || type === "Contributed reporting" ? "reporting" :
          ["Byline", "Opinion Column", "Featured reporter", "Host"].includes(type ?? "") ? "author" : "other";
        return d["Journalist Name"] ? [{ name: d["Journalist Name"], role, attribution: d["Contribution Detail"] || `Supplied ${type}` }] : [];
      });
      if (mapped.length) return mapped;
      const byline = a.segments.find(s => s.byline)?.byline ?? a.rows[0]?.data["Author Name"];
      return byline ? parseByline(byline) : [];
    };
    for (const disposition of plan.dispositions.filter(d => d.status === "quarantined")) {
      const row = input.sheets[disposition.sheet]!.rows.find(r => r.row === disposition.row)!;
      await retain(disposition.sheet, disposition.row, row.data, disposition);
    }
    for (const a of plan.articles) {
      const matches = original.filter(r => r.kind === "article" && sourceUrl(String(r.data.url ?? "")) === a.url);
      const baseIds = new Set(matches.map(r => r.data.baseId ?? r.id));
      const chosen = matches.find(r => r.owner === W) ?? matches[0];
      if (baseIds.size > 1 || chosen?.data.hidden || chosen && chosen.data.outlet && chosen.data.outlet !== a.outlet) {
        report.quarantined.push({ url: a.url, reason: baseIds.size > 1 ? "Multiple existing identities" : "Dismissed or outlet mismatch" }); continue;
      }
      const id = chosen?.data.baseId ?? chosen?.id ?? sourceKey("article", a.url);
      const rowId = chosen?.owner === W ? chosen.id : `${W}:${id}`;
      const credits = importCredits(a);
      const segment = [...a.segments].sort((a, b) => Number(b.complete) - Number(a.complete) || b.text.length - a.text.length)[0];
      const publicRow = matches.find(r => r.owner === "public");
      const existing = chosen ? { ...chosen.data,
        ...(publicRow && publicRow !== chosen ? { ...mergeArticleContent(chosen.data, publicRow.data), ...publicationUpdate(chosen.data, publicRow.data) } : {}) } : {};
      const sourceMeta = { batchId: batch, supplied: true, documentIds: [...new Set(a.rows.map(r => r.data["Document ID"]).filter(Boolean))],
        date: a.rows[0]?.data.Date || null, time: a.rows[0]?.data.Time || null,
        minimumAnonymousHumans: nonnegativeInteger(a.rows[0]?.data["Minimum Unique Unnamed Human Sources"]),
        provisionalSourceRecords: nonnegativeInteger(a.rows[0]?.data["Provisional Unnamed Source Records"]),
        conflicts: a.conflicts, contentOrigin: segment ? "user-supplied-archive" : "supplied-metadata" };
      const incoming: RecordData = { kind: "article", title: a.title, url: a.url, outlet: a.outlet,
        credits: credits as RecordData["credits"], byline: credits.filter(c => c.role === "author").map(c => c.name).join(", ") || undefined,
        journalists: credits.filter(c => c.role === "author").map(c => c.name),
        reportingType: "unassessed", sentiment: "unassessed", sourceType: "article",
        ...classifyContent({ url: a.url, title: a.title }),
        ...(segment ? { fullText: segment.text, fullTextComplete: segment.complete,
          retainedContent: [captureContent(segment.text, "source-search:user-supplied-archive", { raw: segment.raw, sourceUrl: a.url, fileName: segment.file })],
          contentNormalization: { method: "source-search:bounded-archive", sourceCharacters: segment.raw.length, articleCharacters: segment.text.length } } : {}) };
      // No workbook sentiment, access or framing judgments become current article facts.
      let data: Row = { ...incoming, ...existing, ...mergeArticleContent(existing, incoming), baseId: id, sourceSearch: sourceMeta };
      if (!existing.credits?.length && credits.length) { data.credits = incoming.credits; data.byline = incoming.byline; data.journalists = incoming.journalists; }
      if (segment?.complete && !existing.publishedAt) {
        const match = segment.raw.match(/August (10|12), 2026 at (\d+):(\d+) (a|p)\.m\. EDT/);
        if (match) data = { ...data, publishedAt: `2026-08-${match[1]}T${String(Number(match[2]) % 12 + (match[4] === "p" ? 12 : 0)).padStart(2, "0")}:${match[3]}:00-04:00`, publicationSource: "manual" };
      }
      // Dry runs do not create durable content; apply uses the existing archive/assessment service.
      if (apply) data = await archiveArticle(data as RecordData);
      const saved = await put("tripwire_records", { id: rowId }, { owner: W, kind: "article", data });
      if (!chosen) report.created++; else if (segment || !existing.sourceSearch) report.enriched++; else report.unchanged++;
      let capture: Row | undefined;
      if (segment && apply) {
        const cap = data.retainedContent.find((c: Row) => c.fileName === segment.file && c.source.startsWith("source-search:"));
        if (!cap?.bodyHash) throw new Error("Archive capture was not retained");
        capture = await put("tripwire_entity_captures", { workspace: W, id: sourceKey(W, id, cap.id, cap.bodyHash) }, {
          article_id: id, capture_id: cap.id, hash: cap.bodyHash, source: cap.source, url: a.url,
          published_at: data.publishedAt ?? null, captured_at: cap.capturedAt, complete: segment.complete,
          authorized: false, byline: data.byline ?? null, publisher: a.outlet });
        report.content.push({ articleId: id, hash: cap.bodyHash, rawCharacters: segment.raw.length, characters: segment.text.length, complete: segment.complete });
      }
      articleMap.set(a.url, { id, data: saved.data, capture, text: segment?.text });
      for (const r of a.rows) {
        const ext = r.data["Document ID"]?.replace(/^"|"$/g, "");
        if (ext && !plan.ambiguousExternalIds.includes(ext)) docs.set(ext, a.url);
        await retain(r.sheet, r.row, r.data, { status: "article-linked", articleId: id, duplicate: r !== a.rows[0], conflicts: a.conflicts });
      }
      report.conflicts.push(...a.conflicts.map(c => ({ url: a.url, reason: c })));
    }
    // Make archive-only publishers visible in the existing News Media hierarchy.
    // No feed endpoint or enabled polling is introduced.
    const outletRows = (await client.query("select data from tripwire_records where kind='outlet' and owner in ('public',$1)", [W])).rows;
    for (const outlet of new Set(plan.articles.filter(a => articleMap.has(a.url)).map(a => a.outlet))) {
      if (outletRows.some(r => r.data.title === outlet)) continue;
      const id = sourceKey(W, "archive-outlet", outlet);
      await put("tripwire_records", { id: `${W}:${id}` }, { owner: W, kind: "outlet", data: {
        kind: "outlet", title: outlet, baseId: id, enabled: false, feedStatus: "Manual archive coverage", feedUrl: "" } });
    }
    const articleFor = (d: Row) => articleMap.get(docs.get(String(d["Document ID"] ?? "").replace(/^"|"$/g, "")) ?? "");
    for (const [sheet, s] of Object.entries(input.sheets)) {
      if (masterSheets.includes(sheet)) continue;
      for (const r of s.rows) {
        const article = articleFor(r.data);
        if (article) await retain(sheet, r.row, r.data, { status: "supplied-context", articleId: article.id });
      }
    }
    const excerptRef = async (article: ReturnType<typeof articleFor>, excerpt: string, attribution: string) => {
      const passage = article?.text ? exactPassage(article.text, excerpt) : null;
      if (!apply || !passage || !article?.capture) return null;
      const id = sourceKey(batch, article.capture.id, passage, attribution);
      await put("tripwire_entity_evidence", { workspace: W, id }, { capture_id: article.capture.id, excerpt: passage.excerpt,
        start: passage.start, end: passage.end, attribution, certainty: "attributed", scope: "Supplied analysis; exact excerpt validated, assertion not verified",
        extractor_version: "source-search-exact-v1", policy_version: "supplied-unreviewed" });
      return id;
    };
    const sourceIds = new Map<string, string[]>();
    for (const r of input.sheets.Sources?.rows ?? []) {
      const d = r.data, article = articleFor(d), id = sourceKey(batch, "Sources", r.row);
      if (!article) { await retain("Sources", r.row, d, { status: "unresolved-document" }); continue; }
      const evidence = await excerptRef(article, d["Exact Source Descriptor"] ?? "", d["Exact Source Descriptor"] ?? "");
      await put("tripwire_source_occurrences", { workspace: W, id }, { article_id: article.id, capture_id: article.capture?.id ?? null, evidence_id: evidence,
        descriptor: d["Exact Source Descriptor"] || d["Source Name"] || "Descriptor not supplied",
        source_type: d["Source Type"] || "Unknown", anonymity: d["Named/Unnamed"] || "Unknown",
        minimum_humans: null, supplied: true, external_id: d["Source ID"] ?? null,
        family_hypothesis: d["Source Family ID"] || null, data: d, batch_id: batch });
      const key = `${article.id}:${d["Source ID"]}`;
      sourceIds.set(key, [...sourceIds.get(key) ?? [], id]);
      await retain("Sources", r.row, d, { status: "source-occurrence", id, articleId: article.id, evidenceId: evidence, excerptValidated: !!evidence });
    }
    const families = new Map<string, string>();
    for (const r of input.sheets.Claims?.rows ?? []) {
      const d = r.data, article = articleFor(d), id = sourceKey(batch, "Claims", r.row);
      if (!article || !d["Normalized Claim"]?.trim()) { await retain("Claims", r.row, d, { status: "unresolved-document-or-proposition" }); continue; }
      // Package families are retained hypotheses. No semantic auto-merging with legacy claims.
      const ext = d["Claim Family ID"] || `unclassified:${d["Claim ID"]}`;
      const family = sourceKey(batch, "family", ext);
      if (!families.has(family)) {
        const candidates = original.filter(r => r.kind === "claim" && !r.data.hidden &&
          titleKey(String(r.data.title ?? "")) === titleKey(d["Normalized Claim"]!) &&
          ![...families.values()].includes(r.data.baseId ?? r.id));
        const legacyIds = [...new Set(candidates.map(c => c.data.baseId ?? c.id))];
        const legacyId = legacyIds.length === 1 ? legacyIds[0] : sourceKey("source-search-claim", family);
        if (legacyIds.length !== 1) {
          await put("tripwire_records", { id: `${W}:${legacyId}` }, { owner: W, kind: "claim", data: {
            baseId: legacyId, kind: "claim", title: d["Normalized Claim"], summary: "Supplied analysis · unreviewed claim-family grouping", observations: [] } });
        } else {
          report.reconciledLegacyClaims ??= [];
          report.reconciledLegacyClaims.push({ claimId: legacyId, familyId: family, rule: "Unique exact proposition wording; original history untouched" });
        }
        await put("tripwire_claim_families", { workspace: W, id: family }, { claim_id: legacyId, proposition: d["Normalized Claim"],
          event_id: d["Event Group ID"] || null, supplied: true, external_id: ext, batch_id: batch });
        families.set(family, legacyId);
      }
      // A normalized proposition is not an exact publisher passage.
      await put("tripwire_attributed_claims", { workspace: W, id }, { family_id: family, article_id: article.id, proposition: d["Normalized Claim"],
        supplied: true, external_id: d["Claim ID"] || null, data: d, batch_id: batch });
      const unresolved = [];
      for (const source of splitIds(d["Source ID"])) {
        const refs = sourceIds.get(`${article.id}:${source}`) ?? [];
        if (refs.length !== 1) { unresolved.push(source); continue; }
        await put("tripwire_claim_sources", { workspace: W, claim_id: id, source_id: refs[0], article_id: article.id }, { batch_id: batch });
      }
      await retain("Claims", r.row, d, { status: "attributed-claim", id, articleId: article.id, unresolvedSources: unresolved });
    }
    for (const sheet of ["Source_Quotes", "Institutional_Responses", "Reporting_Evidence"]) for (const r of input.sheets[sheet]?.rows ?? []) {
      const article = articleFor(r.data);
      const evidence = sheet === "Source_Quotes" ? await excerptRef(article, r.data["Exact Text"] ?? "", r.data["Source ID"] ?? "") : null;
      await retain(sheet, r.row, r.data, { status: article ? "supplied-analysis" : "unresolved-document", articleId: article?.id ?? null,
        evidenceId: evidence, excerptValidated: !!evidence, relatedSourceIds: splitIds(r.data["Source ID"]).flatMap(s => article ? sourceIds.get(`${article.id}:${s}`) ?? [] : []) });
    }
    for (const r of input.sheets.Source_Matches?.rows ?? []) {
      const d = r.data, a = articleFor(d), b = articleFor({ "Document ID": d["Related Document ID"] });
      const as = a ? sourceIds.get(`${a.id}:${d["Source ID A"]}`) ?? [] : [], bs = b ? sourceIds.get(`${b.id}:${d["Source ID B"]}`) ?? [] : [];
      if (as.length !== 1 || bs.length !== 1 || as[0] === bs[0]) { await retain("Source_Matches", r.row, d, { status: "unresolved-occurrence-join" }); continue; }
      const id = sourceKey(batch, "match", r.row);
      await put("tripwire_source_matches", { workspace: W, id }, { source_a: as[0], source_b: bs[0], hypothesis: d["Relationship Assessment"] || "Unknown",
        rationale: d.Commonalities || "No supporting rationale supplied", conflicts: d["Conflicts / Reasons Not To Merge"] || "Not supplied",
        supplied: true, external_id: d["Match ID"], batch_id: batch });
      await retain("Source_Matches", r.row, d, { status: "supplied-match-hypothesis", id });
    }
    report.rows = [...inputRows].map(([key, resolution]) => ({ key, ...resolution }));
    report.journaledChanges = writer.sequence;
    report.inputQuarantined = plan.dispositions.filter(r => r.status === "quarantined").length;
    report.duplicateRows = plan.dispositions.filter(r => r.status === "duplicate-url").length;
    report.unresolvedJoins = report.rows.filter((r: Row) => String(r.status).startsWith("unresolved")).length;
    report.inputRowCount = Object.values(input.sheets).reduce((sum, s) => sum + s.rows.length, 0);
    report.retainedDocumentCount = Object.keys(input.documents).length;
    report.validatedExcerptRows = report.rows.filter((r: Row) => r.excerptValidated).length;
    report.after = (await client.query(`select count(*) filter(where kind='article')::int articles,count(*) filter(where kind='claim')::int claims
      from tripwire_records where owner in ('public',$1) and kind in ('article','claim')`, [W])).rows[0];
    report.claimFamilies = families.size;
    report.monitoringAuthorizationUnchanged = JSON.stringify(automationBefore) === JSON.stringify((await client.query("select * from tripwire_entity_automation where workspace=$1", [W])).rows);
    if (!report.monitoringAuthorizationUnchanged) throw new Error("Monitoring configuration changed during backfill");
    await client.query("update tripwire_source_batches set report=$1 where id=$2", [report, batch]);
    await client.query(apply ? "COMMIT" : "ROLLBACK");
    return report;
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}

export async function backfillMain(args: string[]) {
  if (process.env.NODE_ENV === "production" || !args.includes("--development-only")) throw new Error("Explicit --development-only confirmation required");
  try {
    if (args.includes("--rollback") || args.includes("--rollback-check")) {
      const i = args.findIndex(a => a === "--rollback" || a === "--rollback-check");
      const client = await pool.connect();
      try { process.stdout.write(JSON.stringify(await rollbackBatch(client, args[i + 1]!, args.includes("--rollback")), null, 2) + "\n"); }
      finally { client.release(); }
    } else {
      const input = JSON.parse(await readFile("generated-artifacts/source-search/inventory.json", "utf8"));
      const report = await runBackfill(input, args.includes("--apply"));
      await writeFile(`generated-artifacts/source-search/${report.mode}-report.json`, JSON.stringify(report, null, 2));
      process.stdout.write(JSON.stringify({ batch: report.batch, mode: report.mode, before: report.before, after: report.after,
        created: report.created, enriched: report.enriched, quarantined: report.quarantined.length, content: report.content.length, claimFamilies: report.claimFamilies }, null, 2) + "\n");
    }
  } finally { await pool.end(); }
}
