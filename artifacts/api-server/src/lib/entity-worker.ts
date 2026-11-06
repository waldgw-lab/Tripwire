import { db, entityIdentifiers } from "@workspace/db";
import { and, eq, sql, inArray, or, lte } from "drizzle-orm";
import { entities, captures, evidence, assertions, candidates, lineage, automation, jobs,
  W, uid, key, settings, scoped, syncCaptures, logDecision, type Tx } from "./entity-db";
import { extractCapture, providerConfig, RESERVED_TOKENS, MAX_EXCERPT, type ExtractionResult } from "./entity-extractor";
import { readContent } from "./tripwire-content-storage";
import { recordDevelopment } from "./entity-actions";
import { logger } from "./logger";

const worker = uid();
const LEASE_MS = 90000;
const MAX_ATTEMPTS = 3;
const running = new Map<string, AbortController>();
export function abortEntityCalls() { for (const controller of running.values()) controller.abort(); }
export async function enqueueCaptures() {
  return db.transaction(async tx => {
    const config = await settings(tx, true);
    const [size] = await tx.select({ count: sql<number>`count(*)::int` }).from(jobs)
      .where(and(scoped(jobs), inArray(jobs.status, ["queued", "leased", "deferred", "unconfigured"])));
    if ((size?.count ?? 0) >= 1000) return 0;
    const rows = await tx.select({ capture: captures }).from(captures).leftJoin(jobs,
      and(eq(jobs.captureId, captures.id), eq(jobs.workspace, captures.workspace), eq(jobs.policyVersion, config.policyVersion)))
      .where(and(scoped(captures), eq(captures.authorized, true), sql`${jobs.id} is null`)).limit(Math.min(100, 1000 - (size?.count ?? 0)));
    for (const { capture } of rows) {
      await tx.insert(jobs).values({ id: key(W, capture.id, config.policyVersion), workspace: W,
        captureId: capture.id, policyVersion: config.policyVersion }).onConflictDoNothing();
    }
    return rows.length;
  });
}
export async function leaseJob(owner = worker, providerOverride?: { cost: number } | null, onlyJobId?: string) {
  return db.transaction(async tx => {
    const config = await settings(tx, true);
    if (config.mode === "paused" || !config.authorized || config.failures >= 5) return null;
    const now = new Date();
    const [job] = await tx.select().from(jobs).where(and(scoped(jobs), onlyJobId ? eq(jobs.id, onlyJobId) : undefined, lte(jobs.nextRun, now),
      or(inArray(jobs.status, ["queued", "deferred", "unconfigured"]), and(eq(jobs.status, "leased"), lte(jobs.leaseUntil, now)))))
      .orderBy(jobs.nextRun).for("update", { skipLocked: true }).limit(1);
    if (!job) return null;
    if (job.attempts >= MAX_ATTEMPTS) {
      await tx.update(jobs).set({ status: "dead", error: "Retry ceiling reached", leaseOwner: null, leaseUntil: null }).where(eq(jobs.id, job.id));
      return null;
    }
    const provider = providerOverride === undefined ? providerConfig() : providerOverride;
    if (!provider) {
      await tx.update(jobs).set({ status: "unconfigured", error: "Provider unconfigured; no external call made", nextRun: new Date(Date.now() + 60000) }).where(eq(jobs.id, job.id));
      return null;
    }
    const [capture] = await tx.select().from(captures).where(and(scoped(captures), eq(captures.id, job.captureId)));
    if (!capture?.authorized) {
      await tx.update(jobs).set({ status: "excluded", error: "Capture processing not authorized" }).where(eq(jobs.id, job.id)); return null;
    }
    const day = now.toISOString().slice(0, 10);
    const usedTokens = config.budgetDay === day ? config.usedTokens : 0;
    const usedMicros = config.budgetDay === day ? config.usedMicros : 0;
    if (usedTokens + RESERVED_TOKENS > config.dailyTokens || usedMicros + provider.cost > config.dailyMicros) {
      const tomorrow = new Date(now); tomorrow.setUTCHours(24, 0, 0, 0);
      await tx.update(jobs).set({ status: "deferred", error: "Hard daily budget exhausted; no call made", nextRun: tomorrow }).where(eq(jobs.id, job.id));
      return null;
    }
    // Reserve worst case before calling; uncertain charges are never refunded.
    await tx.update(automation).set({ budgetDay: day, usedTokens: usedTokens + RESERVED_TOKENS, usedMicros: usedMicros + provider.cost }).where(eq(automation.workspace, W));
    const [leased] = await tx.update(jobs).set({ status: "leased", leaseOwner: owner, leaseUntil: new Date(Date.now() + LEASE_MS),
      epoch: config.epoch, attempts: job.attempts + 1, tokens: job.tokens + RESERVED_TOKENS,
      costMicros: job.costMicros + provider.cost, checkpoint: "budget-reserved", error: null }).where(eq(jobs.id, job.id)).returning();
    return { job: leased!, capture };
  });
}
// All writes plus job completion are one transaction, fenced by owner/epoch/expiry.
export async function commitExtraction(jobId: string, result: ExtractionResult, owner = worker) {
  return db.transaction(async tx => {
    const config = await settings(tx, true);
    const [job] = await tx.select().from(jobs).where(and(scoped(jobs), eq(jobs.id, jobId))).for("update");
    if (!job || job.status !== "leased" || job.leaseOwner !== owner || !job.leaseUntil
      || job.leaseUntil.getTime() <= Date.now() || job.epoch !== config.epoch || config.mode === "paused" || !config.authorized)
      return false;
    const [capture] = await tx.select().from(captures).where(and(scoped(captures), eq(captures.id, job.captureId)));
    if (!capture?.authorized) return false;
    const { text } = await readContent(capture.hash);
    // Revalidate at commit, independent of provider adapter.
    const { validateExtraction } = await import("./entity-extractor");
    validateExtraction(result, text.slice(0, MAX_EXCERPT));
    const ids: (string | null)[] = [];
    // Each capture-specific discovery remains a candidate unless analyst-resolved.
    // Name equality/LLM confidence never silently merges namesakes.
    for (let i = 0; i < result.actors.length; i++) {
      const a = result.actors[i]!;
      const credited = (capture.byline ?? "").toLowerCase().includes(a.name.toLowerCase());
      const anonymous = /^(an? |the )?(unnamed|anonymous|unidentified)\b/i.test(a.name);
      if (a.sourceOnly || credited || anonymous) { ids.push(null); continue; }
      const identifierHints = a.externalNamespace && a.externalValue ? await tx.select({ entityId: entityIdentifiers.entityId }).from(entityIdentifiers)
        .where(and(scoped(entityIdentifiers), eq(entityIdentifiers.namespace, a.externalNamespace), eq(entityIdentifiers.value, a.externalValue))).limit(1) : [];
      // A value occurring in a quote does not prove it identifies this subject.
      // Model-suggested identifiers are review hints only, even if the existing
      // registry identifier was analyst-verified. Never write to that identity.
      const id = key(W, "discovery", capture.id, String(i), a.name, a.type);
      ids.push(id);
      await tx.insert(entities).values({ id, workspace: W, name: a.name, type: a.type, facets: [a.category], rationale: a.rationale,
        state: "Discovered", nextReview: new Date(Date.now() + 30 * 86400000) }).onConflictDoNothing();
      const matches = await tx.select({ id: entities.id }).from(entities).where(and(scoped(entities), eq(entities.type, a.type),
        sql`(lower(${entities.name}) = lower(${a.name}) or exists(select 1 from unnest(${entities.aliases}) alias where lower(alias)=lower(${a.name})))`,
        sql`${entities.id} <> ${id}`)).limit(5);
      const evidenceId = key(id, capture.id, job.policyVersion, "passage");
      await tx.insert(evidence).values({ id: evidenceId, workspace: W, captureId: capture.id, excerpt: a.excerpt,
        start: a.start, end: a.end, attribution: a.attribution, certainty: a.certainty, scope: a.rationale,
        extractorVersion: "structured-v1", policyVersion: job.policyVersion }).onConflictDoNothing();
      await tx.insert(lineage).values({ id: key(evidenceId, "lineage"), workspace: W, evidenceId, relation: "unknown",
        independentlyReported: false, rationale: "Model output cannot establish reporting origin or independence", assessedBy: "automation" }).onConflictDoNothing();
      await tx.insert(candidates).values({ id: key(id, capture.id, "candidate"), workspace: W, entityId: id, matchId: identifierHints[0]?.entityId ?? matches[0]?.id,
        evidenceId, reason: identifierHints.length ? "Model-proposed identifier match: its attribution to this subject is unvalidated; analyst review required"
          : matches.length ? "Matching names/aliases require analyst identity resolution; no automatic merge"
          : capture.complete ? "Identity and substantive sourcing require analyst review" : "Partial capture; identity, completeness and sourcing require review",
        resolution: "pending", identityConfidence: "unresolved" }).onConflictDoNothing();
      await logDecision(tx, id, "automation", "discover", a.rationale, {}, { state: "Discovered", reviewReason: "No validated subject-identifier linkage or analyst-assessed lineage for this passage" },
        [evidenceId], a.factors, job.policyVersion);
      if (a.eventKey && a.claimKey) await recordDevelopment(tx, { entityId: id, evidenceId, eventKey: `candidate:${a.eventKey}`,
        claimKey: `${a.claimKey}:${key(a.excerpt.replace(/\s+/g, " ").toLowerCase())}`,
        title: a.rationale, novelty: a.novelty, consequence: a.consequence, certainty: a.certainty,
        relation: "unknown", assessed: false, complete: capture.complete, mode: config.mode, policyVersion: job.policyVersion });
    }
    for (let i = 0; i < result.actors.length; i++) {
      const a = result.actors[i]!, id = ids[i];
      if (!id) continue;
      const objectId = a.objectIndex === null ? null : ids[a.objectIndex] ?? null;
      if (a.objectIndex !== null && !objectId) continue; // Never make a source into an identified subject.
      if (a.predicate === "occupies" && (a.type !== "person" || a.objectIndex === null || result.actors[a.objectIndex]?.type !== "position")) continue;
      await tx.insert(assertions).values({ id: key(id, capture.id, job.policyVersion, "assertion"), workspace: W, subjectId: id, predicate: a.predicate,
        objectId, evidenceId: key(id, capture.id, job.policyVersion, "passage"), certainty: a.certainty, status: "candidate",
        tenure: a.tenure, validFrom: a.validFrom ? new Date(a.validFrom) : null, validTo: a.validTo ? new Date(a.validTo) : null }).onConflictDoNothing();
    }
    await tx.update(jobs).set({ status: "complete", completedAt: new Date(), checkpoint: "proposals-committed", leaseOwner: null, leaseUntil: null }).where(eq(jobs.id, job.id));
    await tx.update(automation).set({ lastSuccess: new Date(), failures: 0 }).where(eq(automation.workspace, W));
    return true;
  });
}
export async function failJob(jobId: string) {
  await db.transaction(async tx => {
    const config = await settings(tx, true);
    const [job] = await tx.select().from(jobs).where(and(scoped(jobs), eq(jobs.id, jobId))).for("update");
    if (!job || job.status !== "leased" || job.leaseOwner !== worker || job.epoch !== config.epoch) return;
    await tx.update(jobs).set({ status: job.attempts >= MAX_ATTEMPTS ? "dead" : "queued",
      nextRun: new Date(Date.now() + 60000 * 2 ** job.attempts), leaseOwner: null, leaseUntil: null, error: "Extraction failed validation or provider unavailable; review before retry" }).where(eq(jobs.id, job.id));
    await tx.update(automation).set({ failures: config.failures + 1 }).where(eq(automation.workspace, W));
  });
}
let busy = false;
export async function runEntityTick() {
  if (busy) return;
  busy = true;
  try {
    await syncCaptures();
    await enqueueCaptures();
    const { reassessEntities } = await import("./entity-relevance");
    await reassessEntities();
    const lease = await leaseJob();
    if (!lease) return;
    // No arbitrary URL fetch, registry, notes or prompts beyond this approved excerpt.
    const controller = new AbortController();
    running.set(lease.job.id, controller);
    const renewal = setInterval(() => void renewLease(lease.job.id).then(ok => { if (!ok) controller.abort(); }).catch(() => controller.abort()), 20000);
    try {
      const fresh = await settings();
      if (fresh.epoch !== lease.job.epoch || fresh.mode === "paused" || !fresh.authorized) return;
      const text = (await readContent(lease.capture.hash)).text.slice(0, MAX_EXCERPT);
      const result = await extractCapture(text, controller.signal);
      await commitExtraction(lease.job.id, result);
    } catch { await failJob(lease.job.id); }
    finally { clearInterval(renewal); running.delete(lease.job.id); }
  } finally { busy = false; }
}
export async function renewLease(id: string, owner = worker) {
  return db.transaction(async tx => {
    const config = await settings(tx, true);
    if (config.mode === "paused" || !config.authorized) return false;
    const updated = await tx.update(jobs).set({ leaseUntil: new Date(Date.now() + LEASE_MS) }).where(and(scoped(jobs),
      eq(jobs.id, id), eq(jobs.status, "leased"), eq(jobs.leaseOwner, owner), eq(jobs.epoch, config.epoch),
      sql`${jobs.leaseUntil} > now()`)).returning({ id: jobs.id });
    return updated.length === 1;
  });
}
export function startEntityWorker() {
  const tick = () => void runEntityTick().catch(() => logger.error("Entity worker unavailable; retained evidence and relevance unchanged"));
  tick(); const timer = setInterval(tick, 30000); timer.unref();
}
