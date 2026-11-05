import { Router, type IRouter } from "express";
import { getAuth } from "@clerk/express";
import healthRouter from "./health";
import tripwireRouter from "./tripwire";
import tripwireImportsRouter from "./tripwire-imports";

const router: IRouter = Router();

router.use(healthRouter);
// The whole workspace is private in every environment, including development.
// Background monitoring calls its service directly and does not need a public API.
router.use("/tripwire", (req, res, next) => {
  res.setHeader("Cache-Control", "private, no-store");
  if (!getAuth(req).userId) {
    res.status(401).json({ error: "App access required" });
    return;
  }
  next();
});
router.use(tripwireRouter);
router.use(tripwireImportsRouter);

export default router;
