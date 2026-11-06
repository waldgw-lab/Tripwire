import { db, tripwireRecords } from "@workspace/db";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import type { QuickEnrichmentInput, QuickEnrichmentJob } from "@workspace/api-zod";
import { recordsFor, type RecordData } from "./tripwire-store";
import { readContent, storeContent, hydrateArticles } from "./tripwire-content-storage";
import { analyzeImport, commitImport, IntakeError } from "../routes/tripwire-imports";
import { criticalIntakeItems } from "./tripwire-priority";
import { logger } from "./logger";

type JobData = { articleId: string; title: string; outlet?: string; bodyHash: string; status: QuickEnrichmentJob["status"]; error?: string; draftId?: string; token?: string };
type JobRow = typeof tripwireRecords.$inferSelect;
const KIND = "enrichment-job";
const data = (row: JobRow) => row.data as unknown as JobData;
const scoped = (owner: string) => and(eq(tripwireRecords.owner, owner), eq(tripwireRecords.kind, KIND));
export function jobView(row: JobRow): QuickEnrichmentJob {
  const j = data(row);
  return { id: row.id, articleId: j.articleId, title: j.title, outlet: j.outlet, status: j.status, error: j.error, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() };
}
export async function getEnrichmentJob(owner: string, id: string) {
  const [row] = await db.select().from(tripwireRecords).where(and(scoped(owner), eq(tripwireRecords.id, id)));
  if (!row) throw new IntakeError("Queued paste not found", 404);
  return row;
}
export async function enrichmentQueue(owner: string) {
  const [records, jobs] = await Promise.all([
    recordsFor(owner, false),
    db.select().from(tripwireRecords).where(and(scoped(owner),
      sql`(${tripwireRecords.data}->>'status' in ('queued','running') OR ${tripwireRecords.updatedAt} > now() - interval '7 days')`)).orderBy(desc(tripwireRecords.createdAt)),
  ]);
  const visible = new Set(records.filter(r => r.kind === "article").map(r => r.id));
  return { items: criticalIntakeItems(records), jobs: jobs.filter(j => visible.has(data(j).articleId) && (data(j).status !== "saved" || j.updatedAt.getTime() > Date.now() - 300000)).map(jobView) };
}
export async function enqueuePaste(owner: string, input: QuickEnrichmentInput) {
  if (input.text.trim().length < 250) throw new IntakeError("Paste at least 250 characters of article content");
  const article = (await recordsFor(owner, false)).find(r => r.id === input.articleId && r.kind === "article");
  if (!article) throw new IntakeError("Article not found", 404);
  const bodyHash = await storeContent(input.text);
  const row = await db.transaction(async tx => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`${owner}:${input.articleId}`}))`);
    const [prior] = await tx.select().from(tripwireRecords).where(eq(tripwireRecords.id, input.requestId));
    if (prior) {
      if (prior.owner !== owner || prior.kind !== KIND || data(prior).articleId !== input.articleId || data(prior).bodyHash !== bodyHash) throw new IntakeError("This request identifier was already used for different content", 409);
      return prior;
    }
    const pending = await tx.select().from(tripwireRecords).where(and(scoped(owner), sql`${tripwireRecords.data}->>'status' in ('queued','running')`));
    if (pending.some(j => data(j).articleId === article.id)) throw new IntakeError("This item already has a paste queued", 409);
    if (pending.length >= 50) throw new IntakeError("50 pastes are queued. Wait for a save before adding more.", 429);
    const [inserted] = await tx.insert(tripwireRecords).values({ id: input.requestId, owner, kind: KIND, data: { articleId: article.id, title: article.title, outlet: article.outlet, bodyHash, status: "queued" } }).returning();
    return inserted!;
  });
  return jobView(row);
}
export async function retryPaste(owner: string, id: string) {
  const row = await getEnrichmentJob(owner, id);
  return db.transaction(async tx => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`${owner}:${data(row).articleId}`}))`);
    const [current] = await tx.select().from(tripwireRecords).where(and(scoped(owner), eq(tripwireRecords.id, id))).for("update");
    if (!current) throw new IntakeError("Queued paste not found", 404);
    if (data(current).status !== "failed") return jobView(current);
    const other = await tx.select().from(tripwireRecords).where(and(scoped(owner), sql`${tripwireRecords.data}->>'status' in ('queued','running') AND ${tripwireRecords.data}->>'articleId' = ${data(current).articleId}`));
    if (other.length) throw new IntakeError("This item already has a paste queued", 409);
    const next = { ...data(current), status: "queued", error: undefined, token: undefined, draftId: undefined };
    const [updated] = await tx.update(tripwireRecords).set({ data: next, updatedAt: new Date() }).where(eq(tripwireRecords.id, id)).returning();
    return jobView(updated!);
  });
}

let running = false;
export async function runPasteJobs() {
  if (running) return;
  running = true;
  try {
    const job = await db.transaction(async tx => {
      const [row] = await tx.select().from(tripwireRecords).where(and(eq(tripwireRecords.kind, KIND),
        sql`(${tripwireRecords.data}->>'status' = 'queued' OR (${tripwireRecords.data}->>'status' = 'running' AND ${tripwireRecords.updatedAt} < now() - interval '2 minutes'))`))
        .orderBy(asc(tripwireRecords.createdAt)).limit(1).for("update", { skipLocked: true });
      if (!row) return;
      const [claimed] = await tx.update(tripwireRecords).set({ data: { ...data(row), status: "running", error: undefined, token: crypto.randomUUID() }, updatedAt: new Date() }).where(eq(tripwireRecords.id, row.id)).returning();
      return claimed;
    });
    if (!job) return;
    const j = data(job);
    const owned = and(eq(tripwireRecords.id, job.id), sql`${tripwireRecords.data}->>'token' = ${j.token}`);
    try {
      let draftId = j.draftId;
      let candidate: RecordData;
      if (draftId) {
        const [draft] = await db.select().from(tripwireRecords).where(and(eq(tripwireRecords.id, `draft:${draftId}`), eq(tripwireRecords.owner, job.owner), eq(tripwireRecords.kind, "import-draft")));
        if (!draft) throw new Error("The analysis preview is missing. Paste the content again.");
        [candidate] = await hydrateArticles([draft.data.candidate as RecordData]);
      } else {
        const body = await readContent(j.bodyHash);
        const preview = await analyzeImport(job.owner, { targetId: j.articleId, text: body.text });
        draftId = preview.draftId;
        candidate = preview.candidate;
        const saved = await db.update(tripwireRecords).set({ data: { ...j, draftId, status: "running" }, updatedAt: new Date() }).where(owned).returning();
        if (!saved.length) return;
      }
      if ((candidate.fullText?.trim().length ?? 0) < 250) throw new Error("Not enough article text was found. Open the edit and paste the article body.");
      if (/subscribe to continue|sign in to continue|enable javascript|verify.{0,20}human/i.test(candidate.fullText?.slice(0, 500) ?? "")) throw new Error("This appears to be an access page. Paste the article text instead.");
      const article = await commitImport(job.owner, {
        draftId, title: candidate.title, outlet: candidate.outlet, url: candidate.url, byline: candidate.byline,
        publishedAt: candidate.publishedAt, sourceType: candidate.sourceType, fullTextComplete: false,
      });
      if (article.id !== j.articleId) throw new Error("The paste did not save to the selected article");
      await db.update(tripwireRecords).set({ data: { ...j, draftId, status: "saved" }, updatedAt: new Date() }).where(owned);
    } catch (error) {
      // The unmodified paste remains in durable content storage for restore/retry.
      await db.update(tripwireRecords).set({
        data: sql`${tripwireRecords.data} || ${JSON.stringify({ status: "failed", error: error instanceof Error ? error.message : "Save failed" })}::jsonb`, updatedAt: new Date(),
      }).where(owned);
      logger.warn({ jobId: job.id, articleId: j.articleId, error: error instanceof Error ? error.message : "Save failed" }, "Queued article enrichment failed");
    }
  } finally { running = false; }
}
export function startPasteJobs() {
  const run = () => void runPasteJobs().catch(error => logger.error({ err: String(error) }, "Paste queue worker"));
  run();
  setInterval(run, 1000).unref();
}
