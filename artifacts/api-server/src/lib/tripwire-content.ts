import { createHash } from "node:crypto";

export type Capture = { id: string; text: string; raw?: string; source: string; sourceUrl?: string; capturedAt: string; fileName?: string; uploadId?: string };
export function plainText(value: string) {
  return value.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "").replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<\/(?:p|div|h[1-6]|li|section)>|<br\s*\/?>/gi, "\n").replace(/<[^>]*>/g, "")
    .replace(/&(?:amp|lt|gt|quot|apos|nbsp);/g, entity => ({ "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&apos;": "'", "&nbsp;": " " }[entity] ?? entity))
    .replace(/&#(x[0-9a-f]+|\d+);/gi, (_, code: string) => { const n = code[0]?.toLowerCase() === "x" ? parseInt(code.slice(1), 16) : Number(code); return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : ""; })
    .replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}
export function captureContent(text: string, source: string, extra: Partial<Capture> = {}): Capture {
  const raw = extra.raw ?? text;
  const identity = `${source}\0${extra.sourceUrl ?? ""}\0${raw}${extra.uploadId ? `\0${extra.uploadId}` : ""}`;
  return { ...extra, id: createHash("sha256").update(identity).digest("hex").slice(0, 32), source, text, capturedAt: extra.capturedAt ?? new Date().toISOString() };
}
export function mergeCaptures(...groups: (Capture[] | undefined)[]) {
  const captures = new Map<string, Capture>();
  for (const group of groups) for (const capture of group ?? []) if (!captures.has(capture.id)) captures.set(capture.id, capture);
  return [...captures.values()];
}
export function rssContent(item: object, sourceUrl: string) {
  const retainedContent = ["content:encoded", "content", "contentSnippet", "content:encodedSnippet"].flatMap(field => {
    const raw = (item as Record<string, unknown>)[field];
    if (typeof raw !== "string" || !raw.trim()) return [];
    return [captureContent(plainText(raw), `rss:${field}`, { raw, sourceUrl })];
  });
  const text = retainedContent.map(c => c.text).sort((a, b) => b.length - a.length)[0];
  return { retainedContent, fullText: text, contentRetained: !!text, retainedCharacters: text?.length ?? 0 };
}
export function mergeArticleContent<T extends { retainedContent?: Capture[]; fullText?: string; fullTextComplete?: boolean }>(existing: T, incoming: T) {
  const retainedContent = mergeCaptures(existing.retainedContent, incoming.retainedContent);
  // A short subsequent feed excerpt must never overwrite a longer retained body.
  const useIncoming = !existing.fullText || (!existing.fullTextComplete && (incoming.fullText?.length ?? 0) > existing.fullText.length);
  return { retainedContent, fullText: useIncoming ? incoming.fullText : existing.fullText, fullTextComplete: useIncoming ? incoming.fullTextComplete ?? false : existing.fullTextComplete ?? false,
    contentRetained: !!retainedContent.length || !!existing.fullText || !!incoming.fullText, retainedCharacters: Math.max(existing.fullText?.length ?? 0, incoming.fullText?.length ?? 0, ...retainedContent.map(c => c.text.length)) };
}
