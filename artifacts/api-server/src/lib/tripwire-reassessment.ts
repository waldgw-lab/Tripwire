import { db, tripwireRecords } from "@workspace/db";
import { and, eq, gt, inArray, asc, sql, or } from "drizzle-orm";
import { archiveArticle, readContent } from "./tripwire-content-storage";
import { appendFeedback, articleLock, classificationSnapshot } from "./tripwire-feedback";
import { IMPACT_POLICY_VERSION } from "./tripwire-impact-policy";
import { mentionedEntities } from "./tripwire-signals";
import type { RecordData } from "./tripwire-store";
import { logger } from "./logger";

function priorSnapshot(data: RecordData, field: "impact" | "topic", watches: RecordData[]) {
  const snapshot = classificationSnapshot(data, field);
  if (field !== "impact" || data.automaticAssessment || data.impact) return snapshot;
  // Historical display policy only: this must never be used for new decisions.
  const normalize = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  const mentions = (text: string, term: string) => normalize(term).length > 2 && ` ${normalize(text)} `.includes(` ${normalize(term)} `);
  const relevant = watches.filter(w => w.enabled !== false && ["position", "person", "organization"].includes(w.watchType ?? ""));
  const names = (w: RecordData) => [w.title, w.individual ?? "", w.position ?? "", ...w.aliases ?? []];
  const text = `${data.title} ${data.summary ?? ""}`;
  const effective = data.reportingType === "original" || relevant.some(w => w.tier === 1 && names(w).some(n => mentions(data.title, n))) ? "critical"
    : data.reportingType === "independent" || relevant.some(w => names(w).some(n => mentions(text, n) || data.entities?.some(e => normalize(e) === normalize(n)))) ||
      ["blame", "performance", "replacement", "decision-making", "institutional"].includes(data.focus ?? "") ? "high" : "low";
  return { ...snapshot, effective, origin: "automatic",
    automatic: { policyVersion: "legacy-browser-prominence", impact: effective, topic: data.topic ?? "Politics", relevance: "review" as const,
      confidence: "limited" as const, explanation: "Historical browser policy used watch/name, focus and sourcing-type labels; not verified sourcing or a current policy judgment.", evidence: [] } };
}

/** Bounded durable cursor; each batch is independently resumable and retry-safe. */
export async function reassessArchiveBatch(owner = "workspace", batchSize = 40) {
  return db.transaction(async tx => {
    await articleLock(tx, owner);
    const jobId = `classification-job:${owner}:${IMPACT_POLICY_VERSION}`;
    const [job] = await tx.select().from(tripwireRecords).where(eq(tripwireRecords.id, jobId));
    const cursor = String(job?.data.cursor ?? "");
    const rows = await tx.select().from(tripwireRecords).where(and(eq(tripwireRecords.kind, "article"),
      inArray(tripwireRecords.owner, ["public", owner]), or(gt(tripwireRecords.id, cursor),
        sql`coalesce(${tripwireRecords.data}->'automaticAssessment'->>'policyVersion', '') <> ${IMPACT_POLICY_VERSION}`))).orderBy(asc(tripwireRecords.id)).limit(Math.min(100, Math.max(1, batchSize)));
    const watches = await tx.select().from(tripwireRecords).where(and(eq(tripwireRecords.kind, "watch"), inArray(tripwireRecords.owner, ["public", owner])));
    const changes = { impact: 0, topic: 0, entities: 0, review: 0 };
    for (const row of rows) {
      const previous = row.data as RecordData;
      const articleId = String(row.data.baseId ?? row.id);
      let data = { ...previous };
      if (!data.topicMode && row.owner === owner && data.topic) {
        const [base] = await tx.select().from(tripwireRecords).where(eq(tripwireRecords.id, articleId));
        const [priorPublic] = await tx.select().from(tripwireRecords).where(eq(tripwireRecords.id,
          `feedback:${owner}:${articleId}:reassess:${IMPACT_POLICY_VERSION}:public:topic`));
        const originalPublicTopic = (priorPublic?.data.snapshot as RecordData | undefined)?.topic ?? base?.data.topic;
        // Legacy provenance is imperfect: preserve potentially manual topic edits.
        if (!base || originalPublicTopic !== data.topic) data.topicMode = "manual";
      }
      data = await archiveArticle(data);
      const text = data.fullTextHash ? (await readContent(data.fullTextHash)).text : previous.fullText ?? "";
      const entities = mentionedEntities(`${data.title}\n${text || data.summary || ""}`, watches.map(w => w.data as RecordData));
      // Analyst workspace entity edits are not silently removed; public derived
      // tags are recomputed from the current retained article-owned text.
      if (row.owner === "public") data.entities = entities;
      else {
        const [priorPublic] = await tx.select().from(tripwireRecords).where(eq(tripwireRecords.id,
          `feedback:${owner}:${articleId}:reassess:${IMPACT_POLICY_VERSION}:public:entities`));
        const originalPublicEntities = (priorPublic?.data.snapshot as RecordData | undefined)?.entities;
        if (originalPublicEntities && JSON.stringify(originalPublicEntities) === JSON.stringify(previous.entities)) data.entities = entities;
      }
      if (data.automaticAssessment?.relevance === "review" || data.automaticAssessment?.confidence !== "high") changes.review++;
      const fields = (["impact", "topic"] as const).filter(field => JSON.stringify(classificationSnapshot(previous, field)) !== JSON.stringify(classificationSnapshot(data, field)));
      const entityChange = JSON.stringify(previous.entities ?? []) !== JSON.stringify(data.entities ?? []);
      if (fields.length || entityChange) {
        data.classificationRevision = (previous.classificationRevision ?? 0) + 1;
        // Compare-and-swap protects concurrent feed collectors that don't use
        // the workspace mutation lock. Failed comparisons are retried next pass.
        const updated = await tx.update(tripwireRecords).set({ data, updatedAt: new Date() }).where(and(eq(tripwireRecords.id, row.id),
          sql`${tripwireRecords.data} = ${JSON.stringify(previous)}::jsonb`)).returning();
        if (!updated.length) throw new Error("Concurrent archive change; retry this batch");
        for (const field of fields) {
          const before = priorSnapshot(previous, field, watches.map(w => w.data as RecordData));
          if (before.effective !== data[field]) changes[field]++;
          const requestKey = `reassess:${IMPACT_POLICY_VERSION}:${row.owner}:${field}`;
          const [priorEvent] = await tx.select({ id: tripwireRecords.id }).from(tripwireRecords).where(eq(tripwireRecords.id, `feedback:${owner}:${articleId}:${requestKey}`));
          await appendFeedback(tx, owner, articleId, previous, { action: "system-correction", actor: "System", field,
            before, after: classificationSnapshot(data, field),
            reason: `Automatic retained-text reassessment (${IMPACT_POLICY_VERSION}); analyst overrides preserved`,
            requestId: priorEvent ? `${requestKey}:${data.classificationRevision}` : requestKey });
        }
        if (entityChange) {
          changes.entities++;
          await appendFeedback(tx, owner, articleId, previous, { action: "system-correction", actor: "System", field: "entities",
            before: { raw: previous.entities?.join(", "), effective: previous.entities?.join(", ") ?? "", mode: "auto" },
            after: { raw: data.entities?.join(", "), effective: data.entities?.join(", ") ?? "", mode: "auto" },
            reason: "Recomputed public entity tags from current retained article text; credits and generic roles excluded",
            requestId: `reassess:${IMPACT_POLICY_VERSION}:${row.owner}:entities` });
        }
      }
    }
    const cumulative = Object.fromEntries(Object.entries(changes).map(([key, value]) => [key, Number(job?.data[key] ?? 0) + value]));
    const state = { cursor: [rows.at(-1)?.id ?? cursor, cursor].sort().at(-1)!, processed: Number(job?.data.processed ?? 0) + rows.length,
      done: rows.length < batchSize, policyVersion: IMPACT_POLICY_VERSION, ...cumulative };
    await tx.insert(tripwireRecords).values({ id: jobId, owner, kind: "classification-job", data: state })
      .onConflictDoUpdate({ target: tripwireRecords.id, set: { data: state, updatedAt: new Date() } });
    return state;
  });
}
export function startArchiveReassessment() {
  const run = async () => {
    try {
      const state = await reassessArchiveBatch();
      if (!state.done) setTimeout(() => { void run(); }, 1000).unref();
      else logger.info(state, "Archive classification reassessment complete");
    } catch (err) {
      logger.warn({ err }, "Archive reassessment paused; next startup or explicit runner resumes its durable cursor");
    }
  };
  void run();
}
