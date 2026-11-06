import { Router } from "express";
import { GetQuickEnrichmentResponse, GetQuickEnrichmentTextResponse, QueueQuickEnrichmentBody, QueueQuickEnrichmentResponse, RetryQuickEnrichmentResponse } from "@workspace/api-zod";
import { workspaceIdentity } from "../lib/tripwire-access";
import { enrichmentQueue, enqueuePaste, getEnrichmentJob, retryPaste } from "../lib/tripwire-enrichment-jobs";
import { readContent } from "../lib/tripwire-content-storage";
import { IntakeError } from "./tripwire-imports";
import type { Response } from "express";

const router = Router();
function fail(res: Response, error: unknown) {
  res.status(error instanceof IntakeError ? error.status : 400).json({ error: error instanceof Error ? error.message : "Could not update the enrichment queue" });
}
router.get("/tripwire/quick-enrichment", async (req, res) => {
  try { res.json(GetQuickEnrichmentResponse.parse(await enrichmentQueue(workspaceIdentity(req).userId))); }
  catch (error) { fail(res, error); }
});
router.post("/tripwire/quick-enrichment", async (req, res) => {
  try {
    const input = QueueQuickEnrichmentBody.parse(req.body);
    res.status(202).json(QueueQuickEnrichmentResponse.parse(await enqueuePaste(workspaceIdentity(req).userId, input)));
  } catch (error) { fail(res, error); }
});
router.post("/tripwire/quick-enrichment/:id/retry", async (req, res) => {
  try { res.json(RetryQuickEnrichmentResponse.parse(await retryPaste(workspaceIdentity(req).userId, String(req.params.id)))); }
  catch (error) { fail(res, error); }
});
router.get("/tripwire/quick-enrichment/:id/text", async (req, res) => {
  try {
    const job = await getEnrichmentJob(workspaceIdentity(req).userId, String(req.params.id));
    const body = await readContent(String(job.data.bodyHash));
    res.json(GetQuickEnrichmentTextResponse.parse({ text: body.text }));
  } catch (error) { fail(res, error); }
});
export default router;
