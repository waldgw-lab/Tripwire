import { Router } from "express";
import { and, eq, ilike, or, sql, desc, inArray } from "drizzle-orm";
import { db } from "@workspace/db";
import * as api from "@workspace/api-zod";
import { entities, captures, developments, observations, W, uid, scoped, profile, settings, logDecision, evidenceRows } from "../lib/entity-db";
import { addEvidence, decide } from "../lib/entity-actions";
import { health, control } from "../lib/entity-operations";

const router = Router();
// Serialize timestamps before generated response validation.
const json = (value: unknown) => JSON.parse(JSON.stringify(value, (field, entry) => field === "organizationId" && entry === null ? undefined : entry));
router.get("/tripwire/entities", async (req, res): Promise<void> => {
  const q = api.ListEntitiesQueryParams.parse(req.query);
  const filters = [scoped(entities)];
  if (q.q) filters.push(or(ilike(entities.name, `%${q.q.replace(/[%_\\]/g, "\\$&")}%`),
    sql`exists(select 1 from unnest(${entities.aliases}) a where a ilike ${`%${q.q.replace(/[%_\\]/g, "\\$&")}%`})`)!);
  if (q.state) filters.push(eq(entities.state, q.state));
  if (q.type) filters.push(eq(entities.type, q.type));
  if (q.classification) filters.push(eq(entities.classification, q.classification));
  const [count] = await db.select({ total: sql<number>`count(*)::int` }).from(entities).where(and(...filters));
  const items = await db.select().from(entities).where(and(...filters)).orderBy(entities.name, entities.id).limit(q.limit).offset(q.offset);
  res.json(api.ListEntitiesResponse.parse(json({ items, total: count?.total ?? 0, offset: q.offset, limit: q.limit })));
});
router.post("/tripwire/entities", async (req, res): Promise<void> => {
  const body = api.CreateEntityBody.parse(req.body);
  const entity = await db.transaction(async tx => {
    const config = await settings(tx, true);
    if (body.organizationId) {
      const [parent] = await tx.select().from(entities).where(and(scoped(entities), eq(entities.id, body.organizationId)));
      if (!parent || parent.type !== "organization") throw new Error("Choose a workspace organization");
    }
    const [row] = await tx.insert(entities).values({ ...body, id: uid(), workspace: W }).returning();
    await logDecision(tx, row!.id, "shared-workspace-analyst", "discover", body.rationale, {}, { state: "Discovered" }, [], {}, config.policyVersion);
    return row!;
  });
  res.json(api.CreateEntityResponse.parse(json(entity)));
});
router.get("/tripwire/entities/:id", async (req, res): Promise<void> => {
  const { id } = api.GetEntityParams.parse(req.params);
  const q = api.GetEntityQueryParams.parse(req.query);
  res.json(api.GetEntityResponse.parse(json(await profile(id, q.offset))));
});
router.post("/tripwire/entities/:id", async (req, res): Promise<void> => {
  const { id } = api.DecideEntityParams.parse(req.params);
  res.json(api.DecideEntityResponse.parse(json(await decide(id, api.DecideEntityBody.parse(req.body)))));
});
router.post("/tripwire/entity-evidence", async (req, res): Promise<void> => {
  res.json(api.AddEntityEvidenceResponse.parse(json(await addEvidence(api.AddEntityEvidenceBody.parse(req.body)))));
});
router.get("/tripwire/entity-captures", async (req, res): Promise<void> => {
  const q = api.ListEntityCapturesQueryParams.parse(req.query);
  const filter = and(scoped(captures), q.articleId ? eq(captures.articleId, q.articleId) : undefined);
  const [count] = await db.select({ total: sql<number>`count(*)::int` }).from(captures).where(filter);
  const items = await db.select().from(captures).where(filter).orderBy(desc(captures.capturedAt), captures.id).limit(30).offset(q.offset);
  res.json(api.ListEntityCapturesResponse.parse(json({ items, total: count?.total ?? 0 })));
});
export async function developmentRows(articleId?: string, disposition?: string, offset = 0) {
  const filter = and(scoped(developments), disposition ? eq(developments.disposition, disposition) : undefined,
    articleId ? sql`exists(select 1 from tripwire_entity_observations o join tripwire_entity_evidence e on e.id=o.evidence_id and e.workspace=o.workspace join tripwire_entity_captures c on c.id=e.capture_id and c.workspace=e.workspace where o.development_id=${developments.id} and o.workspace=${W} and c.article_id=${articleId})` : undefined);
  const [count] = await db.select({ total: sql<number>`count(*)::int` }).from(developments).where(filter);
  const rows = await db.select().from(developments).where(filter).orderBy(desc(developments.createdAt), developments.id).limit(30).offset(offset);
  const items = [];
  for (const row of rows) {
    const refs = await db.select().from(observations).where(and(scoped(observations), eq(observations.developmentId, row.id))).limit(100);
    items.push({ ...row, observations: await evidenceRows(refs.map(r => r.evidenceId)) });
  }
  return { items, total: count?.total ?? 0 };
}
router.get("/tripwire/developments", async (req, res): Promise<void> => {
  const q = api.ListDevelopmentsQueryParams.parse(req.query);
  res.json(api.ListDevelopmentsResponse.parse(json(await developmentRows(q.articleId, q.disposition, q.offset))));
});
router.post("/tripwire/developments/:id", async (req, res): Promise<void> => {
  const { id } = api.DecideDevelopmentParams.parse(req.params);
  const input = api.DecideDevelopmentBody.parse(req.body);
  await db.transaction(async tx => {
    const config = await settings(tx, true);
    const [current] = await tx.select().from(developments).where(and(scoped(developments), eq(developments.id, id))).for("update");
    if (!current) throw new Error("Development not found");
    if (input.disposition === "Immediate") {
      const eligible = await tx.select({ id: entities.id }).from(entities).where(and(scoped(entities),
        inArray(entities.id, current.entityIds), sql`${entities.state} <> 'Archived'`)).limit(1);
      if (!eligible.length) throw new Error("Immediate requires reactivating an archived subject first");
      const refs = await tx.select().from(observations).where(and(scoped(observations), eq(observations.developmentId, id)));
      const source = await evidenceRows(refs.map(r => r.evidenceId), tx);
      if (!source.some(e => e.capture.complete && e.lineage?.assessedBy === "shared-workspace-analyst"
        && e.lineage.independentlyReported && !!e.lineage.originKey && refs.some(r => r.evidenceId === e.id && r.novelty === "material")
        && !["disputed", "inferred"].includes(e.certainty)))
        throw new Error("Immediate requires assessed material novelty, complete passage and evidenced source lineage");
    }
    const change = { status: input.status, disposition: input.disposition ?? current.disposition };
    await tx.update(developments).set(change).where(eq(developments.id, id));
    for (const entityId of current.entityIds) await logDecision(tx, entityId, "shared-workspace-analyst", "triage-development", input.rationale,
      { developmentId: id, status: current.status, disposition: current.disposition }, change, [], {}, config.policyVersion);
  });
  const [row] = await db.select().from(developments).where(and(scoped(developments), eq(developments.id, id)));
  const refs = await db.select().from(observations).where(and(scoped(observations), eq(observations.developmentId, id))).limit(100);
  res.json(api.DecideDevelopmentResponse.parse(json({ ...row, observations: await evidenceRows(refs.map(r => r.evidenceId)) })));
});
router.get("/tripwire/entity-automation", async (req, res): Promise<void> => {
  const q = api.GetEntityAutomationQueryParams.parse(req.query);
  res.json(api.GetEntityAutomationResponse.parse(json(await health(q.offset))));
});
router.post("/tripwire/entity-automation", async (req, res): Promise<void> => {
  res.json(api.ControlEntityAutomationResponse.parse(json(await control(api.ControlEntityAutomationBody.parse(req.body)))));
});
router.use((err: unknown, _req: import("express").Request, res: import("express").Response, _next: import("express").NextFunction) => {
  // Never reflect database/provider errors, SQL, prompts or content.
  const message = err instanceof Error ? err.message : "";
  const known = /^(Entity not found|Capture not found|Choose |Candidate |Monitoring requires|Supporting evidence|Broken source|The quotation|Occupancy|A nomination|Role end|Correction|Independent sourcing|Both event|Identity merge|Merge requires|People cannot|Assertion not found|An alias|Use namespace|Unknown policy|Immediate requires|Development not found|Job is not|Authorize capture|Published private|Reviewed reporting|Always-on worker|Explicit autonomous|Extraction provider)/;
  if (known.test(message)) res.status(/not found/.test(message) ? 404 : 400).json({ error: message });
  else if (err && typeof err === "object" && "issues" in err) res.status(400).json({ error: "Invalid entity request" });
  else res.status(503).json({ error: "Entity operation unavailable. Retained history is unchanged." });
});
export default router;
