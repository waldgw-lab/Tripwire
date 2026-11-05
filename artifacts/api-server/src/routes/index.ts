import { Router, type IRouter } from "express";
import healthRouter from "./health";
import tripwireRouter from "./tripwire";
import tripwireImportsRouter from "./tripwire-imports";
import tripwireContentRouter from "./tripwire-content";

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

export default router;
