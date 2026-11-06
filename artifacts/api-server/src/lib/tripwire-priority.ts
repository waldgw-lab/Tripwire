import type { RecordData } from "./tripwire-store";
import { assessArticle } from "./tripwire-impact-policy";

const words = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const mentions = (text: string, term: string) => words(term).length > 2 && ` ${words(text)} `.includes(` ${words(term)} `);

/** Mirrors the feed's prominence policy; parity is covered by regression tests. */
export function recordImpact(article: RecordData, watches: RecordData[]): "critical" | "high" | "low" {
  void watches;
  if (article.impactMode === "manual" || !article.impactMode && article.impact) return article.impact!;
  return article.automaticAssessment?.impact ?? assessArticle(article).impact;
}

export function needsArticleText(article: RecordData) {
  if (article.fullTextComplete) return false;
  if (article.contentFormat === "video" && article.contentNormalization?.method === "html:video-description" &&
    (article.fullTextLength ?? article.fullText?.length ?? 0) >= 40) return false;
  if (article.contentFormat === "video" && article.retainedContent?.some(c =>
    c.source === "page:video description" && (c.textLength ?? c.text?.length ?? 0) >= 40)) return false;
  // RSS summaries are not evidence that a publisher article was enriched.
  return !(article.retainedContent ?? []).some(c =>
    /^(?:paste|file|url|page:(?!response))/.test(c.source) && (c.textLength ?? c.text?.length ?? 0) >= 250);
}

export function criticalIntakeItems<T extends RecordData & { createdAt: string }>(records: T[], now = Date.now()) {
  const watches = records.filter(r => r.kind === "watch");
  return records.filter(a => a.kind === "article" && a.sourceType !== "x" &&
    Date.parse(a.discoveredAt ?? a.createdAt) >= now - 12 * 3600000 && Date.parse(a.discoveredAt ?? a.createdAt) <= now &&
    recordImpact(a, watches) === "critical" && needsArticleText(a))
    .sort((a, b) => Date.parse(b.discoveredAt ?? b.createdAt) - Date.parse(a.discoveredAt ?? a.createdAt));
}

export function automaticRetrievalAllowed(article: RecordData, watches: RecordData[]) {
  if (article.retrieval?.manualRequested) return true;
  if (article.fullTextComplete && article.contentFormat !== "live-updates") return false;
  return recordImpact(article, watches) !== "low";
}

export function compareRetrievalPriority(a: RecordData & { createdAt: string }, b: RecordData & { createdAt: string }, watches: RecordData[], attempts: Map<string, number>) {
  const rank = { critical: 0, high: 1, low: 2 };
  return rank[recordImpact(a, watches)] - rank[recordImpact(b, watches)] ||
    (attempts.get(a.outlet ?? "") ?? 0) - (attempts.get(b.outlet ?? "") ?? 0) ||
    Date.parse(b.publishedAt ?? b.createdAt) - Date.parse(a.publishedAt ?? a.createdAt);
}
