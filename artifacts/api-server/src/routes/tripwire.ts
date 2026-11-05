import { Router, type IRouter } from "express";
import { workspaceIdentity } from "../lib/tripwire-access";
import { SaveRecordBody, SaveRecordResponse, GetWorkspaceResponse, DeleteRecordParams, RefreshFeedsResponse, FlagArticleBody } from "@workspace/api-zod";
import { recordsFor, writeRecord, removeRecord } from "../lib/tripwire-store";
import { refreshFeeds } from "../lib/tripwire-feeds";

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
  res.json(SaveRecordResponse.parse(await writeRecord(userId, data)));
});
router.delete("/tripwire/records/:id", async (req, res): Promise<void> => {
  const userId = workspaceIdentity(req).userId;
  if (!userId) { res.status(401).json({error: "Sign in to delete records"}); return; }
  const params = DeleteRecordParams.parse(req.params);
  const removed = await removeRecord(userId, params.id);
  if (!removed) { res.status(404).json({error: "Record not found"}); return; }
  res.status(204).end();
});
router.post("/tripwire/refresh", async (req, res): Promise<void> => {
  res.json(RefreshFeedsResponse.parse(await refreshFeeds(workspaceIdentity(req).userId)));
});
export default router;
