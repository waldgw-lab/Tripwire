import { Router } from "express";
import { automaticRetrievalAllowed } from "../lib/tripwire-priority";
import { and, inArray, sql, eq } from "drizzle-orm";
import { db, tripwireContent, tripwireRecords } from "@workspace/db";
import { currentArticle } from "../lib/tripwire-feedback";
import { recordsFor, writeRecord } from "../lib/tripwire-store";
import { WORKSPACE_OWNER } from "../lib/tripwire-access";
import { readContent } from "../lib/tripwire-content-storage";
import { runRetrievalTick } from "../lib/tripwire-retrieval";

const router = Router();
router.get("/tripwire/records/:id/content", async (req, res) => {
  try {
    let article = (await recordsFor(WORKSPACE_OWNER, false)).find(r => r.id === req.params.id && r.kind === "article");
    if (!article && typeof req.query.feedback === "string") {
      const [event] = await db.select().from(tripwireRecords).where(and(eq(tripwireRecords.id, req.query.feedback),
        eq(tripwireRecords.owner, WORKSPACE_OWNER), eq(tripwireRecords.kind, "feedback"), sql`${tripwireRecords.data}->>'articleId' = ${String(req.params.id)}`));
      if (event) {
        const retained = await db.transaction(tx => currentArticle(tx, WORKSPACE_OWNER, String(req.params.id)));
        article = { ...retained.data, id: String(req.params.id), createdAt: retained.createdAt, updatedAt: retained.updatedAt };
      }
    }
    if (!article) { res.status(404).json({ error: "Article not found" }); return; }
    const captureId = typeof req.query.capture === "string" ? req.query.capture : undefined;
    const capture = captureId?.startsWith("canonical:") && captureId === `canonical:${article.fullTextHash}`
      ? { bodyHash: article.fullTextHash } : captureId ? article.retainedContent?.find(c => c.id === captureId) : undefined;
    if (captureId && !capture) { res.status(404).json({ error: "Source capture not found on this article" }); return; }
    const hash = captureId ? capture?.bodyHash : article.fullTextHash ?? article.retainedContent?.[0]?.bodyHash;
    if (!hash) { res.status(404).json({ error: "No text has been retained for this selection" }); return; }
    res.json(await readContent(hash));
  } catch (error) {
    req.log.error({ err: error instanceof Error ? error.message : "Read failure" }, "Retained content");
    res.status(503).json({ error: "Retained text could not be loaded. Retry this request." });
  }
});
router.get("/tripwire/content-search", async (req, res) => {
  const query = typeof req.query.q === "string" ? req.query.q.trim() : "";
  if (query.length > 300) { res.status(400).json({ error: "Search must be 300 characters or shorter" }); return; }
  if (!query) { res.json({ articleIds: [] }); return; }
  const records = (await recordsFor(WORKSPACE_OWNER, false)).filter(r => r.kind === "article");
  const articleHashes = (article: typeof records[number]) => [article.fullTextHash, ...article.retainedContent?.map(c => c.bodyHash) ?? []].filter((h): h is string => !!h);
  const hashes = [...new Set(records.flatMap(articleHashes))];
  if (!hashes.length) { res.json({ articleIds: [] }); return; }
  const matches = await db.select({ hash: tripwireContent.hash }).from(tripwireContent).where(and(
    inArray(tripwireContent.hash, hashes), sql`${tripwireContent.search} @@ websearch_to_tsquery('english', ${query})`,
  ));
  const matched = new Set(matches.map(m => m.hash));
  res.json({ articleIds: records.filter(r => articleHashes(r).some(h => matched.has(h))).map(r => r.id) });
});
router.get("/tripwire/retrieval", async (_req, res) => {
  const records = await recordsFor(WORKSPACE_OWNER, false);
  const watches = records.filter(r => r.kind === "watch");
  const articles = records.filter(r => r.kind === "article");
  const [storage] = await db.select({
    blobs: sql<number>`count(*)::integer`, characters: sql<number>`coalesce(sum(length(${tripwireContent.text})), 0)::float8`,
  }).from(tripwireContent);
  const outlets = records.filter(r => r.kind === "outlet").map(outlet => {
    const items = articles.filter(a => a.outlet === outlet.title);
    const latest = [...items].sort((a, b) => (b.retrieval?.lastAttempt ?? "").localeCompare(a.retrieval?.lastAttempt ?? ""))[0];
    return { outlet: outlet.title, articles: items.length, retrieved: items.filter(a => a.retrieval?.status === "retrieved").length,
      blocked: items.filter(a => a.retrieval?.status === "blocked").length, failed: items.filter(a => a.retrieval?.status === "failed").length,
      pending: items.filter(a => !a.discoveryOnly && automaticRetrievalAllowed(a, watches) && (!a.retrieval || a.retrieval.status === "pending")).length,
      characters: items.reduce((sum, a) => sum + (a.fullTextLength ?? a.retainedCharacters ?? 0), 0),
      lastResult: latest?.retrieval?.message ?? (outlet as typeof outlet & { pageLastResult?: string }).pageLastResult ?? (items.length ? "Awaiting first page retrieval" : outlet.feedStatus ?? "No items yet") };
  });
  res.json({ outlets, storage: storage ?? { blobs: 0, characters: 0 } });
});
router.post("/tripwire/retrieval", async (req, res) => {
  const records = await recordsFor(WORKSPACE_OWNER, false);
  const id = req.body?.articleId;
  if (id !== undefined && typeof id !== "string") { res.status(400).json({ error: "Invalid article identifier" }); return; }
  const watches = records.filter(r => r.kind === "watch");
  const items = records.filter(r => r.kind === "article" && r.url && !r.discoveryOnly && r.sourceType !== "x" && (!id || r.id === id) &&
    (id || automaticRetrievalAllowed(r, watches)));
  if (id && !items.length) { res.status(404).json({ error: "Article not found or has no fetchable source URL" }); return; }
  let queued = 0;
  for (const item of items) {
    const outlet = records.find(r => r.kind === "outlet" && r.title === item.outlet) as { pageBackoffUntil?: string; enabled?: boolean } | undefined;
    if (outlet?.enabled === false || Date.parse(outlet?.pageBackoffUntil ?? "") > Date.now()) continue;
    const due = !item.retrieval || !(Date.parse(item.retrieval.nextAttemptAt ?? "") > Date.now());
    const manualAllowed = id && item.retrieval?.status === "retrieved" && Date.parse(item.retrieval.lastAttempt ?? "") < Date.now() - 60_000;
    if (!due && !manualAllowed) continue;
    await writeRecord(WORKSPACE_OWNER, { ...item, retrieval: { ...item.retrieval, status: "pending", manualRequested: !!id, nextAttemptAt: new Date().toISOString() } });
    queued++;
  }
  void runRetrievalTick().catch(error => req.log.error({ err: String(error) }, "Queued article retrieval"));
  res.json({ queued });
});
export default router;
