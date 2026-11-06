import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { db, pool, tripwireRecords } from "@workspace/db";
import { and, inArray, eq } from "drizzle-orm";
process.chdir(fileURLToPath(new URL("../../", import.meta.url)));
const report = JSON.parse(await readFile("docs/calibration/sample-inventory.json", "utf8"));
try {
  const rows = await db.select().from(tripwireRecords).where(and(inArray(tripwireRecords.owner, ["public", "workspace"]),
    inArray(tripwireRecords.kind, ["article", "feedback", "classification-job"])));
  const articles = new Map<string, Record<string, unknown>>();
  for (const row of rows.filter(r => r.kind === "article").sort((a,b) => a.owner === b.owner ? 0 : a.owner === "public" ? -1 : 1)) articles.set(String(row.data.baseId ?? row.id), row.data);
  const events = rows.filter(r => r.kind === "feedback" && r.data.action === "system-correction");
  const changes: Record<string, number> = {};
  for (const field of ["impact", "topic", "entities"]) {
    changes[field] = new Set(events.filter(r => r.data.field === field &&
      (r.data.before as { effective?: string })?.effective !== (r.data.after as { effective?: string })?.effective).map(r => r.data.articleId)).size;
  }
  const sampleResults = Object.fromEntries(["LOW", "HIGH", "CRITICAL"].map(sample => {
    const items = report.inventory.filter((i: { sample: string }) => i.sample === sample);
    const after = items.map((i: { articleId?: string }) => i.articleId ? articles.get(i.articleId) : undefined);
    return [sample, { rows: items.length, matched: after.filter(Boolean).length, unresolved: after.filter((x: unknown) => !x).length,
      finalImpact: Object.fromEntries(["critical", "high", "low"].map(value => [value, after.filter((x: Record<string, unknown> | undefined) => x?.impact === value).length])),
      dismissed: after.filter((x: Record<string, unknown> | undefined) => x?.hidden === true).length }];
  }));
  const results = { policyVersion: report.policyVersion, generatedAt: new Date().toISOString(),
    inventoryRows: 582, matchedSampleRows: report.matched, unresolvedSampleRows: report.unresolved, reviewSampleRows: report.review,
    uniqueArticlesWithChangedAutomaticValues: changes,
    reassessmentBatches: rows.filter(r => r.kind === "classification-job").map(r => r.data),
    sampleResults,
    circledNegatives: report.inventory.filter((i: { annotatedNegative: boolean }) => i.annotatedNegative).map((i: { articleId: string; headline: string }) => ({
      headline: i.headline, id: i.articleId, finalImpact: articles.get(i.articleId)?.impact, dismissed: articles.get(i.articleId)?.hidden === true,
    })),
    unresolved: report.inventory.filter((i: { matchStatus: string }) => i.matchStatus !== "matched-retained-identity").map((i: { sample: string; page: number; row: number; headline: string; matchStatus: string }) => ({
      sample: i.sample, page: i.page, row: i.row, headline: i.headline, status: i.matchStatus,
    })),
    note: "Sample rows are not unique articles. Counts include public/shadow deduplication where labeled unique. Review denotes uncertain relevance or limited retained text, not verified low importance. No sourcing verification was added. Only the three explicitly circled negatives were suppressed; automatic classification changes do not dismiss articles.",
  };
  await writeFile("docs/calibration/results.json", JSON.stringify(results, null, 2) + "\n");
  const columns = ["sample", "page", "row", "matchStatus", "articleId", "headline", "fullHeadline", "outlet", "publishedAt", "url", "retainedCharacters", "priorImpact", "proposedRelevance", "proposedTopic", "proposedImpact", "confidence", "reviewStatus", "explanation"];
  const csv = [columns, ...report.inventory.map((i: Record<string, any>) => [
    i.sample, i.page, i.row, i.matchStatus, i.articleId, i.headline, i.fullHeadline, i.outlet, i.publishedAt, i.url, i.retainedCharacters,
    i.prior?.impact, i.proposed.relevance, i.proposed.topic, i.proposed.impact, i.proposed.confidence, i.reviewStatus, i.proposed.explanation,
  ])].map(row => row.map((v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(",")).join("\r\n");
  await writeFile("generated-artifacts/calibration/sample-review.csv", csv + "\r\n");
  console.log(JSON.stringify(results, null, 2));
} finally { await pool.end(); }
