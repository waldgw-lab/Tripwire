import { Router, type IRouter, type ErrorRequestHandler } from "express";
import { workspaceIdentity } from "../lib/tripwire-access";
import { SaveRecordBody, SaveRecordResponse, GetWorkspaceResponse, DeleteRecordParams, RefreshFeedsResponse, FlagArticleBody } from "@workspace/api-zod";
import { recordsFor, writeRecord, removeRecord } from "../lib/tripwire-store";
import { refreshFeeds } from "../lib/tripwire-feeds";
import { CorrectArticleClassificationBody, DeleteRecordBody, GetArticleFeedbackQueryParams, GetArticleFeedbackResponse, GetFeedbackArticleResponse } from "@workspace/api-zod";
import { correctArticle, dismissArticle, restoreArticleState, currentArticle, FeedbackError } from "../lib/tripwire-feedback";
import { db, tripwireRecords } from "@workspace/db";
import { and, eq, sql, desc } from "drizzle-orm";

const router: IRouter = Router();
router.get("/tripwire/workspace", async (req, res): Promise<void> => {
  const records = await recordsFor(workspaceIdentity(req).userId, false);
  const articles = records.filter(r => r.kind === "article");
  const dates = records.filter(r => r.kind === "outlet").map(r => r.lastChecked).filter((x): x is string => !!x).sort();
  res.setHeader("Cache-Control", "private, no-store");
  const signedIn = true;
  res.json(GetWorkspaceResponse.parse({records, access: {signedIn, canEnrich: signedIn}, lastRefreshed: dates.at(-1) ?? null, stats: {
    articles: articles.length, claims: records.filter(r => r.kind === "claim").length,
    journalists: new Set(articles.flatMap(r => r.credits?.map(c => c.name.trim().toLowerCase()) ?? r.journalists?.map(name => name.trim().toLowerCase()) ?? [])).size,
    outlets: records.filter(r => r.kind === "outlet" && r.enabled !== false).length,
    original: articles.filter(r => r.reportingType === "original").length,
    negative: articles.filter(r => r.sentiment === "negative").length,
    positive: articles.filter(r => r.sentiment === "positive").length,
    flagged: articles.filter(r => r.flagged ?? r.saved ?? false).length,
  }}));
});
router.post("/tripwire/records/:id/flag", async (req, res): Promise<void> => {
  const userId = workspaceIdentity(req).userId;
  if (!userId) { res.status(401).json({error: "App access required"}); return; }
  const parsed = FlagArticleBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({error: "Choose a flag state"}); return; }
  const current = (await recordsFor(userId)).find(r => r.id === req.params.id && r.kind === "article");
  if (!current) { res.status(404).json({error: "Article not found"}); return; }
  const flagged = parsed.data.flagged;
  res.json(SaveRecordResponse.parse(await writeRecord(userId, SaveRecordBody.parse({...current, flagged, saved: flagged, flaggedAt: flagged ? new Date().toISOString() : undefined}))));
});
router.post("/tripwire/records", async (req, res): Promise<void> => {
  const userId = workspaceIdentity(req).userId;
  if (!userId) { res.status(401).json({error: "Sign in to save records"}); return; }
  const parsed = SaveRecordBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({error: parsed.error.message}); return; }
  const data = parsed.data;
  if (data.url && !/^https?:\/\/\S+$/i.test(data.url)) { res.status(400).json({error: "Use an http or https source URL"}); return; }
  if (data.publishedAt && isNaN(Date.parse(data.publishedAt))) { res.status(400).json({error: "Invalid publication time"}); return; }
  if (data.observations?.some(o => isNaN(Date.parse(o.observedAt)) || o.url && !/^https?:\/\/\S+$/i.test(o.url))) {
    res.status(400).json({error: "Each observation needs a valid time and source URL"}); return;
  }
  const records = await recordsFor(userId);
  if (data.observations?.some(o => o.articleId && !records.some(r => r.id === o.articleId && r.kind === "article"))) {
    res.status(400).json({error: "Observation references an article outside this workspace"}); return;
  }
  res.json(SaveRecordResponse.parse(await writeRecord(userId, data, false, true)));
});
router.delete("/tripwire/records/:id", async (req, res): Promise<void> => {
  const userId = workspaceIdentity(req).userId;
  if (!userId) { res.status(401).json({error: "Sign in to delete records"}); return; }
  const params = DeleteRecordParams.parse(req.params);
  const article = await db.select({ kind: tripwireRecords.kind }).from(tripwireRecords).where(and(
    sql`${tripwireRecords.id} in (${params.id}, ${`${userId}:${params.id}`})`, eq(tripwireRecords.kind, "article")));
  if (article.length) {
    const body = DeleteRecordBody.safeParse(req.body);
    if (!body.success || !body.data) { res.status(400).json({ error: "Choose a deletion reason." }); return; }
    await dismissArticle(userId, params.id, body.data);
    res.status(204).end(); return;
  }
  const removed = await removeRecord(userId, params.id);
  if (!removed) { res.status(404).json({error: "Record not found"}); return; }
  res.status(204).end();
});
router.patch("/tripwire/records/:id/classification", async (req, res): Promise<void> => {
  const input = CorrectArticleClassificationBody.safeParse(req.body);
  if (!input.success) { res.status(400).json({ error: input.error.message }); return; }
  const id = String(req.params.id);
  res.json(SaveRecordResponse.parse(await correctArticle(workspaceIdentity(req).userId, id, input.data)));
});
router.post("/tripwire/records/:id/restore", async (req, res): Promise<void> => {
  res.json(SaveRecordResponse.parse(await restoreArticleState(workspaceIdentity(req).userId, String(req.params.id))));
});
router.get("/tripwire/feedback", async (req, res): Promise<void> => {
  const input = GetArticleFeedbackQueryParams.safeParse(req.query);
  if (!input.success) { res.status(400).json({ error: input.error.message }); return; }
  const { q, action, reason, page = 1 } = input.data;
  const where = and(eq(tripwireRecords.owner, workspaceIdentity(req).userId), eq(tripwireRecords.kind, "feedback"),
    action ? sql`${tripwireRecords.data}->>'action' = ${action}` : undefined,
    reason ? sql`${tripwireRecords.data}->>'reason' = ${reason}` : undefined,
    q?.trim() ? sql`strpos(lower(concat_ws(' ', ${tripwireRecords.data}->>'headline', ${tripwireRecords.data}->>'outlet', ${tripwireRecords.data}->>'notes', ${tripwireRecords.data}->>'reason')), lower(${q.trim()})) > 0` : undefined);
  const [count] = await db.select({ total: sql<number>`count(*)::integer` }).from(tripwireRecords).where(where);
  const rows = await db.select({ data: tripwireRecords.data }).from(tripwireRecords).where(where).orderBy(desc(tripwireRecords.createdAt), desc(tripwireRecords.id)).limit(25).offset((page - 1) * 25);
  const reasons = await db.selectDistinct({ reason: sql<string>`${tripwireRecords.data}->>'reason'` }).from(tripwireRecords)
    .where(and(eq(tripwireRecords.owner, workspaceIdentity(req).userId), eq(tripwireRecords.kind, "feedback")));
  res.setHeader("Cache-Control", "private, no-store");
  res.json(GetArticleFeedbackResponse.parse({ events: rows.map(r => r.data), total: count?.total ?? 0, page, pageSize: 25, reasons: reasons.map(r => r.reason).filter(Boolean).sort() }));
});
router.get("/tripwire/feedback/:id/article", async (req, res): Promise<void> => {
  const owner = workspaceIdentity(req).userId;
  const [event] = await db.select().from(tripwireRecords).where(and(eq(tripwireRecords.id, String(req.params.id)), eq(tripwireRecords.owner, owner), eq(tripwireRecords.kind, "feedback")));
  if (!event) { res.status(404).json({ error: "Feedback not found" }); return; }
  const article = await db.transaction(tx => currentArticle(tx, owner, String(event.data.articleId)));
  res.setHeader("Cache-Control", "private, no-store");
  res.json(GetFeedbackArticleResponse.parse({ ...article.data, createdAt: article.createdAt, updatedAt: article.updatedAt }));
});
router.post("/tripwire/refresh", async (req, res): Promise<void> => {
  res.json(RefreshFeedsResponse.parse(await refreshFeeds(workspaceIdentity(req).userId)));
});
const feedbackErrors: ErrorRequestHandler = (err, _req, res, next) => {
  if (err instanceof FeedbackError) { res.status(err.status).json({ error: err.message }); return; }
  next(err);
};
router.use(feedbackErrors);
export default router;
