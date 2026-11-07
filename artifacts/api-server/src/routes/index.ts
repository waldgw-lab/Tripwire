import { Router, type IRouter } from "express";
import healthRouter from "./health";
import tripwireRouter from "./tripwire";
import tripwireImportsRouter from "./tripwire-imports";
import tripwireContentRouter from "./tripwire-content";
import enrichmentJobsRouter from "./tripwire-enrichment-jobs";
import tripwireEntitiesRouter from "./tripwire-entities";
import tripwireProvenanceRouter from "./tripwire-provenance";

const router: IRouter = Router();

router.use(healthRouter);
// Private publishing supplies the access boundary. Do not add a second login.
router.use("/tripwire", (req, res, next) => {
  res.setHeader("Cache-Control", "private, no-store");
  next();
});
router.use(tripwireRouter);
router.use(tripwireImportsRouter);
router.use(tripwireContentRouter);
router.use(enrichmentJobsRouter);
router.use(tripwireEntitiesRouter);
router.use(tripwireProvenanceRouter);

export default router;
