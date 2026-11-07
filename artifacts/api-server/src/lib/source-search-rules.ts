import { createHash } from "node:crypto";
import { canonicalArticleUrl } from "./tripwire-feedback";

export const sourceKey = (...parts: unknown[]) => createHash("sha256").update(JSON.stringify(parts)).digest("hex");
export function sourceUrl(raw: string) {
  try {
    const url = new URL(raw.trim());
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return null;
    return canonicalArticleUrl(url.href) || null;
  } catch { return null; }
}
export const titleKey = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
export function exactPassage(text: string, excerpt?: string) {
  if (!excerpt?.trim()) return null;
  const start = text.indexOf(excerpt);
  // A repeated quotation is ambiguous without position evidence.
  return start >= 0 && text.indexOf(excerpt, start + 1) < 0 ? { start, end: start + excerpt.length, excerpt } : null;
}
export function nonnegativeInteger(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value :
    typeof value === "string" && /^\d+$/.test(value.trim()) ? Number(value) : null;
}
export function suppliedDate(value: unknown) {
  const days = nonnegativeInteger(value);
  if (days === null || days < 36526 || days > 73050) return null;
  return new Date(Date.UTC(1899, 11, 30) + days * 86400000).toISOString().slice(0, 10);
}
/** Bounds apply to this one phrase only. Never add overlapping descriptors. */
export function grammaticalMinimum(descriptor: string): number | null {
  if (/\b(one of|among|some of|another|other)\b/i.test(descriptor)) return null;
  const digit = descriptor.match(/\b([2-9]\d*)\s+(?:senior\s+)?(?:[\w.]+\s+){0,2}(?:officials|people|persons|sources)\b/i);
  if (digit) return Number(digit[1]);
  if (/\b(two|three|four|five|six)\b.*\b(officials|people|sources)\b/i.test(descriptor)) {
    return ({ two: 2, three: 3, four: 4, five: 5, six: 6 })[descriptor.match(/\b(two|three|four|five|six)\b/i)![1]!.toLowerCase() as "two"];
  }
  if (/\b(officials|people|sources)\b/i.test(descriptor)) return 2;
  return /\b(a|an|one)\s+(?:[\w.]+\s+){0,4}(?:official|person|source)\b/i.test(descriptor) ? 1 : null;
}
export function conservativeMinimum(sources: { anonymity: string; minimum_humans: number | null }[]) {
  const bounds = sources.filter(s => s.anonymity.toLowerCase() === "unnamed").map(s => s.minimum_humans).filter((n): n is number => n !== null);
  return bounds.length ? Math.max(...bounds) : null;
}
