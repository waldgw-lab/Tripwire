import { Router, type IRouter } from "express";
import { GetXFeedsResponse, RefreshXFeedsResponse, UpdateXFeedBody, UpdateXFeedParams, UpdateXFeedResponse, RemoveXFeedParams } from "@workspace/api-zod";
import { getXFeeds, refreshXFeeds, updateXWatch } from "../lib/tripwire-x";

const router: IRouter = Router();
router.get("/tripwire/x-feeds", async (_req, res): Promise<void> => {
  res.json(GetXFeedsResponse.parse(await getXFeeds()));
});
router.post("/tripwire/x-feeds/refresh", async (_req, res): Promise<void> => {
  res.json(RefreshXFeedsResponse.parse(await refreshXFeeds()));
});
router.patch("/tripwire/x-feeds/:id", async (req, res): Promise<void> => {
  const body = UpdateXFeedBody.safeParse(req.body);
  const params = UpdateXFeedParams.safeParse(req.params);
  if (!body.success || !params.success) { res.status(400).json({ error: "Choose an account tracking state." }); return; }
  if (!await updateXWatch(params.data.id, body.data.enabled)) { res.status(404).json({ error: "X account not found." }); return; }
  res.json(UpdateXFeedResponse.parse(await getXFeeds()));
});
router.delete("/tripwire/x-feeds/:id", async (req, res): Promise<void> => {
  const params = RemoveXFeedParams.parse(req.params);
  if (!await updateXWatch(params.id)) { res.status(404).json({ error: "X account not found." }); return; }
  res.status(204).end();
});
export default router;
