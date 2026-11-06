import { and, eq, inArray, sql } from "drizzle-orm";
import { db, entityIdentifiers } from "@workspace/db";
import { AddEntityEvidenceBody, DecideEntityBody } from "@workspace/api-zod";
import { entities, evidence, assertions, candidates, lineage, developments, observations, captures,
  W, uid, key, scoped, settings, requireEntity, logDecision, evidenceRows, type Tx } from "./entity-db";
import { dimensions, exactEvidence, triage } from "./entity-policy";
import { readContent } from "./tripwire-content-storage";

type EvidenceInput = ReturnType<typeof AddEntityEvidenceBody.parse>;
type ActionInput = ReturnType<typeof DecideEntityBody.parse>;
export async function addEvidence(input: EvidenceInput) {
  return db.transaction(async tx => {
    const config = await settings(tx, true);
    const subject = await requireEntity(input.entityId, tx, true);
    const [capture] = await tx.select().from(captures).where(and(scoped(captures), eq(captures.id, input.captureId)));
    if (!capture) throw new Error("Capture not found in this workspace");
    const content = await readContent(capture.hash);
    if (!exactEvidence(content.text, input.excerpt, input.start, input.end)) throw new Error("The quotation and offsets must match the retained capture exactly");
    if (input.objectId) await requireEntity(input.objectId, tx);
    if (input.eventId) {
      const event = await requireEntity(input.eventId, tx);
      if (!["event", "issue"].includes(event.type)) throw new Error("Event linkage requires an event or issue entity");
    }
    if (input.predicate === "occupies") {
      const object = input.objectId ? await requireEntity(input.objectId, tx) : null;
      if (subject.type !== "person" || object?.type !== "position") throw new Error("Occupancy must link a person to a position");
      if (input.tenure === "nominated" && input.certainty === "confirmed") throw new Error("A nomination cannot confirm occupancy");
    }
    if (input.validFrom && input.validTo && input.validTo.getTime() < input.validFrom.getTime()) throw new Error("Role end precedes its start");
    for (const id of [input.supersedesId, input.disputesId].filter((s): s is string => !!s)) {
      const [old] = await tx.select().from(assertions).where(and(scoped(assertions), eq(assertions.id, id), eq(assertions.subjectId, subject.id)));
      if (!old) throw new Error("Correction/dispute must reference this subject's assertion");
    }
    if (input.independentlyReported && (!input.originKey || !input.sourcingRationale || !["original", "addition"].includes(input.relation ?? "")))
      throw new Error("Independent sourcing requires an assessed origin, addition and rationale");
    const evidenceId = uid();
    await tx.insert(evidence).values({ id: evidenceId, workspace: W, captureId: capture.id, excerpt: input.excerpt,
      start: input.start, end: input.end, attribution: input.attribution, certainty: input.certainty,
      scope: input.scope, extractorVersion: "shared-workspace-analyst", policyVersion: config.policyVersion });
    await tx.insert(lineage).values({ id: uid(), workspace: W, evidenceId, relation: input.relation ?? "unknown",
      originKey: input.originKey, independentlyReported: input.independentlyReported ?? false,
      rationale: input.sourcingRationale ?? "Independence and originality remain unknown", assessedBy: "shared-workspace-analyst" });
    await tx.insert(assertions).values({ id: uid(), workspace: W, subjectId: subject.id, predicate: input.predicate,
      objectId: input.objectId, value: input.value, evidenceId, eventId: input.eventId, certainty: input.certainty,
      status: "analyst-assessed", tenure: input.tenure, validFrom: input.validFrom ? new Date(input.validFrom) : null,
      validTo: input.validTo ? new Date(input.validTo) : null, supersedesId: input.supersedesId, disputesId: input.disputesId });
    if (input.predicate === "alias") {
      if (!input.value?.trim()) throw new Error("An alias needs its evidenced spelling");
      await tx.update(entities).set({ aliases: [...new Set([...subject.aliases, input.value.trim()])] }).where(eq(entities.id, subject.id));
    }
    if (input.predicate === "identifier") {
      if (!input.value?.match(/^[a-zA-Z0-9_-]{1,40}:.{1,200}$/)) throw new Error("Use namespace:identifier");
      const [namespace, ...rest] = input.value.split(":");
      await tx.insert(entityIdentifiers).values({ id: uid(), workspace: W, entityId: subject.id, namespace: namespace!, value: rest.join(":"), evidenceId });
    }
    await logDecision(tx, subject.id, "shared-workspace-analyst", input.supersedesId ? "supersede-assertion" : "add-evidence",
      input.scope, {}, { predicate: input.predicate, supersedesId: input.supersedesId ?? null }, [evidenceId], {}, config.policyVersion);
    if (!!input.eventKey !== !!input.claimKey) throw new Error("Both event and material claim keys are required for triage");
    if (input.eventKey && input.claimKey) {
      await recordDevelopment(tx, { entityId: subject.id, evidenceId, eventKey: input.eventKey, claimKey: input.claimKey,
        title: input.scope, novelty: input.novelty ?? "unknown", consequence: input.consequence ?? 0,
        certainty: input.certainty, relation: input.relation ?? "unknown",
        assessed: !!input.sourcingRationale && !!input.originKey && !!input.independentlyReported,
        complete: capture.complete, mode: config.mode, policyVersion: config.policyVersion });
      if (input.novelty === "material" || input.novelty === "correction") {
        await tx.update(entities).set({ lastDevelopment: new Date(), nextReview: new Date(Date.now() + 30 * 86400000) }).where(eq(entities.id, subject.id));
      }
    }
    return (await evidenceRows([evidenceId], tx))[0]!;
  });
}

export async function recordDevelopment(tx: Tx, input: { entityId: string; evidenceId: string; eventKey: string; claimKey: string;
  title: string; novelty: string; consequence: number; certainty: string; relation: string; assessed: boolean; complete: boolean; mode: string; policyVersion: string }) {
  const id = key(W, "development", input.eventKey.trim().toLowerCase(), input.claimKey.trim().toLowerCase());
  const subject = await requireEntity(input.entityId, tx);
  const disposition = triage({ ...input, mode: subject.state === "Archived" ? "observe" : input.mode });
  // Same event+material claim is one development, even across twenty copies.
  await tx.insert(developments).values({ id, workspace: W, eventKey: input.eventKey, claimKey: input.claimKey, title: input.title.slice(0, 500),
    explanation: `${input.novelty}; ${input.relation}; ${input.assessed ? "analyst-assessed source lineage" : "source independence unknown"}. ${input.mode === "observe" ? "Observe-only: review proposal, no Immediate alert." : ""}`,
    disposition, entityIds: [input.entityId], policyVersion: input.policyVersion }).onConflictDoNothing();
  const [current] = await tx.select().from(developments).where(eq(developments.id, id)).for("update");
  if (current && !current.entityIds.includes(input.entityId))
    await tx.update(developments).set({ entityIds: [...current.entityIds, input.entityId] }).where(eq(developments.id, id));
  await tx.insert(observations).values({ id: key(id, input.evidenceId), workspace: W, developmentId: id, evidenceId: input.evidenceId, novelty: input.novelty }).onConflictDoNothing();
  return id;
}

export async function decide(id: string, input: ActionInput) {
  return db.transaction(async tx => {
    const config = await settings(tx, true); // Same lock as worker commits and pause.
    const current = await requireEntity(id, tx, true);
    const evidenceIds = [...new Set(input.evidenceIds ?? [])];
    const refs = await evidenceRows(evidenceIds, tx);
    if (refs.length !== evidenceIds.length) throw new Error("Evidence reference is missing or outside this workspace");
    // Evidence must belong to this subject, not another entity's unrelated passage.
    if (evidenceIds.length) {
      const links = await tx.select().from(assertions).where(and(scoped(assertions), eq(assertions.subjectId, id), inArray(assertions.evidenceId, evidenceIds)));
      if (evidenceIds.some(e => !links.some(a => a.evidenceId === e && a.status !== "retracted")))
        throw new Error("Supporting evidence must be attached to this subject");
    }
    const change: Partial<typeof entities.$inferInsert> = {};
    if (input.action === "rename") {
      if (!input.name?.trim()) throw new Error("Choose a canonical display name");
      change.name = input.name.trim();
    }
    const factors = dimensions(input.dimensions);
    if (input.action === "pin" || input.action === "unpin") change.pinned = input.action === "pin";
    if (input.action === "archive") change.state = "Archived";
    if (["monitor", "reactivate", "reassess"].includes(input.action)) {
      const state = input.state ?? (input.action === "reassess" ? current.state : "Active");
      if (["Active", "Watch"].includes(state) && !refs.length) throw new Error("Monitoring requires supporting evidence");
      for (const ref of refs) {
        if (!ref.capture || !exactEvidence((await readContent(ref.capture.hash)).text, ref.excerpt, ref.start, ref.end)) throw new Error("Broken source evidence");
      }
      change.state = state; change.classification = input.classification ?? current.classification;
      if (change.classification === "structural" && !["organization", "position"].includes(current.type)) throw new Error("People cannot be permanent structural anchors");
      change.priority = input.priority ?? current.priority;
      change.unresolved = input.unresolved ?? current.unresolved;
      change.rationale = input.rationale;
      change.nextReview = new Date(Date.now() + (input.action === "reassess" ? 90 : 30) * 86400000);
    }
    if (["resolve", "reject"].includes(input.action)) {
      if (!input.candidateId) throw new Error("Choose a candidate");
      const [candidate] = await tx.select().from(candidates).where(and(scoped(candidates), eq(candidates.id, input.candidateId), eq(candidates.entityId, id))).for("update");
      if (!candidate || candidate.resolution !== "pending") throw new Error("Candidate already resolved or not found");
      await tx.update(candidates).set({ resolution: input.action === "resolve" ? "distinct" : "rejected", identityConfidence: input.action === "resolve" ? "analyst-resolved" : "rejected" }).where(eq(candidates.id, candidate.id));
    }
    if (input.action === "merge") {
      if (!input.targetId || input.targetId === id) throw new Error("Choose another resolved entity");
      const target = await requireEntity(input.targetId, tx, true);
      if (target.type !== current.type || target.redirectId || current.redirectId) throw new Error("Merge requires two unredirected entities of the same type");
      if (!refs.length) throw new Error("Identity merge requires evidence and analyst rationale");
      change.redirectId = target.id;
    }
    if (input.action === "unmerge") change.redirectId = null;
    if (input.action === "correct") {
      if (!input.assertionId) throw new Error("Choose the assertion to retract; add corrected evidence as a superseding assertion");
      const [old] = await tx.select().from(assertions).where(and(scoped(assertions), eq(assertions.subjectId, id), eq(assertions.id, input.assertionId))).for("update");
      if (!old) throw new Error("Assertion not found");
      await tx.update(assertions).set({ status: "retracted" }).where(eq(assertions.id, old.id));
      await logDecision(tx, id, "shared-workspace-analyst", "retract-assertion", input.rationale, old, { status: "retracted" }, [old.evidenceId], {}, config.policyVersion);
      change.state = current.classification === "structural" ? current.state : "Discovered";
      change.nextReview = new Date();
    }
    await tx.update(entities).set(Object.keys(change).length ? change : { rationale: current.rationale }).where(eq(entities.id, id));
    await logDecision(tx, id, "shared-workspace-analyst", input.action, input.rationale, current, change,
      evidenceIds, factors, config.policyVersion);
    return requireEntity(id, tx);
  });
}
