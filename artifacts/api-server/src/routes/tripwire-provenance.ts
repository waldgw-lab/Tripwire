import { Router, type ErrorRequestHandler } from "express";
import * as api from "@workspace/api-zod";
import { connectPassage, reportingProvenance, reviewLineage, ProvenanceError } from "../lib/reporting-provenance";
import { claimCoverageSummaries } from "../lib/reporting-summary";
import { claimProcessing, queueArticleClaims, LiveClaimInputError } from "../lib/live-claims";
import { correctDirection } from "../lib/claim-direction";
const router = Router();
router.get("/tripwire/claims/processing", async (_req,res):Promise<void>=>{
  res.json(api.GetClaimProcessingResponse.parse(await claimProcessing()));
});
router.post("/tripwire/claims/processing/:articleId",async(req,res):Promise<void>=>{
  const p=api.ProcessArticleClaimsParams.parse(req.params);
  res.json(api.ProcessArticleClaimsResponse.parse(await queueArticleClaims(p.articleId)));
});
router.post("/tripwire/provenance/direction",async(req,res):Promise<void>=>{
  res.json(api.CorrectClaimDirectionResponse.parse(await correctDirection(api.CorrectClaimDirectionBody.parse(req.body))));
});
router.get("/tripwire/provenance/summaries", async (_req, res): Promise<void> => {
  res.json(api.GetClaimCoverageSummariesResponse.parse(await claimCoverageSummaries()));
});
router.get("/tripwire/provenance", async (req, res): Promise<void> => {
  const q = api.GetReportingProvenanceQueryParams.parse(req.query);
  res.json(api.GetReportingProvenanceResponse.parse(await reportingProvenance(q)));
});
router.post("/tripwire/provenance", async (req, res): Promise<void> => {
  res.json(api.ConnectReportingPassageResponse.parse(await connectPassage(api.ConnectReportingPassageBody.parse(req.body))));
});
router.post("/tripwire/provenance/reviews", async (req, res): Promise<void> => {
  res.json(api.ReviewReportingLineageResponse.parse(await reviewLineage(api.ReviewReportingLineageBody.parse(req.body))));
});
const errors: ErrorRequestHandler = (err, req, res, _next) => {
  if (err instanceof ProvenanceError) res.status(err.status).json({ error: err.message });
  else if(err instanceof LiveClaimInputError)res.status(400).json({error:err.message});
  else if (err?.issues) res.status(400).json({ error: "Invalid provenance request" });
  else { req.log.error({ err }, "Reporting provenance operation failed"); res.status(503).json({ error: "Provenance unavailable; retained history is unchanged" }); }
};
router.use(errors);
export default router;
