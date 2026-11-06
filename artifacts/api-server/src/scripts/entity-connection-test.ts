/**
 * Explicit, one-request managed-provider check. Never mounts a route or applies
 * extraction results. Reusing an attempt ID is blocked, even after failure.
 */
import assert from "node:assert/strict";
import { and, eq, sql } from "drizzle-orm";
import { db, entityControlLog } from "@workspace/db";
import { automation, entities, candidates, evidence, assertions, decisions, jobs, W, settings, scoped } from "../lib/entity-db";
import { extractCapture, providerConfig, RESERVED_TOKENS, validateExtraction, type ExtractionResponseMetadata } from "../lib/entity-extractor";

const text = "Mira Vale leads the fictional Lumen Agency.";
const attemptId = process.argv.find(a => a.startsWith("--attempt-id="))?.slice("--attempt-id=".length);
const logId = attemptId ? `provider-test:${attemptId}` : "";
let reserved = false;
let received: ExtractionResponseMetadata | undefined;

async function safetySnapshot() {
  const config = await settings();
  assert.equal(config.mode, "observe");
  assert.equal(config.authorized, false);
  assert.equal(config.privateMaterial, false);
  const counts: Record<string, number> = {};
  for (const [name, table] of Object.entries({ entities, candidates, evidence, assertions, decisions })) {
    const [row] = await db.select({ count: sql<number>`count(*)::int` }).from(table).where(scoped(table));
    counts[name] = row!.count;
  }
  const [attempts] = await db.select({ count: sql<number>`coalesce(sum(${jobs.attempts}), 0)::int` }).from(jobs).where(scoped(jobs));
  return { mode: config.mode, authorized: config.authorized, privateMaterial: config.privateMaterial,
    counts, articleModelAttempts: attempts!.count };
}

async function run() {
  if (!attemptId || !/^[a-zA-Z0-9-]{8,100}$/.test(attemptId)) throw new Error("An explicit stable --attempt-id is required");
  const provider = providerConfig();
  assert.ok(provider);
  assert.equal(provider.provider, "openrouter");
  assert.equal(provider.model, "openai/gpt-5.4-mini");
  assert.equal(provider.cost, 100000);
  assert.equal(RESERVED_TOKENS, 74192);
  const before = await safetySnapshot();
  const reservation = await db.transaction(async tx => {
    const config = await settings(tx, true);
    assert.equal(config.mode, "observe");
    assert.equal(config.authorized, false);
    assert.equal(config.privateMaterial, false);
    assert.equal(config.dailyMicros, 1000000);
    assert.equal(config.dailyTokens, 750000);
    const [prior] = await tx.select({ id: entityControlLog.id }).from(entityControlLog)
      .where(and(eq(entityControlLog.workspace, W), eq(entityControlLog.id, logId)));
    if (prior) throw new Error("This attempt was already reserved; no repeat request is allowed");
    const day = new Date().toISOString().slice(0, 10);
    const usedMicros = config.budgetDay === day ? config.usedMicros : 0;
    const usedTokens = config.budgetDay === day ? config.usedTokens : 0;
    if (usedMicros + provider.cost > config.dailyMicros || usedTokens + RESERVED_TOKENS > config.dailyTokens) {
      throw new Error("Hard daily allowance exhausted; no request made");
    }
    const result = { budgetDay: day, usedMicros: usedMicros + provider.cost, usedTokens: usedTokens + RESERVED_TOKENS };
    await tx.update(automation).set(result).where(eq(automation.workspace, W));
    await tx.insert(entityControlLog).values({
      id: logId, workspace: W, origin: "isolated-fictional-connection-test", action: "provider-test-reserved",
      previous: { usedMicros, usedTokens, mode: config.mode, authorized: config.authorized, privateMaterial: config.privateMaterial },
      result: { status: "reserved", provider: provider.provider, model: provider.model, reservedMicros: provider.cost,
        reservedTokens: RESERVED_TOKENS, ...result },
    });
    return result;
  });
  reserved = true;
  console.log(JSON.stringify({ stage: "budget-reserved-before-request", ...reservation }));
  // The only model request in this executable. SDK retries and provider
  // fallbacks are disabled. No real article, capture or upload is read.
  const extraction = await extractCapture(text, undefined, metadata => { received = metadata; });
  validateExtraction(extraction, text);
  assert.ok(extraction.actors.length > 0, "Test needs a nonempty evidence-bearing result");
  assert.ok(extraction.actors.some(actor => actor.name === "Mira Vale"), "Expected the explicitly named fictional person");
  assert.deepEqual(await safetySnapshot(), before, "Authorization, registry or article-processing state changed");
  const usage = received?.usage as (NonNullable<ExtractionResponseMetadata["usage"]> & { cost?: number }) | undefined;
  const estimatedTextCostUsd = usage
    ? ((usage.prompt_tokens - (usage.prompt_tokens_details?.cached_tokens ?? 0)) * 0.75 +
      (usage.prompt_tokens_details?.cached_tokens ?? 0) * 0.075 + usage.completion_tokens * 4.5) / 1_000_000
    : undefined;
  const reportedCostUsd = usage?.cost;
  const report = { status: "succeeded", provider: provider.provider, requestedModel: provider.model,
    returnedModel: received?.model, responseId: received?.id, usage: received?.usage,
    reportedCostUsd, estimatedTextCostUsd, reservedMicros: provider.cost,
    reservedTokens: RESERVED_TOKENS, reservation, quotes: extraction.actors.map(a => ({
      name: a.name, excerpt: a.excerpt, start: a.start, end: a.end, exact: text.slice(a.start, a.end) === a.excerpt,
    })), safety: before };
  await db.update(entityControlLog).set({ action: "provider-test-succeeded", result: {
    status: report.status, provider: report.provider, requestedModel: report.requestedModel, returnedModel: report.returnedModel,
    responseId: report.responseId, usage: report.usage, reportedCostUsd, estimatedTextCostUsd, reservation,
    exactQuotesValidated: true, actorCount: extraction.actors.length, safetyUnchanged: true,
  } }).where(and(eq(entityControlLog.id, logId), eq(entityControlLog.workspace, W)));
  console.log(JSON.stringify(report, null, 2));
}

run().then(() => process.exit(0)).catch(async error => {
  // No raw SDK errors/headers are logged; credentials must never reach stdout.
  const failure = { status: "failed", reserved, responseReceived: !!received, responseId: received?.id,
    model: received?.model, usage: received?.usage, errorType: error instanceof Error ? error.name : "UnknownError",
    // This executable accepts only its hardcoded fictional sentence. Retaining
    // rejected output here never records a real article or private upload.
    finishReason: received?.finishReason, fictionalResponse: received?.output,
    validationMessage: received && error instanceof Error ? error.message : undefined,
    httpStatus: typeof error?.status === "number" ? error.status : undefined };
  if (reserved) await db.update(entityControlLog).set({ action: "provider-test-failed", result: failure })
    .where(and(eq(entityControlLog.id, logId), eq(entityControlLog.workspace, W)));
  console.log(JSON.stringify(failure, null, 2));
  process.exit(1);
});
