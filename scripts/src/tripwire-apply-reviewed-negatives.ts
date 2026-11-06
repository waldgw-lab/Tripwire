import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { db, pool } from "@workspace/db";
const feedbackPath = "../../artifacts/api-server/src/lib/tripwire-feedback.ts";
const { articleLock, currentArticle, saveArticleState, appendFeedback } = await import(feedbackPath);
process.chdir(fileURLToPath(new URL("../../", import.meta.url)));
const report = JSON.parse(await readFile("docs/calibration/sample-inventory.json", "utf8"));
let suppressed = 0;
try {
  for (const item of report.inventory.filter((i: { annotatedNegative: boolean }) => i.annotatedNegative)) {
    if (!item.articleId || item.proposed.relevance !== "unrelated" || item.proposed.confidence !== "high") throw new Error("Annotation lacks confident retained identity and text");
    await db.transaction(async tx => {
      await articleLock(tx, "workspace");
      const current = await currentArticle(tx, "workspace", item.articleId);
      if (current.hidden) return;
      if (current.data.url !== item.url || current.data.fullTextHash !== item.contentHash) throw new Error("Annotated article evidence changed; re-audit required");
      await saveArticleState(tx, "workspace", item.articleId, current.data, true);
      await appendFeedback(tx, "workspace", item.articleId, current.data, {
        action: "system-correction", field: "dismissal", actor: "System",
        reason: "Imported annotation: red-circled negative on HIGH PDF page 1",
        notes: `Supplied HIGH sample row ${item.row}; identity and retained article text reviewed. ${item.proposed.explanation}`,
        before: { effective: "active", raw: "active", mode: "auto" }, after: { effective: "dismissed", raw: "dismissed", mode: "imported annotation" },
        requestId: `imported-negative:${report.policyVersion}:HIGH:1:${item.row}`,
      });
      suppressed++;
    });
  }
  console.log(JSON.stringify({ suppressed, reason: "Explicit supplied red-circled negatives only; no topic/outlet/entity blocking rule" }));
} finally { await pool.end(); }
