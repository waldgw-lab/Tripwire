import app from "./app";
import { logger } from "./lib/logger";
import { seedConfig } from "./lib/tripwire-store";
import { startMonitoring } from "./lib/tripwire-feeds";
import { migrateRetainedContent } from "./lib/tripwire-content-storage";
import { backfillDiscoveryDates } from "./lib/tripwire-publication-backfill";
import { classifyExistingArticles, reprocessSavedPages, startRetrieval } from "./lib/tripwire-retrieval";
import { startPasteJobs } from "./lib/tripwire-enrichment-jobs";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

async function start() {
  await seedConfig();
  await migrateRetainedContent();
  await backfillDiscoveryDates();
  await classifyExistingArticles();
  await reprocessSavedPages();
  app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
    startMonitoring();
    startRetrieval();
    startPasteJobs();
  });
}
void start().catch(err => { logger.error({ err }, "Tripwire initialization failed"); process.exit(1); });
