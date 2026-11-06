import { createHash, randomUUID } from "node:crypto";
import { and, eq, sql, desc, inArray, or } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { db, entityRegistry as entities, entityCaptures as captures, entityEvidence as evidence,
  entityAssertions as assertions, entityDecisions as decisions, entityLegacy as legacy,
  entityCandidates as candidates, entityAutomation as automation, entityJobs as jobs,
  entityLineage as lineage, entityDevelopments as developments, entityObservations as observations } from "@workspace/db";
import { WORKSPACE_OWNER } from "./tripwire-access";
import { recordsFor } from "./tripwire-store";
import { POLICY_VERSION, DEFAULT_POLICY } from "./entity-policy";

export { entities, captures, evidence, assertions, decisions, legacy, candidates, automation, jobs, lineage, developments, observations };
export const W = WORKSPACE_OWNER;
export const uid = () => randomUUID();
export const key = (...parts: string[]) => createHash("sha256").update(JSON.stringify(parts)).digest("hex");
export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
export const scoped = (table: { workspace: AnyPgColumn }) => eq(table.workspace, W);
export async function settings(tx: Tx | typeof db = db, lock = false) {
  await tx.insert(automation).values({ workspace: W, policy: DEFAULT_POLICY }).onConflictDoNothing();
  const query = tx.select().from(automation).where(eq(automation.workspace, W));
  const [row] = lock ? await query.for("update") : await query;
  return row!;
}
export async function requireEntity(id: string, tx: Tx | typeof db = db, lock = false) {
  const query = tx.select().from(entities).where(and(scoped(entities), eq(entities.id, id)));
  const [row] = lock ? await query.for("update") : await query;
  if (!row) throw new Error("Entity not found in this workspace");
  return row;
}
export async function logDecision(tx: Tx, entityId: string, origin: string, action: string, rationale: string,
  previous: Record<string, unknown>, result: Record<string, unknown>, evidenceIds: string[] = [], factors: Record<string, number> = {}, version = POLICY_VERSION) {
  await tx.insert(decisions).values({ id: uid(), workspace: W, entityId, origin, action, rationale,
    previous, result, evidenceIds, dimensions: factors, policyVersion: version });
}

// Non-destructive migration: no guessed identity merges, no invented tenures.
// Each legacy watch owns a deterministic mapping; equal display names stay distinct.
export async function migrateWatches() {
  const watches = (await recordsFor(W, false)).filter(r => r.kind === "watch" && !["journalist", "attribution", "x-account"].includes(r.watchType ?? ""));
  await db.transaction(async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('tripwire-legacy-entities'))`);
    for (const w of watches) {
      const id = key(W, "legacy", w.id);
      const [mapped] = await tx.select().from(legacy).where(eq(legacy.id, id));
      if (mapped) continue; // Do not overwrite analyst corrections on restart.
      const type = w.watchType === "organization" ? "organization" : ["position", "person"].includes(w.watchType ?? "") ? "position" : "issue";
      const classification = ["organization", "position"].includes(type) ? "structural" : "contextual";
      const name = (type === "position" ? w.position || w.title : w.title).slice(0, 200);
      const rationale = `Legacy analyst-supplied monitoring context; not source-verified. ${w.summary ?? "Review evidence before activation."}`.slice(0, 2000);
      await tx.insert(entities).values({ id, workspace: W, name, type, classification,
        state: w.enabled === false ? "Archived" : "Watch", priority: w.tier ?? 3, rationale,
        aliases: w.aliases ?? [], pinned: true }).onConflictDoNothing();
      await tx.insert(legacy).values({ id, workspace: W, watchId: w.id, entityId: id, original: w });
      await logDecision(tx, id, "legacy-context", "migrate", rationale, {}, { state: w.enabled === false ? "Archived" : "Watch", legacyIndividual: w.individual ?? null, organization: w.organization ?? null });
      if (w.individual?.trim()) {
        const personId = key(W, "legacy-holder", w.id);
        await tx.insert(entities).values({ id: personId, workspace: W, name: w.individual.slice(0, 200), type: "person",
          rationale: "Legacy named holder; identity, occupancy and effective dates are unresolved. Not an enduring anchor.", state: "Discovered" }).onConflictDoNothing();
        await tx.insert(candidates).values({ id: key(personId, "legacy-role"), workspace: W, entityId: personId, matchId: id,
          reason: "Legacy role context only. Supply appointment evidence before creating an occupies assertion." }).onConflictDoNothing();
      }
    }
    // Link only uniquely named organizations from explicit legacy organization watches.
    for (const w of watches.filter(w => w.organization)) {
      const parents = watches.filter(p => p.watchType === "organization" && p.title === w.organization && p.id !== w.id);
      if (parents.length !== 1) continue;
      const id = key(W, "legacy", w.id);
      await tx.update(entities).set({ organizationId: key(W, "legacy", parents[0]!.id) }).where(and(eq(entities.id, id), sql`${entities.organizationId} is null`));
    }
  });
}
export async function syncCaptures() {
  const config = await settings();
  const allArticles = (await recordsFor(W, false)).filter(r => r.kind === "article").sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const after = allArticles.filter(a => !config.captureCursor || a.id > config.captureCursor);
  const articles = (after.length ? after : allArticles).slice(0, 100);
  // Up to 250 references per tick, resumable through unique IDs. Never enqueue full graphs.
  let added = 0;
  for (const article of articles) {
    const sources = [...article.retainedContent ?? []];
    if (article.fullTextHash && !sources.some(c => c.bodyHash === article.fullTextHash)) sources.push({
      id: `canonical:${article.fullTextHash}`, bodyHash: article.fullTextHash, source: "legacy-canonical-context",
      capturedAt: article.createdAt, sourceUrl: article.url,
    });
    for (const c of sources.slice(0, 100)) {
      if (!c.bodyHash || !c.capturedAt || Number.isNaN(Date.parse(c.capturedAt))) continue;
      const id = key(W, article.id, c.id, c.bodyHash);
      const [existing] = await db.select({ id: captures.id }).from(captures).where(eq(captures.id, id));
      if (existing) continue;
      const privateMaterial = !/^(rss[: ]|publisher|url$|page)/i.test(c.source);
      const authorized = !privateMaterial || config.privateMaterial;
      await db.insert(captures).values({ id, workspace: W, articleId: article.id, captureId: c.id, hash: c.bodyHash,
        source: c.source, url: c.sourceUrl ?? article.url, publishedAt: article.publishedAt ? new Date(article.publishedAt) : null,
        capturedAt: new Date(c.capturedAt), complete: article.fullTextComplete === true && article.fullTextHash === c.bodyHash,
        authorized, byline: article.byline, publisher: article.outlet }).onConflictDoNothing();
      added++;
    }
  }
  await db.update(automation).set({ captureCursor: articles.at(-1)?.id ?? null }).where(eq(automation.workspace, W));
  return added;
}
export async function profile(id: string, offset = 0) {
  const entity = await requireEntity(id);
  const links = await db.select().from(assertions).where(and(scoped(assertions), or(eq(assertions.subjectId, id), eq(assertions.objectId, id)))).orderBy(desc(assertions.recordedAt), assertions.id).limit(101).offset(offset);
  const history = await db.select().from(decisions).where(and(scoped(decisions), eq(decisions.entityId, id))).orderBy(desc(decisions.createdAt), decisions.id).limit(101).offset(offset);
  const pending = await db.select().from(candidates).where(and(scoped(candidates), eq(candidates.entityId, id))).orderBy(candidates.id).limit(101).offset(offset);
  const evidenceIds = [...new Set([...links.slice(0, 100).map(a => a.evidenceId), ...history.slice(0, 100).flatMap(d => d.evidenceIds), ...pending.flatMap(c => c.evidenceId ? [c.evidenceId] : [])])].slice(0, 200);
  const names = [...new Set(links.flatMap(a => [a.subjectId, a.objectId]).filter((s): s is string => !!s))];
  const nameRows = names.length ? await db.select({ id: entities.id, name: entities.name }).from(entities).where(and(scoped(entities), inArray(entities.id, names))) : [];
  const map = new Map(nameRows.map(n => [n.id, n.name]));
  return { entity, assertions: links.slice(0, 100).map(a => ({ ...a, subjectName: map.get(a.subjectId), objectName: a.objectId ? map.get(a.objectId) : null })),
    decisions: history.slice(0, 100), candidates: pending.slice(0,100), evidence: await evidenceRows(evidenceIds),
    historyTruncated: links.length > 100 || history.length > 100 || pending.length > 100 };
}
export async function evidenceRows(ids: string[], tx: Tx | typeof db = db) {
  if (!ids.length) return [];
  const rows = await tx.select({ evidence, capture: captures }).from(evidence)
    .innerJoin(captures, and(eq(evidence.captureId, captures.id), eq(evidence.workspace, captures.workspace)))
    .where(and(scoped(evidence), inArray(evidence.id, ids)));
  const origins = await tx.select().from(lineage).where(and(scoped(lineage), inArray(lineage.evidenceId, ids)));
  return rows.map(r => ({ ...r.evidence, capture: r.capture, lineage: origins.find(o => o.evidenceId === r.evidence.id) }));
}
