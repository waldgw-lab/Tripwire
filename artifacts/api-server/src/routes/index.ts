import { Router, type IRouter } from "express";
import healthRouter from "./health";
import tripwireRouter from "./tripwire";

const router: IRouter = Router();

router.use(healthRouter);
router.use(tripwireRouter);

export default router;
