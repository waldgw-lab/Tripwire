import { and, eq, desc, inArray, sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { entities, assertions, decisions, candidates, W, settings, scoped, logDecision, evidenceRows } from "./entity-db";
import { promotionGate, dimensions, canAutoArchive, FACTORS } from "./entity-policy";
import { activationBlockers } from "./entity-operations";
import { readContent } from "./tripwire-content-storage";
import { exactEvidence } from "./entity-policy";
import { recordsFor } from "./tripwire-store";

// Only analyst-assessed passage/lineage can satisfy an automatic gate. This is
// deliberately conservative: a model may propose features but cannot assess
// originality, assert an anchor or override an analyst lock.
export async function reassessEntities() {
  if ((await activationBlockers()).length) return;
  const records = await recordsFor(W, false);
  const outlets = records.filter(r => r.kind === "outlet" && r.enabled !== false);
  const collectionHealthy = outlets.length > 0 && outlets.every(r =>
    (r.feedHealth ?? []).some(h => h.status === "connected" && Date.now() - Date.parse(h.checkedAt ?? "") < 86400000));
  await db.transaction(async tx => {
    const config = await settings(tx, true);
    if (config.mode !== "autonomous" || !config.authorized) return;
    const rows = await tx.select().from(entities).where(and(scoped(entities), eq(entities.pinned, false),
      sql`${entities.redirectId} is null`)).orderBy(entities.nextReview, entities.id).limit(50).for("update", { skipLocked: true });
    for (const entity of rows) {
      const links = await tx.select().from(assertions).where(and(scoped(assertions), eq(assertions.subjectId, entity.id))).orderBy(desc(assertions.recordedAt)).limit(100);
      const superseded = new Set(links.flatMap(a => a.supersedesId ? [a.supersedesId] : []));
      const live = links.filter(a => !superseded.has(a.id) && a.status === "analyst-assessed");
      const refs = await evidenceRows(live.map(a => a.evidenceId), tx);
      const resolution = await tx.select().from(candidates).where(and(scoped(candidates), eq(candidates.entityId, entity.id)));
      const resolved = resolution.length === 0 ? refs.length > 0 : resolution.every(c => c.resolution === "distinct");
      const reviewed = await tx.select().from(decisions).where(and(scoped(decisions), eq(decisions.entityId, entity.id),
        eq(decisions.origin, "shared-workspace-analyst"), inArray(decisions.action, ["monitor", "reassess"]))).orderBy(desc(decisions.createdAt)).limit(1);
      const latest = reviewed[0];
      const factors = dimensions(latest?.dimensions ?? {});
      const score = FACTORS.reduce((sum, k) => sum + (factors[k] ?? 0) * (config.policy[k] ?? 1), 0);
      const authoritative = live.filter(a => a.predicate === "occupies" && a.objectId);
      let appointment = false;
      for (const a of authoritative) {
        const [anchor] = await tx.select().from(entities).where(and(scoped(entities), eq(entities.id, a.objectId!)));
        const approved = anchor && await tx.select({ id: decisions.id }).from(decisions).where(and(scoped(decisions), eq(decisions.entityId, anchor.id),
          eq(decisions.origin, "shared-workspace-analyst"), inArray(decisions.action, ["monitor", "reassess"]))).limit(1);
        const ref = refs.find(e => e.id === a.evidenceId);
        if (!ref) continue;
        const valid = exactEvidence((await readContent(ref.capture.hash)).text, ref.excerpt, ref.start, ref.end);
        appointment ||= promotionGate({ valid, complete: ref.capture.complete, resolved,
          assessed: ref.lineage?.assessedBy === "shared-workspace-analyst" && !!ref.lineage.rationale,
          substantive: true, route: ref.lineage?.relation ?? "unknown", certainty: a.certainty, tenure: a.tenure,
          approvedAnchor: anchor?.classification === "structural" && anchor.type === "position" && !!approved?.length });
      }
      const sources = refs.filter(e => e.lineage?.assessedBy === "shared-workspace-analyst" && e.lineage.independentlyReported && e.lineage.originKey);
      const origins = [...new Set(sources.map(e => e.lineage!.originKey!))];
      let substantive = false;
      for (const ref of sources) {
        substantive ||= promotionGate({ valid: exactEvidence((await readContent(ref.capture.hash)).text, ref.excerpt, ref.start, ref.end),
          complete: ref.capture.complete, resolved, assessed: true, substantive: score >= (config.policy.promotion ?? 12),
          route: ref.lineage!.relation, certainty: ref.certainty, independentAdditions: sources.every(e => e.lineage!.relation === "addition"),
          origins });
      }
      const currentAuthority = live.some(a => a.predicate === "occupies" && a.certainty === "confirmed"
        && ["current", "acting", "interim", "concurrent"].includes(a.tenure ?? "") && (!a.validTo || a.validTo.getTime() >= Date.now()));
      const newest = refs.map(r => r.recordedAt.getTime()).sort((a, b) => b - a)[0] ?? 0;
      const archiveDecision = await tx.select().from(decisions).where(and(scoped(decisions), eq(decisions.entityId, entity.id),
        eq(decisions.action, "archive"))).orderBy(desc(decisions.createdAt)).limit(1);
      const canReactivate = entity.state !== "Archived" || newest > (archiveDecision[0]?.createdAt.getTime() ?? entity.createdAt.getTime());
      if ((appointment || substantive) && canReactivate && entity.state !== "Active") {
        const change = { state: "Active", lastDevelopment: new Date(newest || Date.now()), nextReview: new Date(Date.now() + 30 * 86400000) };
        await tx.update(entities).set(change).where(eq(entities.id, entity.id));
        await logDecision(tx, entity.id, "automation", entity.state === "Archived" ? "reactivate" : "promote",
          appointment ? "Confirmed sourced assumption of an analyst-approved anchor position" : "Substantive analyst-assessed reporting meets calibrated relevance threshold",
          entity, change, sources.length ? sources.map(e => e.id) : refs.map(e => e.id), factors, config.policyVersion);
      } else if (entity.nextReview && entity.nextReview.getTime() < Date.now()) {
        const noDevelopment90 = !!entity.lastDevelopment && entity.lastDevelopment.getTime() < Date.now() - 90 * 86400000;
        // No automatic archive from outage, missing content, or unresolved issues.
        const archive = entity.state === "Watch" && noDevelopment90 && latest?.action === "reassess"
          && canAutoArchive(entity, currentAuthority, collectionHealthy);
        const change = { state: archive ? "Archived" : entity.state, nextReview: new Date(Date.now() + 90 * 86400000) };
        await tx.update(entities).set(change).where(eq(entities.id, entity.id));
        await logDecision(tx, entity.id, "automation", archive ? "archive" : "review-due",
          archive ? "Reviewed Watch actor: no unresolved issue/current role; collection healthy and no substantive development in 90 days"
            : "Review retained; missing coverage or unresolved authority never counts as declining relevance",
          entity, change, refs.map(e => e.id), factors, config.policyVersion);
      }
    }
  });
}
