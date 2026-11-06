import { parseByline, type ParsedCredit } from "./tripwire-bylines";

const person = (name: string) => /^[\p{L}\p{M}.'’ -]+$/u.test(name) && name.split(/\s+/).length >= 2 && name.length < 90;
const dateLine = /^[A-Z][a-z]+ \d{1,2}, \d{4}$/;
const key = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
const sameCardTitle = (a: string, b: string) => {
  const x = key(a), y = key(b);
  return Math.min(x.length, y.length) > 25 && (x === y || (/[.…]$/.test(a) || /[.…]$/.test(b)) && (x.startsWith(y) || y.startsWith(x)));
};

/** Remove a bounded series of recommendation cards, not everything after it. */
function recommendations(lines: string[]) {
  const kept: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i] !== "Most Read") { kept.push(lines[i]!); continue; }
    let cursor = i + 1, end = cursor, cards = 0;
    if (lines[cursor] === "Next") cursor++;
    while (cursor < lines.length) {
      let at = cursor;
      if (/^(Opinion|Column|Analysis)$/.test(lines[at] ?? "")) at++;
      if (person(lines[at] ?? "") && sameCardTitle(lines[at + 1] ?? "", lines[at + 2] ?? "")) at++;
      if (!sameCardTitle(lines[at] ?? "", lines[at + 1] ?? "") || !dateLine.test(lines[at + 2] ?? "")) break;
      cursor = at + 3; end = cursor; cards++;
    }
    if (cards >= 2) i = end - 1;
    else kept.push(lines[i]!);
  }
  return kept;
}

export function washingtonPostCopy(raw: string) {
  const lines = raw.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  const at = lines.findIndex((s, i) => i < 40 && /^By\s+/i.test(s));
  if (at < 0) return undefined;
  const byline = lines[at]!;
  const authors = parseByline(byline);
  if (!authors.length || authors.some(c => c.role !== "author" || !person(c.name))) return undefined;
  let body = lines.slice(at + 1);
  const credits: ParsedCredit[] = [...authors];
  const contribution = body.findIndex((s, i) => i > body.length - 15 && / contributed(?: reporting)? to (?:this|the) (?:report|story|article)\.?$/i.test(s));
  if (contribution >= 0) {
    // PDF line wraps can split the final person's first and last name.
    for (let start = contribution; start >= Math.max(0, contribution - 2); start--) {
      const observed = parseByline(body.slice(start, contribution + 1).join(" "));
      if (!observed.length || !observed.every(c => c.role === "contributor" && person(c.name))) continue;
      credits.push(...observed);
      if (body.slice(contribution + 1).includes("What readers are saying")) body = body.slice(0, start);
      else body.splice(start, contribution - start + 1);
      break;
    }
  }
  body = recommendations(body).filter(s => !/^(?:Ask The Post AI|Dive deeper|Get concise answers to your questions\. Try Ask The Post AI\.)$/.test(s));
  const text = body.join("\n\n").replace(/\u2060/g, "").trim();
  if (text.length < 150) return undefined;
  const title = lines[0]!;
  const summary = lines.slice(1, at).find(s => s.length > 80 && !/\([^)]+\/[^)]+\)$/.test(s) && !/^November|^[A-Z][a-z]+ \d{1,2}, \d{4}/.test(s));
  return { title, text, byline, credits, summary, outlet: "The Washington Post",
    contentNormalization: { method: "publisher-copy:washington-post", sourceCharacters: raw.length, articleCharacters: text.length } };
}
