import { createHash } from "node:crypto";

export type Capture = { id: string; text?: string; raw?: string; source: string; sourceUrl?: string; capturedAt: string; fileName?: string; uploadId?: string; bodyHash?: string; textLength?: number; rawLength?: number };
export function plainText(value: string) {
  return value.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "").replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<\/(?:p|div|h[1-6]|li|section)>|<br\s*\/?>/gi, "\n").replace(/<[^>]*>/g, "")
    .replace(/&(?:amp|lt|gt|quot|apos|nbsp);/g, entity => ({ "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&apos;": "'", "&nbsp;": " " }[entity] ?? entity))
    .replace(/&#(x[0-9a-f]+|\d+);/gi, (_, code: string) => { const n = code[0]?.toLowerCase() === "x" ? parseInt(code.slice(1), 16) : Number(code); return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : ""; })
    .replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}
export function captureContent(text: string, source: string, extra: Partial<Capture> = {}): Capture {
  const raw = extra.raw ?? text;
  const identity = `${source}\0${extra.sourceUrl ?? ""}\0${raw}\0${text}${extra.uploadId ? `\0${extra.uploadId}` : ""}`;
  return { ...extra, id: createHash("sha256").update(identity).digest("hex").slice(0, 32), source, text, capturedAt: extra.capturedAt ?? new Date().toISOString() };
}
export function mergeCaptures(...groups: (Capture[] | undefined)[]) {
  const captures = new Map<string, Capture>();
  const versions = new Set<string>();
  for (const group of groups) for (const capture of group ?? []) {
    const body = capture.bodyHash ?? (capture.text !== undefined ? createHash("sha256").update(JSON.stringify([capture.text, capture.raw ?? capture.text])).digest("hex") : capture.id);
    const version = JSON.stringify([capture.source, capture.sourceUrl, capture.uploadId, body]);
    // Also recognize legacy IDs, but retain a new interpretation of the same
    // raw response when its extracted text changes.
    if (!captures.has(capture.id) && !versions.has(version)) { captures.set(capture.id, capture); versions.add(version); }
  }
  return [...captures.values()];
}
export function rssContent(item: object, sourceUrl: string) {
  const retainedContent = ["content:encoded", "content", "contentSnippet", "content:encodedSnippet"].flatMap(field => {
    const raw = (item as Record<string, unknown>)[field];
    if (typeof raw !== "string" || !raw.trim()) return [];
    return [captureContent(plainText(raw), `rss:${field}`, { raw, sourceUrl })];
  });
  const text = retainedContent.map(c => c.text ?? "").sort((a, b) => b.length - a.length)[0];
  return { retainedContent, fullText: text, contentRetained: !!text, retainedCharacters: text?.length ?? 0 };
}
type ArticleContent = { retainedContent?: Capture[]; fullText?: string; fullTextComplete?: boolean; fullTextHash?: string; fullTextLength?: number; contentNormalization?: { method: string; sourceCharacters: number; articleCharacters: number } };
export function prefersIncomingContent(existing: ArticleContent, incoming: ArticleContent, options: { background?: boolean } = {}) {
  const oldLength = existing.fullText?.length ?? existing.fullTextLength ?? 0;
  const newLength = incoming.fullText?.length ?? incoming.fullTextLength ?? 0;
  if (!newLength) return false;
  // A collector or metadata save may have started before a reviewed import.
  // Its stale "complete" snapshot is history, not permission to restore it.
  if (options.background && existing.fullTextHash && incoming.fullTextHash &&
    existing.fullTextHash !== incoming.fullTextHash &&
    existing.retainedContent?.some(c => c.bodyHash === incoming.fullTextHash)) return false;
  if (!oldLength || !!incoming.fullTextComplete && !!(incoming.fullText || incoming.fullTextHash)) return true;
  // A previously confirmed copy may still contain page controls/recommendations.
  // Bounded publisher-copy cleanup can repair that while retaining the raw copy.
  if (!existing.contentNormalization && incoming.contentNormalization &&
    /^publisher-copy:(?:axios|washington-post|cnn|nytimes)$/.test(incoming.contentNormalization.method) &&
    incoming.contentNormalization.sourceCharacters >= oldLength) return true;
  if (existing.fullTextComplete) return false;
  // A cleaned article can be shorter than an unclean page copy without losing
  // source material. Completeness is separate; the raw capture stays immutable.
  if (incoming.contentNormalization && !existing.contentNormalization && incoming.contentNormalization.sourceCharacters >= oldLength) return true;
  if (existing.contentNormalization && !incoming.contentNormalization) return false;
  return newLength > oldLength;
}
export function mergeArticleContent(existing: ArticleContent, incoming: ArticleContent, options: { background?: boolean } = {}) {
  const retainedContent = mergeCaptures(existing.retainedContent, incoming.retainedContent);
  // A short subsequent feed excerpt must never overwrite a longer retained body.
  const oldLength = existing.fullText?.length ?? existing.fullTextLength ?? 0;
  const newLength = incoming.fullText?.length ?? incoming.fullTextLength ?? 0;
  const useIncoming = prefersIncomingContent(existing, incoming, options);
  const chosen = useIncoming ? incoming : existing;
  return { retainedContent, fullText: chosen.fullText, fullTextHash: chosen.fullTextHash, fullTextLength: useIncoming ? newLength : oldLength,
    fullTextComplete: chosen.fullTextComplete ?? false, contentNormalization: chosen.contentNormalization,
    contentRetained: !!retainedContent.length || !!oldLength || !!newLength, retainedCharacters: Math.max(oldLength, newLength, ...retainedContent.map(c => c.text?.length ?? c.textLength ?? 0)) };
}
