import express, { type Express } from "express";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { browserBoundary, intensiveLimit } from "./lib/tripwire-browser-boundary";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use("/api/tripwire", browserBoundary, intensiveLimit);
app.use(express.json({ limit: "5mb" }));

app.use("/api", router);
app.use((err: unknown, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  req.log.error({ status: 500 }, "API request failed");
  if (!res.headersSent) res.status(500).json({ error: "The request could not be completed. Retained evidence is unchanged." });
});

export default app;
