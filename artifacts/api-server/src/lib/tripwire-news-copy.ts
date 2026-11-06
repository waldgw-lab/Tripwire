import { parseByline, type ParsedCredit } from "./tripwire-bylines";
import type { ContentNormalization } from "./tripwire-paste";

/** Keep readable link labels; the untouched source preserves every destination. */
const readableLinks = (text: string) => text.replace(/\[([^\]\n]+)\]\(https?:\/\/[^)\s]+\)/g, "$1").replace(/\u2060/g, "");
function authors(text: string) {
  const credits = parseByline(readableLinks(text));
  return credits.length && credits.every(c => c.role === "author" && c.name.length <= 80 &&
    /^[\p{L}\p{M}.'’ -]+$/u.test(c.name) && c.name.split(/\s+/).length >= 2 && c.name.split(/\s+/).length <= 6)
    ? credits : [];
}
function cleaned(raw: string, text: string, title: string, byline: string, credits: ParsedCredit[], outlet: string, publisher: string) {
  return { title: readableLinks(title), text, byline, credits, outlet,
    contentNormalization: { method: `publisher-copy:${publisher}`, sourceCharacters: raw.length, articleCharacters: text.length } satisfies ContentNormalization };
}

export function cnnCopy(raw: string) {
  const lines = raw.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const by = lines.slice(0, 20).findIndex(l => /^By(?:\s+.+)?$/i.test(l));
  if (by < 1) return;
  const names = new Map<string, string>();
  let end = by + 1;
  const inline = lines[by]!.replace(/^By\s*/i, "").trim();
  if (inline) {
    const observed = authors(inline);
    if (!observed.length) return;
    observed.forEach(c => names.set(c.name.toLowerCase(), c.name));
  }
  for (; end < Math.min(lines.length, by + 20); end++) {
    const line = lines[end]!;
    if (/^(?:,|and|&)$/i.test(line)) continue;
    const observed = authors(line);
    if (!observed.length) break;
    observed.forEach(c => names.set(c.name.toLowerCase(), c.name));
  }
  if (!names.size) return;
  // Relative display times cannot establish an absolute publication timestamp.
  while (/^(?:\d+\s+(?:min(?:ute)?s?|hours?|days?)\s+ago|(?:Updated|Published)\b.*)$/i.test(lines[end] ?? "")) end++;
  const title = lines[by - 1]!;
  if (title.length < 15) return;
  const byline = `By ${[...names.values()].join(", ")}`;
  const credits: ParsedCredit[] = [...names.values()].map(name => ({ name, role: "author", attribution: byline }));
  // A repeated lead-image caption plus a recognized wire/photo credit is a
  // bounded masthead, not the opening reporting paragraph.
  const caption = lines[end];
  const creditedCaption = lines[end + 1];
  if (caption && creditedCaption?.startsWith(`${caption} `)) {
    const attribution = creditedCaption.slice(caption.length).trim();
    const photo = attribution.match(/^([\p{L}\p{M}.'’ -]{2,80})\/(?:Reuters|Getty Images|AP|Associated Press|CNN)(?:\/FILE)?$/iu);
    if (photo && photo[1]!.trim().split(/\s+/).length >= 2) {
      credits.push({ name: photo[1]!.trim(), role: "photography", attribution });
      end += 2;
    }
  }
  const body: string[] = [];
  for (let i = end; i < lines.length; i++) {
    const line = lines[i]!;
    // Linked recommendation cards have their own explicit boundary.
    if (/^\[Related article\b.*\]\(https:\/\/(?:www\.)?cnn\.com\/[^)\s]+\)$/i.test(line)) continue;
    if (/^Related article$/i.test(line)) {
      const tail = lines.slice(i + 1, i + 9).findIndex(l => /^\d+\s+min(?:ute)?s?\s+read$/i.test(l));
      if (tail >= 0) { i += tail + 1; continue; }
      // Ambiguous modules stay intact rather than risking subsequent reporting.
    }
    body.push(readableLinks(line));
  }
  const text = body.join("\n\n").trim();
  if (text.length < 100) return;
  return cleaned(raw, text, title, byline, credits, "CNN", "cnn");
}

export function newYorkTimesCopy(raw: string) {
  const lines = raw.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const header = lines.slice(0, 15).findIndex(l => /^(?:\[The New York Times\]\(https:\/\/(?:www\.)?nytimes\.com\/?\)|The New York Times)\s*[•·|]\s*\S/.test(l));
  if (header < 1) return;
  const byline = lines[header]!.replace(/^(?:\[The New York Times\]\(https:\/\/(?:www\.)?nytimes\.com\/?\)|The New York Times)\s*[•·|]\s*/, "");
  const credits = authors(byline);
  if (!credits.length) return;
  const source = lines.findIndex((line, i) => {
    if (i <= header || i > header + 8) return false;
    try {
      const url = new URL(line);
      return url.protocol === "https:" && /(^|\.)nytimes\.com$/i.test(url.hostname) && /\/\d{4}\/\d{2}\/\d{2}\/.*\.html$/.test(url.pathname);
    } catch { return false; }
  });
  if (source < 0) return;
  const text = lines.slice(source + 1).map(readableLinks).join("\n\n").trim();
  if (text.length < 100) return;
  return cleaned(raw, text, lines[header - 1]!, byline, credits.map(c => ({ ...c, attribution: byline })), "The New York Times", "nytimes");
}
