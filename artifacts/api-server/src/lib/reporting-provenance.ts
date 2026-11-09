import { pool, type PoolClient } from "@workspace/db";
import { ConnectReportingPassageBody, ReviewReportingLineageBody } from "@workspace/api-zod";
import { WORKSPACE_OWNER as W } from "./tripwire-access";
import { grammaticalMinimum, conservativeMinimum, sourceKey, suppliedDate } from "./source-search-rules";
import { evidenceVersion, claimEvidenceScope, type EvidenceScope } from "./reporting-versions";
import { currentLinkJoin, effectiveClaimSql } from "./claim-corrections";
import type { ClaimLinkCorrection } from "@workspace/api-zod";

type Row = Record<string, any>;
function byField(rows: Row[], field: string) {
  const index = new Map<string, Row[]>();
  for (const row of rows) {
    const key = row[field];
    if (typeof key !== "string") continue;
    const group = index.get(key) ?? [];
    group.push(row);
    index.set(key, group);
  }
  return index;
}
const latestSql = `select r.* from tripwire_provenance_reviews r where r.workspace=$1
 and not exists(select 1 from tripwire_provenance_reviews n where n.workspace=r.workspace and n.supersedes_id=r.id)`;
const review = (r: Row) => ({ id: r.id, relation: r.relation, rationale: r.rationale, createdAt: r.created_at.toISOString(),
  associationCorrectionId: r.association_correction_id ?? null,
  evidenceId: r.evidence_id, pathKey: r.path_key, targetClaimId: r.target_claim_id, supersedesId: r.supersedes_id });
export class ProvenanceError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export async function reportingProvenance(q: { articleId?: string; claimId?: string; evidenceId?: string; eventId?: string; offset?: number; evidenceScope?: "all" | EvidenceScope }) {
  const params: unknown[] = [W];
  const add = (value: string) => { params.push(value); return `$${params.length}`; };
  const filters = [];
  if (q.articleId) filters.push(`c.article_id=${add(q.articleId)}`);
  if (q.claimId) { const p = add(q.claimId); filters.push(`(${effectiveClaimSql}=${p} or f.claim_id=${p}
    or c.id in(select h.data->>'observationId' from tripwire_records h
      where h.owner=$1 and h.kind='claim-link-correction' and h.data->>'targetClaimId'=${p}))`); }
  if (q.eventId) filters.push(`(f.event_id=${add(q.eventId)} or f.entity_event_id=$${params.length})`);
  if (q.evidenceId) {
    const p = add(q.evidenceId);
    filters.push(`(c.evidence_id=${p} or exists(select 1 from tripwire_claim_capture_links v where v.workspace=c.workspace and v.claim_id=c.id and v.evidence_id=${p})
     or exists(select 1 from tripwire_provenance_reviews r where r.workspace=c.workspace and r.claim_id=c.id and r.evidence_id=${p})
     or exists(select 1 from tripwire_claim_sources l join tripwire_source_occurrences s on s.workspace=l.workspace and s.id=l.source_id
       where l.workspace=c.workspace and l.claim_id=c.id and s.evidence_id=${p}))`);
  }
  const where = `c.workspace=$1 ${filters.length ? "and " + filters.join(" and ") : ""}`;
  // Resolve workspace/public shadows once, not with a metadata scan per claim.
  // Both physical IDs and canonical base IDs remain valid lookup aliases.
  const articleLookup = `with article_lookup as materialized (
    select distinct on(identity.article_id) identity.article_id,r.data
    from tripwire_records r cross join lateral (
      select r.id article_id union select r.data->>'baseId' where r.data->>'baseId' is not null
    ) identity where r.kind='article' and r.owner in ('public',$1)
    order by identity.article_id,(r.owner=$1) desc
  )`;
  const from = `from tripwire_attributed_claims c join tripwire_claim_families f on f.workspace=c.workspace and f.id=c.family_id
    ${currentLinkJoin}
    left join article_lookup a on a.article_id=c.article_id`;
  const all = (await pool.query(`${articleLookup} select c.*, f.claim_id legacy_claim_id,${effectiveClaimSql} effective_claim_id,lc.data link_correction,f.event_id,f.entity_event_id,a.data article ${from} where ${where}
    and coalesce(a.data->>'hidden','false')<>'true' order by a.data->>'publishedAt' nulls last,c.id`, params)).rows;
  all.sort((a, b) => (a.article?.publishedAt ?? suppliedDate(a.article?.sourceSearch?.date) ?? "9999").localeCompare(
    b.article?.publishedAt ?? suppliedDate(b.article?.sourceSearch?.date) ?? "9999") || a.id.localeCompare(b.id));
  const selectedArticle = q.articleId ? (await pool.query(`select data from tripwire_records where kind='article' and owner in ('public',$1)
    and (id=$2 or data->>'baseId'=$2) order by (owner=$1) desc limit 1`, [W, q.articleId])).rows[0]?.data : null;
  const articleIds = [...new Set([...all.map(r => r.article_id), ...q.articleId && selectedArticle && !selectedArticle.hidden ? [q.articleId] : []])];
  const sourceRows = articleIds.length ? (await pool.query(`select s.*,e.excerpt from tripwire_source_occurrences s
    left join tripwire_entity_evidence e on e.workspace=s.workspace and e.id=s.evidence_id
    where s.workspace=$1 and s.article_id=any($2::text[]) order by s.article_id,s.id limit 2000`, [W, articleIds])).rows : [];
  const captures = articleIds.length ? (await pool.query("select * from tripwire_entity_captures where workspace=$1 and article_id=any($2::text[])", [W, articleIds])).rows : [];
  const articles = new Map(all.map(c => [c.article_id, c.article]));
  if (q.articleId && selectedArticle) articles.set(q.articleId, selectedArticle);
  const retainedEvidence = captures.length ? (await pool.query("select * from tripwire_entity_evidence where workspace=$1 and capture_id=any($2::text[])", [W, captures.map(c => c.id)])).rows : [];
  const captureById = new Map(captures.map(c => [c.id, c]));
  const evidenceById = new Map(retainedEvidence.map(e => [e.id, e]));
  // Unreferenced retained captures do not participate in evidence comparisons.
  // Keep original JS strings: PostgreSQL substring uses code-point offsets,
  // whereas retained evidence offsets are UTF-16.
  const hashes = [...new Set([...retainedEvidence.map(e => captureById.get(e.capture_id)?.hash),
    ...[...articles.values()].map(a => a?.fullTextHash)].filter(Boolean))];
  const bodies = new Map<string, string>(hashes.length ? (await pool.query("select hash,text from tripwire_content where hash=any($1::text[])", [hashes])).rows.map(r => [r.hash, r.text]) : []);
  const versionCache = new Map<string, ReturnType<typeof evidenceVersion>>();
  const versionFor = (id: string | null, articleId: string) => {
    const key = JSON.stringify([articleId, id]);
    const cached = versionCache.get(key);
    if (cached) return cached;
    const e = evidenceById.get(id);
    const capture = captureById.get(e?.capture_id);
    const result = evidenceVersion(e, capture?.article_id === articleId ? capture : undefined, articles.get(articleId), bodies);
    versionCache.set(key, result);
    return result;
  };
  const sources = sourceRows.map(s => ({ id: s.id, articleId: s.article_id, descriptor: s.descriptor, sourceType: s.source_type,
    evidenceVersion: versionFor(s.evidence_id, s.article_id),
    anonymity: s.anonymity, minimumHumans: s.minimum_humans, supplied: s.supplied, externalId: s.external_id,
    familyHypothesis: s.family_hypothesis, evidenceId: s.evidence_id, excerpt: s.excerpt ?? null, captureId: s.capture_id }));
  const sourceIds = sources.map(s => s.id);
  const matched = sourceIds.length ? (await pool.query("select * from tripwire_source_matches where workspace=$1 and (source_a=any($2::text[]) or source_b=any($2::text[])) limit 500", [W, sourceIds])).rows : [];
  const reviews = (await pool.query(`select r.*,ctx.data->>'linkCorrectionId' association_correction_id from tripwire_provenance_reviews r
    left join tripwire_records ctx on ctx.id='review-link-context:'||r.workspace||':'||r.id and ctx.owner=r.workspace
    where r.workspace=$1 and (r.claim_id=any($2::text[]) or r.source_match_id=any($3::text[]))
    order by r.created_at,r.id`, [W, all.map(c => c.id), matched.map(m => m.id)])).rows;
  const superseded = new Set(reviews.map(r => r.supersedes_id).filter(Boolean));
  const current = reviews.filter(r => !superseded.has(r.id));
  const versions=all.length ? (await pool.query(`select * from tripwire_claim_capture_links where workspace=$1 and claim_id=any($2::text[])
    order by created_at,capture_id`,[W,all.map(c=>c.id)])).rows : [];
  const captureLinksByClaim = byField(versions, "claim_id");
  const reviewsByClaim = byField(reviews, "claim_id");
  const currentByClaim = byField(current, "claim_id");
  const reviewsByMatch = byField(reviews, "source_match_id");
  const versionsByClaim = new Map(all.map(c => {
    const ids = [...new Set([c.evidence_id, ...(captureLinksByClaim.get(c.id) ?? []).map(v => v.evidence_id),
      ...(reviewsByClaim.get(c.id) ?? []).map(r => r.evidence_id)].filter(Boolean))] as string[];
    return [c.id, ids.map(id => versionFor(id, c.article_id))];
  }));
  const filtered = all.filter(c => !q.evidenceScope || q.evidenceScope === "all" || claimEvidenceScope(versionsByClaim.get(c.id)!) === q.evidenceScope);
  const page = filtered.slice(q.offset ?? 0, (q.offset ?? 0) + 30);
  const corrections=page.length ? (await pool.query(`select distinct on(claim_id) * from tripwire_claim_direction_corrections
    where workspace=$1 and claim_id=any($2::text[]) order by claim_id,created_at desc,id desc`,[W,page.map(c=>c.id)])).rows : [];
  const evidenceIds = [...new Set([...page.map(c => c.evidence_id), ...reviews.map(r => r.evidence_id)].filter(Boolean))];
  const evidence = evidenceIds.length ? (await pool.query("select * from tripwire_entity_evidence where workspace=$1 and id=any($2::text[])", [W, evidenceIds])).rows : [];
  const links = page.length ? (await pool.query("select * from tripwire_claim_sources where workspace=$1 and claim_id=any($2::text[])", [W, page.map(c => c.id)])).rows : [];
  const correctionsByClaim = new Map(corrections.map(c => [c.claim_id, c]));
  const displayedEvidence = new Map(evidence.map(e => [e.id, e]));
  const linksByClaim = byField(links, "claim_id");
  const claims = page.map(c => {
    const correction=correctionsByClaim.get(c.id), assessment=c.data?.assessment;
    const refs = reviewsByClaim.get(c.id) ?? [];
    const last = currentByClaim.get(c.id)?.[0];
    const e = displayedEvidence.get(last ? last.evidence_id : c.evidence_id);
    return { id: c.id, claimId: c.effective_claim_id ?? c.legacy_claim_id, originalClaimId: c.legacy_claim_id,
      linkCorrectionId: c.link_correction?.id ?? null,
      linkExcluded: !c.effective_claim_id || !!q.claimId && c.effective_claim_id !== q.claimId,
      linkHistory: [] as ClaimLinkCorrection[],
      familyId: c.family_id, proposition: c.proposition, articleId: c.article_id,
      direction: correction?.direction ?? assessment?.direction ?? "unassessed",
      directionSubject: correction?.subject ?? assessment?.subject ?? null,
      directionReason: correction?.rationale ?? assessment?.reason ?? null,
      directionOrigin: correction ? "analyst" : assessment ? "automatic" : "unassessed",
      directionCorrectionId: correction?.id ?? null,
      evidenceScope: claimEvidenceScope(versionsByClaim.get(c.id)!),
      displayedEvidenceVersion: versionFor(e?.id ?? null, c.article_id),
      evidenceVersions: versionsByClaim.get(c.id)!,
      title: c.article?.title ?? "Retained article", outlet: c.article?.outlet ?? null, url: c.article?.url ?? null, publishedAt: c.article?.publishedAt ?? null,
      suppliedDate: suppliedDate(c.article?.sourceSearch?.date),
      eventId: c.event_id ?? c.entity_event_id ?? null, evidenceId: e?.id ?? null, excerpt: e?.excerpt ?? null,
      start: e?.start ?? null, end: e?.end ?? null, captureId: e?.capture_id ?? null, supplied: c.supplied,
      externalId: c.external_id, sourceIds: (linksByClaim.get(c.id) ?? []).map(l => l.source_id), reviews: refs.map(review) };
  });
  const linkHistory = page.length ? (await pool.query(`select data from tripwire_records where owner=$1
    and kind='claim-link-correction' and data->>'observationId'=any($2::text[]) order by created_at,id`, [W, page.map(c => c.id)])).rows : [];
  for (const claim of claims) {
    const events = linkHistory.filter(r => r.data.observationId === claim.id).map(r => r.data as ClaimLinkCorrection);
    let previous: string | null = null;
    for (let i = 0; i < events.length; i++) {
      const next = events.find(e => e.supersedesId === previous);
      if (!next) break;
      claim.linkHistory.push(next); previous = next.id;
    }
  }
  const context = articleIds.length ? (await pool.query(`select sheet,row_key,data,resolution from tripwire_source_inputs i
    join tripwire_source_batches b on b.id=i.batch_id and b.status='applied'
    where i.resolution->>'articleId'=any($1::text[])
    order by i.sheet,i.row_key limit 100`, [articleIds])).rows.map(r => ({ sheet: r.sheet, row: r.row_key, data: r.data, resolution: r.resolution })) : [];
  // Historical associations stay inspectable, but cannot inflate current claim coverage.
  // Article-scoped inventory remains article-wide, independent of claim association.
  const activeClaims = all.filter(c => c.effective_claim_id && (!q.claimId || c.effective_claim_id === q.claimId));
  const countArticleIds = q.claimId ? new Set(activeClaims.map(c => c.article_id)) : new Set(articleIds);
  const currentSourceRows = sourceRows.filter(s => countArticleIds.has(s.article_id));
  const reviewedSources = currentSourceRows.filter(s => !s.supplied);
  const activePath = (r: Row) => r.claim_id && r.path_key && all.some(c => c.id === r.claim_id && c.effective_claim_id &&
    (!q.claimId || c.effective_claim_id === q.claimId) &&
    (r.association_correction_id ?? null) === (c.link_correction?.id ?? null));
  return { claims, sources, matches: matched.map(m => ({ id: m.id, sourceA: m.source_a, sourceB: m.source_b,
    hypothesis: m.hypothesis, rationale: m.rationale, conflicts: m.conflicts, supplied: m.supplied,
    reviews: (reviewsByMatch.get(m.id) ?? []).map(review) })), context,
    counts: { articles: countArticleIds.size, occurrences: currentSourceRows.length,
      historicalPassages: all.length - activeClaims.length, minimumAnonymousHumans: conservativeMinimum(reviewedSources),
      provisionalSourceRecords: q.articleId ? (selectedArticle?.sourceSearch?.provisionalSourceRecords ?? null) : null,
      suppliedMinimumAnonymousHumans: q.articleId ? (selectedArticle?.sourceSearch?.minimumAnonymousHumans ?? null) : null,
      independentPaths: current.some(activePath) ? new Set(current.filter(activePath).map(r => r.path_key)).size : null },
    total: filtered.length, offset: q.offset ?? 0 };
}

async function transaction<T>(work: (client: PoolClient) => Promise<T>) {
  const client = await pool.connect();
  try { await client.query("BEGIN"); await client.query("select pg_advisory_xact_lock(hashtext($1))", [`articles:${W}`]);
    const result = await work(client); await client.query("COMMIT"); return result;
  } catch (err) { await client.query("ROLLBACK"); throw err; } finally { client.release(); }
}
export async function connectPassage(input: typeof ConnectReportingPassageBody._output) {
  return transaction(async client => {
    const article = (await client.query(`select * from tripwire_records where kind='article' and owner in ('public',$1)
      and (id=$2 or data->>'baseId'=$2) order by (owner=$1) desc limit 1`, [W, input.articleId])).rows[0];
    if (!article || article.data.hidden) throw new ProvenanceError(404, "Article not found");
    const legacy = (await client.query(`select * from tripwire_records where kind='claim' and owner in ('public',$1)
      and (id=$2 or data->>'baseId'=$2) order by (owner=$1) desc limit 1`, [W, input.claimId])).rows[0];
    if (!legacy || legacy.data.hidden) throw new ProvenanceError(404, "Claim not found");
    const cap = (await client.query(`select c.*,t.text from tripwire_entity_captures c join tripwire_content t on t.hash=c.hash
      where c.workspace=$1 and c.id=$2 and c.article_id=$3`, [W, input.captureId, input.articleId])).rows[0];
    if (!cap) throw new ProvenanceError(400, "Choose a retained capture for this article");
    if (input.end <= input.start || cap.text.slice(input.start, input.end) !== input.excerpt || !cap.text.includes(input.descriptor)) {
      throw new ProvenanceError(400, "Exact passage offsets and source wording must match the retained capture");
    }
    if (input.entityEventId) {
      const event = (await client.query("select 1 from tripwire_entities where workspace=$1 and id=$2 and type='event'", [W, input.entityEventId])).rowCount;
      if (!event) throw new ProvenanceError(400, "Choose a workspace event entity");
    }
    const id = crypto.randomUUID(), evidence = input.evidenceId ?? crypto.randomUUID();
    if (input.evidenceId) {
      const existing = (await client.query(`select 1 from tripwire_entity_evidence where workspace=$1 and id=$2 and capture_id=$3
        and excerpt=$4 and start=$5 and "end"=$6`, [W, evidence, input.captureId, input.excerpt, input.start, input.end])).rowCount;
      if (!existing) throw new ProvenanceError(400, "Existing evidence must reference this same exact retained passage");
    } else {
      await client.query(`insert into tripwire_entity_evidence(workspace,id,capture_id,excerpt,start,"end",attribution,certainty,scope,extractor_version,policy_version)
        values($1,$2,$3,$4,$5,$6,$7,'attributed','Analyst-connected claim passage','manual-exact-v1','reporting-provenance-v1')`,
        [W, evidence, input.captureId, input.excerpt, input.start, input.end, input.descriptor]);
    }
    const familyId = sourceKey(W, "legacy-claim", input.claimId);
    await client.query(`insert into tripwire_claim_families(workspace,id,claim_id,proposition,event_id,entity_event_id,supplied)
      values($1,$2,$3,$4,$5,$6,false) on conflict(workspace,claim_id) do nothing`,
      [W, familyId, input.claimId, legacy.data.title, input.eventId ?? null, input.entityEventId ?? null]);
    const family = (await client.query("select * from tripwire_claim_families where workspace=$1 and claim_id=$2", [W, input.claimId])).rows[0];
    if (input.eventId && family.event_id && family.event_id !== input.eventId || input.entityEventId && family.entity_event_id && family.entity_event_id !== input.entityEventId) {
      throw new ProvenanceError(409, "Claim family already has a different event; choose the correct proposition");
    }
    if (!family.event_id && input.eventId || !family.entity_event_id && input.entityEventId) {
      await client.query("update tripwire_claim_families set event_id=coalesce(event_id,$3),entity_event_id=coalesce(entity_event_id,$4) where workspace=$1 and id=$2",
        [W, family.id, input.eventId ?? null, input.entityEventId ?? null]);
    }
    await client.query(`insert into tripwire_attributed_claims(workspace,id,family_id,article_id,evidence_id,proposition,supplied)
      values($1,$2,$3,$4,$5,$6,false)`, [W, id, family.id, input.articleId, evidence, input.proposition]);
    let sources = input.sourceIds ?? [];
    if (sources.length) {
      const valid = (await client.query("select id from tripwire_source_occurrences where workspace=$1 and article_id=$2 and id=any($3::text[])", [W, input.articleId, sources])).rows;
      if (valid.length !== new Set(sources).size) throw new ProvenanceError(400, "Joint attribution must use occurrences from this article");
    } else {
      const source = crypto.randomUUID();
      await client.query(`insert into tripwire_source_occurrences(workspace,id,article_id,capture_id,evidence_id,descriptor,source_type,anonymity,minimum_humans,supplied)
        values($1,$2,$3,$4,$5,$6,'Human',$7,$8,false)`, [W, source, input.articleId, input.captureId, evidence, input.descriptor,
        input.anonymity, input.anonymity === "Unnamed" ? grammaticalMinimum(input.descriptor) : null]);
      sources = [source];
    }
    for (const source of new Set(sources)) await client.query("insert into tripwire_claim_sources(workspace,claim_id,source_id,article_id) values($1,$2,$3,$4)", [W, id, source, input.articleId]);
    if (input.developmentId) {
      const observed = (await client.query("select 1 from tripwire_entity_observations where workspace=$1 and development_id=$2 and evidence_id=$3",
        [W, input.developmentId, evidence])).rowCount;
      if (!observed) throw new ProvenanceError(400, "Development must already reference this same underlying evidence");
      await client.query("insert into tripwire_development_claim_links(workspace,development_id,claim_id,evidence_id) values($1,$2,$3,$4)",
        [W, input.developmentId, id, evidence]);
    }
    return { id };
  });
}
export async function reviewLineage(input: typeof ReviewReportingLineageBody._output) {
  return transaction(async client => {
    if (!!input.claimObservationId === !!input.sourceMatchId) throw new ProvenanceError(400, "Choose one claim observation or source-environment match");
    const isClaim = !!input.claimObservationId;
    if (isClaim === ["same-environment", "distinct-environments", "unresolved"].includes(input.relation)) throw new ProvenanceError(400, "Choose a relation appropriate to this record");
    const table = isClaim ? "tripwire_attributed_claims" : "tripwire_source_matches";
    const row = (await client.query(`select * from ${table} where workspace=$1 and id=$2 for update`, [W, input.claimObservationId ?? input.sourceMatchId])).rows[0];
    if (!row) throw new ProvenanceError(404, "Provenance record not found");
    const current = (await client.query(`${latestSql} and ${isClaim ? "claim_id" : "source_match_id"}=$2`, [W, row.id])).rows[0];
    if ((current?.id ?? null) !== (input.supersedesId ?? null)) throw new ProvenanceError(409, "Review changed; refresh before appending a correction");
    const evidenceId = input.evidenceId !== undefined ? input.evidenceId : current ? current.evidence_id : row.evidence_id ?? null;
    if (isClaim && evidenceId) {
      const evidence = (await client.query(`select e.* from tripwire_entity_evidence e join tripwire_entity_captures c on c.workspace=e.workspace and c.id=e.capture_id
        join tripwire_content t on t.hash=c.hash where e.workspace=$1 and e.id=$2 and c.article_id=$3`, [W, evidenceId, row.article_id])).rows[0];
      if (!evidence) throw new ProvenanceError(400, "Supporting evidence must belong to this article");
      // Never upgrade a supplied unmatched quotation into evidence via review.
      const body = (await client.query(`select t.text from tripwire_entity_captures c join tripwire_content t on t.hash=c.hash
        where c.workspace=$1 and c.id=$2`, [W, evidence.capture_id])).rows[0]?.text;
      if (!body || body.slice(evidence.start, evidence.end) !== evidence.excerpt) throw new ProvenanceError(400, "Supporting passage does not match retained text");
    }
    if (input.pathKey && (!isClaim || !evidenceId || !["new-reporting", "added-evidence"].includes(input.relation))) {
      throw new ProvenanceError(400, "Independent paths require an evidence-backed reporting relation and rationale");
    }
    if (input.targetClaimId) {
      const target = (await client.query("select * from tripwire_attributed_claims where workspace=$1 and id=$2", [W, input.targetClaimId])).rows[0];
      if (!isClaim || !target || target.id === row.id) throw new ProvenanceError(400, "Choose a different related observation.");
      const active = (await client.query(`select c.id,${effectiveClaimSql} claim_id from tripwire_attributed_claims c
        join tripwire_claim_families f on f.workspace=c.workspace and f.id=c.family_id ${currentLinkJoin}
        where c.workspace=$1 and c.id=any($2::text[])`, [W, [row.id, target.id]])).rows;
      const ownClaim = active.find(c => c.id === row.id)?.claim_id;
      if (!ownClaim || ownClaim !== active.find(c => c.id === target.id)?.claim_id)
        throw new ProvenanceError(400, "Related observations must support the same proposition through their active claim association.");
    }
    const id = crypto.randomUUID();
    await client.query(`insert into tripwire_provenance_reviews(workspace,id,claim_id,source_match_id,target_claim_id,supersedes_id,relation,evidence_id,path_key,rationale,actor)
      values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NULL)`, [W, id, input.claimObservationId ?? null, input.sourceMatchId ?? null,
      input.targetClaimId ?? null, input.supersedesId ?? null, input.relation, evidenceId, input.pathKey ?? null, input.rationale]);
    if (isClaim) {
      const context = (await client.query(`select lc.data->>'id' link_id from tripwire_attributed_claims c ${currentLinkJoin}
        where c.workspace=$1 and c.id=$2`, [W, row.id])).rows[0];
      await client.query(`insert into tripwire_records(id,owner,kind,data) values($1,$2,'review-link-context',$3)`,
        [`review-link-context:${W}:${id}`, W, { reviewId: id, linkCorrectionId: context?.link_id ?? null }]);
    }
    return { id };
  });
}
