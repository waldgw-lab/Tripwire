import { db, tripwireRecords } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import type { ClaimCorrectionInput, ClaimLinkInput, ClaimLinkCorrection } from "@workspace/api-zod";
import { articleLock, FeedbackError } from "./tripwire-feedback";
import { recordsFor } from "./tripwire-store";
import { WORKSPACE_OWNER } from "./tripwire-access";

export async function editClaim(owner: string, id: string, input: ClaimCorrectionInput) {
  if (input.record.kind !== "claim" || !input.record.title.trim() || input.rationale.trim().length < 5)
    throw new FeedbackError(400, "Enter claim wording and a correction reason.");
  return db.transaction(async tx => {
    await articleLock(tx, owner);
    const records = await recordsFor(owner, false, tx);
    const current = records.find(r => r.id === id && r.kind === "claim");
    if (!current) throw new FeedbackError(404, "Claim not found.");
    const eventId = `claim-feedback:${owner}:${input.requestId}`;
    const decision = JSON.stringify([id, input.record, input.rationale]);
    const [retry] = await tx.select().from(tripwireRecords).where(eq(tripwireRecords.id, eventId));
    if (retry) {
      if (retry.data.decision !== decision) throw new FeedbackError(409, "Request identifier already used.");
      return current;
    }
    if ((current.claimRevision ?? 0) !== input.expectedRevision)
      throw new FeedbackError(409, "This claim changed. Close and reopen the editor before deciding again.");
    if (input.record.observations?.some(o => !records.some(r => r.kind === "article" && r.id === o.articleId) ||
      !Number.isFinite(Date.parse(o.observedAt)) || o.url && !/^https?:\/\/\S+$/i.test(o.url)))
      throw new FeedbackError(400, "Manual observations require an existing article, valid time and source URL.");
    const { title, topic, summary, entities, observations } = input.record;
    const data = { ...current, title: title.trim(), topic, summary, entities, observations, claimRevision: input.expectedRevision + 1 };
    const now = new Date();
    await tx.insert(tripwireRecords).values({ id: `${owner}:${id}`, owner, kind: "claim", data: { ...data, baseId: id }, updatedAt: now })
      .onConflictDoUpdate({ target: tripwireRecords.id, set: { data: { ...data, baseId: id }, updatedAt: now } });
    await tx.insert(tripwireRecords).values({ id: eventId, owner, kind: "claim-feedback", data: {
      id: eventId, claimId: id, before: current, after: data, reason: input.rationale.trim(), decision, timestamp: now.toISOString(),
    } });
    return { ...data, updatedAt: now.toISOString() };
  });
}

/** The original attributed claim/evidence rows never change. */
export async function correctLink(input: ClaimLinkInput, owner = WORKSPACE_OWNER): Promise<ClaimLinkCorrection> {
  if (input.rationale.trim().length < 5) throw new FeedbackError(400, "Explain the linkage correction.");
  return db.transaction(async tx => {
    await articleLock(tx, owner);
    const id = `claim-link:${owner}:${input.requestId}`;
    const decision = JSON.stringify(input);
    const [retry] = await tx.select().from(tripwireRecords).where(eq(tripwireRecords.id, id));
    if (retry) {
      if (retry.data.decision !== decision) throw new FeedbackError(409, "Request identifier already used for a different correction.");
      return retry.data as unknown as ClaimLinkCorrection;
    }
    const observation = (await tx.execute<{ article_id: string }>(sql`select article_id from tripwire_attributed_claims
      where workspace=${owner} and id=${input.observationId}`)).rows[0];
    if (!observation) throw new FeedbackError(404, "Passage association not found.");
    const records = await recordsFor(owner, false, tx);
    if (!records.some(r => r.kind === "article" && r.id === observation.article_id))
      throw new FeedbackError(404, "Article is no longer available.");
    if (input.targetClaimId !== null && !records.some(r => r.kind === "claim" && r.id === input.targetClaimId))
      throw new FeedbackError(400, "Choose an existing workspace claim.");
    const prior = (await tx.execute<{ data: ClaimLinkCorrection }>(sql`select r.data from tripwire_records r
      where r.owner=${owner} and r.kind='claim-link-correction' and r.data->>'observationId'=${input.observationId}
      and not exists(select 1 from tripwire_records n where n.owner=r.owner and n.kind='claim-link-correction' and n.data->>'supersedesId'=r.id)
      order by created_at desc,id desc limit 1`)).rows[0]?.data;
    if ((prior?.id ?? null) !== input.supersedesId) throw new FeedbackError(409, "This association changed. Refresh before correcting it.");
    const correction = { id, observationId: input.observationId, targetClaimId: input.targetClaimId,
      supersedesId: input.supersedesId, rationale: input.rationale.trim(), createdAt: new Date().toISOString() };
    await tx.insert(tripwireRecords).values({ id, owner, kind: "claim-link-correction", data: { ...correction, decision } });
    return correction;
  });
}

export const currentLinkJoin = `left join (
  select distinct on(r.owner,r.data->>'observationId') r.owner,r.data from tripwire_records r
  where r.kind='claim-link-correction'
  and not exists(select 1 from tripwire_records n where n.owner=r.owner and n.kind='claim-link-correction' and n.data->>'supersedesId'=r.id)
  order by r.owner,r.data->>'observationId',r.created_at desc,r.id desc
  ) lc on lc.owner=c.workspace and lc.data->>'observationId'=c.id`;
export const effectiveClaimSql = `case when lc.data is not null then lc.data->>'targetClaimId' else f.claim_id end`;
