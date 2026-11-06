import { readFile } from "node:fs/promises";
import { and, eq, sql, inArray } from "drizzle-orm";
import { db, entityControlLog } from "@workspace/db";
import { ControlEntityAutomationBody } from "@workspace/api-zod";
import { automation, jobs, captures, entities, W, settings, scoped, syncCaptures } from "./entity-db";
import { providerConfig } from "./entity-extractor";
import { enqueueCaptures, abortEntityCalls } from "./entity-worker";
import path from "node:path";

export async function activationBlockers() {
  // Operator-maintained verification record, not a user identity/auth bypass.
  // Browser API deliberately cannot write it. Evidence must be recorded after
  // actual signed-out production tests and reviewed reporting calibration.
  let record: Record<string, unknown> = {};
  try {
    // Run commands use the artifact directory; source tests may use repo root.
    record = JSON.parse(await readFile(path.resolve(process.cwd(), process.cwd().endsWith("/artifacts/api-server") ? "../../docs/entity-automation-release.json" : "docs/entity-automation-release.json"), "utf8"));
  } catch { /* Verification is unmet, never assumed. */ }
  const required = [
    ["privateAccessVerification", "Published private-access verification has not been recorded"],
    ["qualityCalibration", "Reviewed reporting calibration and security fixtures are not approved"],
    ["alwaysOnVerification", "Always-on worker hosting has not been verified"],
    ["activationApproval", "Explicit autonomous activation approval has not been recorded"],
  ];
  const blockers = required.filter(([field]) => typeof record[field!] !== "string" || String(record[field!]).trim().length < 20).map(([, message]) => message!);
  const config = await settings();
  if (record.policyVersion !== config.policyVersion) blockers.push("Quality approval must identify the current policy version");
  if (!providerConfig()) blockers.push("Extraction provider and per-call cost cap are unconfigured");
  return blockers;
}
export async function health(offset = 0) {
  const config = await settings();
  const counts = await db.select({ status: jobs.status, count: sql<number>`count(*)::int` }).from(jobs).where(scoped(jobs)).groupBy(jobs.status);
  const captureCounts = await db.select({ total: sql<number>`count(*)::int`,
    incomplete: sql<number>`count(*) filter(where not ${captures.complete})::int`,
    excluded: sql<number>`count(*) filter(where not ${captures.authorized})::int` }).from(captures).where(scoped(captures));
  const recent = await db.select().from(jobs).where(scoped(jobs)).orderBy(sql`${jobs.createdAt} desc`, jobs.id).limit(30).offset(offset);
  const day = new Date().toISOString().slice(0, 10);
  return { ...config, usedTokens: config.budgetDay === day ? config.usedTokens : 0,
    usedMicros: config.budgetDay === day ? config.usedMicros : 0,
    provider: providerConfig() ? "configured" : "unconfigured",
    jobs: recent, counts: Object.fromEntries(counts.map(c => [c.status, c.count])), captureCounts: captureCounts[0] ?? {},
    activationBlockers: await activationBlockers(),
    scheduling: config.failures >= 5 ? "Circuit breaker open: fix provider/validation failures, then resume observe-only"
      : "SQL queue polled every 30 seconds while API service runs. Sleeping hosting does not process jobs." };
}
export async function control(input: ReturnType<typeof ControlEntityAutomationBody.parse>) {
  const blockers = input.action === "activate" ? await activationBlockers() : [];
  if (blockers.length) throw new Error(blockers.join("; "));
  await db.transaction(async tx => {
    const config = await settings(tx, true);
    const change: Partial<typeof automation.$inferInsert> = { epoch: config.epoch + 1 };
    if (input.action === "pause") change.mode = "paused";
    if (input.action === "observe") { change.mode = "observe"; change.failures = 0; }
    if (input.action === "activate") {
      if (!config.authorized) throw new Error("Authorize capture processing before activation");
      change.mode = "autonomous";
    }
    if (input.action === "authorize") {
      change.authorized = true;
      change.privateMaterial = input.privateMaterial ?? false;
    }
    if (input.action === "revoke") { change.authorized = false; change.mode = "paused"; }
    if (input.action === "configure") {
      if (input.dailyTokens !== undefined) change.dailyTokens = input.dailyTokens;
      if (input.dailyMicros !== undefined) change.dailyMicros = input.dailyMicros;
      if (input.policy) {
        const allowed = ["authority", "relationship", "involvement", "significance", "continuing", "promotion"];
        if (Object.keys(input.policy).some(k => !allowed.includes(k))) throw new Error("Unknown policy setting");
        change.policy = { ...config.policy, ...input.policy };
        change.policyVersion = `evidence-v1-${config.epoch + 1}`;
        // Editing scoring invalidates prior live calibration.
        change.mode = "observe";
      }
    }
    if (input.action === "retry") {
      if (!input.jobId) throw new Error("Choose a failed job");
      const [job] = await tx.select().from(jobs).where(and(scoped(jobs), eq(jobs.id, input.jobId))).for("update");
      if (!job || !["dead", "deferred", "unconfigured"].includes(job.status)) throw new Error("Job is not retryable");
      await tx.update(jobs).set({ status: "queued", attempts: 0, error: null, nextRun: new Date() }).where(eq(jobs.id, job.id));
    }
    await tx.update(automation).set(change).where(eq(automation.workspace, W));
    await tx.insert(entityControlLog).values({ id: crypto.randomUUID(), workspace: W, origin: "shared-workspace-analyst",
      action: input.action, previous: config, result: change });
    // Fence every previous lease. Resume processes them again without lost evidence.
    await tx.update(jobs).set({ status: "queued", leaseOwner: null, leaseUntil: null, nextRun: new Date(), checkpoint: "fenced-by-control" })
      .where(and(scoped(jobs), eq(jobs.status, "leased")));
    if (input.action === "authorize") {
      await tx.update(captures).set({ authorized: input.privateMaterial ? true : sql`${captures.source} ~* '^(rss[: ]|publisher|url$|page)'` }).where(scoped(captures));
    }
  });
  abortEntityCalls();
  if (input.action === "backfill") { await syncCaptures(); await enqueueCaptures(); }
  return health();
}
