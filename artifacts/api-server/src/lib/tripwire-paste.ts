import { parseByline, type ParsedCredit } from "./tripwire-bylines";
import { washingtonPostCopy } from "./tripwire-washington-post";
import { cnnCopy, newYorkTimesCopy } from "./tripwire-news-copy";

export type ContentNormalization = { method: string; sourceCharacters: number; articleCharacters: number };
const decode = (s: string) => s.replace(/&(?:amp|nbsp|quot|apos|lt|gt);/g, m => ({ "&amp;": "&", "&nbsp;": " ", "&quot;": '"', "&apos;": "'", "&lt;": "<", "&gt;": ">" }[m] ?? m));
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
export function pasteSourceUrl(text: string) {
  const lines = text.split(/\r?\n/).slice(0, 20).map(s => s.trim());
  return lines.find(l => /^https?:\/\/\S+$/i.test(l)) ?? lines[0]?.match(/^\[[^\]]+\]\((https?:\/\/[^)\s]+)\)$/)?.[1];
}
export function publicationFromCopy(text: string) {
  const post = text.split(/\r?\n/).slice(0, 35).map(s => s.trim()).find(s => /^[A-Z][a-z]+ \d{1,2}, \d{4} at /i.test(s))
    ?.match(/^[A-Z][a-z]+ \d{1,2}, \d{4} at \d{1,2}:\d{2}\s*[ap]\.?m\.?\s*(?:EST|EDT|ET)/i)?.[0];
  if (post) return publicationFromCopy(`Published: ${post.replace(/\s+at\s+/i, " ").replace(/a\.?m\.?/i, "AM").replace(/p\.?m\.?/i, "PM")}`);
  const line = text.split(/\r?\n/).slice(0, 20).find(l => /^(?:published|date)\s*:|·.*\b(?:ET|EST|EDT)\b/i.test(l));
  if (!line) return undefined;
  const value = line.replace(/^[^·]*·\s*|^(?:published|date)\s*:\s*/i, "").trim();
  const eastern = value.match(/^([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4}),?\s+(\d{1,2}):(\d{2})\s*(AM|PM)\s+(ET|EST|EDT)$/i);
  if (!eastern) { const t = Date.parse(value); return Number.isNaN(t) ? undefined : new Date(t).toISOString(); }
  const [, monthName, day, year, hour, minute, meridiem, zone] = eastern;
  const month = ["jan","feb","mar","apr","may","jun","jul","aug","sep","oct","nov","dec"].indexOf(monthName!.slice(0,3).toLowerCase());
  if (month < 0) return undefined;
  const h = Number(hour) % 12 + (meridiem!.toUpperCase() === "PM" ? 12 : 0);
  const wall = Date.UTC(Number(year), month, Number(day), h, Number(minute));
  if (zone!.toUpperCase() !== "ET") return new Date(wall + (zone!.toUpperCase() === "EST" ? 5 : 4) * 3600000).toISOString();
  let guess = wall;
  for (let n = 0; n < 2; n++) {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(guess));
    const get = (key: string) => Number(parts.find(p => p.type === key)?.value);
    guess += wall - Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"));
  }
  return new Date(guess).toISOString();
}
export function parsePublisherCopy(raw: string, sourceUrl?: string, outletHint?: string) {
  const lines = raw.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const headline = lines[0]?.match(/^\[([^\]]+)\]\(https?:\/\/[^)]+\)$/)?.[1] ?? lines[0] ?? "";
  const genericByline = lines.slice(0, 20).find(l => /^by\s+\S+/i.test(l));
  const fallback = { title: decode(headline), text: raw, byline: genericByline, credits: genericByline ? parseByline(genericByline) : undefined,
    publishedAt: publicationFromCopy(raw), summary: undefined as string | undefined, outlet: undefined as string | undefined,
    section: undefined as string | undefined, contentNormalization: undefined as ContentNormalization | undefined };
  let host = "";
  try { host = new URL(sourceUrl ?? pasteSourceUrl(raw) ?? "").hostname; } catch { /* A publisher-identified paste may have no URL. */ }
  const unidentifiedHost = !host || host === "news.google.com";
  // A copied Post page can omit its logo and URL. Require its duplicated-date
  // header AND both page controls, not generic prose or "Most Read" alone.
  const header = lines.slice(0, 40);
  const postHeader = !outletHint && header.includes("More article actions") && header.includes("Chevron right") &&
    header.some(l => /^([A-Z][a-z]+ \d{1,2}, \d{4}) at \d{1,2}:\d{2}\s*[ap]\.?m\.?\s*(?:EST|EDT|ET)\s*\1$/.test(l));
  if (/(^|\.)cnn\.com$/i.test(host) || unidentifiedHost && (outletHint === "CNN" || /\]\(https:\/\/(?:www\.)?cnn\.com\/profiles\//i.test(lines.slice(0, 20).join("\n")))) {
    const cnn = cnnCopy(raw);
    return cnn ? { ...fallback, ...cnn } : fallback;
  }
  if (/(^|\.)nytimes\.com$/i.test(host) || unidentifiedHost && (outletHint === "The New York Times" || lines.slice(0, 15).some(l => /^\[The New York Times\]\(https:\/\/(?:www\.)?nytimes\.com\/?\)/.test(l)))) {
    const nyt = newYorkTimesCopy(raw);
    return nyt ? { ...fallback, ...nyt } : fallback;
  }
  if (/(^|\.)washingtonpost\.com$/i.test(host) ||
    unidentifiedHost && (outletHint === "The Washington Post" || /(?:Try )?Ask The Post AI/.test(raw) || postHeader)) {
    const post = washingtonPostCopy(raw);
    return post ? { ...fallback, ...post } : fallback;
  }
  if (!/(^|\.)axios\.com$/i.test(host)) return fallback;
  const sectionLine = lines.find(l => /\bago\s*-\s*/i.test(l) && l.includes(headline));
  const section = sectionLine ? decode(sectionLine.slice(0, sectionLine.indexOf(headline)).replace(/^.*?\bago\s*-\s*/i, "")).trim() : undefined;
  const titleAt = raw.lastIndexOf(headline, raw.indexOf("email (opens in new window)"));
  const shareAt = raw.indexOf("email (opens in new window)", Math.max(0, titleAt));
  if (titleAt < 0 || shareAt < titleAt + headline.length) return { ...fallback, section };
  const byline = raw.slice(titleAt + headline.length, shareAt).replace(/\s+/g, " ").trim();
  const authors = parseByline(byline);
  // Only the bounded publisher header is eligible; names in the article are not.
  if (!authors.length || authors.some(c => c.role !== "author" || c.name.length > 80 || !/^[\p{L}\p{M}.'’ -]+(?:,\s*(?:Jr\.?|Sr\.?|II|III|IV))?$/u.test(c.name) || c.name.trim().split(/\s+/).length < 2)) return { ...fallback, section };
  const promo = /Add Axios on Google(?:Add Axios as your preferred source to\s*see more of our stories on Google\.)?Add Axios on Google/i.exec(raw.slice(shareAt));
  const simplePromo = promo ? undefined : /Add Axios on Google/i.exec(raw.slice(shareAt));
  const marker = promo ?? simplePromo;
  if (!marker) return { ...fallback, section, byline, credits: authors };
  let start = shareAt + marker.index + marker[0].length;
  const credits: ParsedCredit[] = [...authors];
  // Photo credits belong to the bounded masthead, not the reported article.
  const photo = /^(Photo illustration|Photo|Illustration):\s*([^/\n]{2,100})\/(AFP via Getty Images|Getty Images|Axios|Reuters|Associated Press|AP)(?:\.\s*)?/i;
  while (true) {
    const match = raw.slice(start).trimStart().match(photo);
    if (!match) break;
    start += raw.slice(start).length - raw.slice(start).trimStart().length + match[0].length;
    credits.push({ name: match[2]!.trim(), role: /illustration/i.test(match[1]!) ? "other" : "photography", attribution: match[0].trim().replace(/\.$/, "") });
  }
  // If an unrecognized photo-credit boundary remains, keep the original rather
  // than guessing where the prose starts.
  if (/^(Photo|Illustration)/i.test(raw.slice(start).trimStart())) return { ...fallback, section, byline, credits };
  let body = raw.slice(start);
  const footer = /email\s*\(opens in new window\)\s*sms\s*\(opens in new window\)\s*facebook\s*\(opens in new window\)/i.exec(body);
  if (footer) body = body.slice(0, footer.index);
  body = decode(body).trim();
  if (body.length < 100) return { ...fallback, section, byline, credits };
  body = body.replace(/(?<![\p{L}])(Why it matters|Zoom in|Zoom out|What they're saying|Behind the scenes|By the numbers|The intrigue|Between the lines|What to watch):/gu, "\n\n$1:")
    .replace(/([.!?]["”])(?=[\p{Lu}“"])/gu, "$1 ")
    .replace(/(?<=[\p{Ll}\d])([.!?])(?=[\p{Lu}])/gu, "$1 ").replace(/\n{3,}/g, "\n\n").trim();
  return { ...fallback, text: body, section, byline, credits,
    contentNormalization: { method: "publisher-copy:axios", sourceCharacters: raw.length, articleCharacters: body.length } };
}

export function reconcileCredits(existing: { byline?: string; credits?: ParsedCredit[] }, supplied: { byline?: string; credits?: ParsedCredit[] }) {
  const oldAuthors = (existing.credits ?? []).filter(c => c.role === "author");
  const newAuthors = (supplied.credits ?? []).filter(c => c.role === "author");
  const key = (s: string) => s.normalize("NFC").trim().toLowerCase();
  const improves = newAuthors.length > 0 && oldAuthors.every(old => newAuthors.some(c => key(c.name) === key(old.name)));
  const preferred = improves ? supplied.credits ?? [] : existing.credits ?? supplied.credits ?? [];
  const other = improves ? existing.credits ?? [] : supplied.credits ?? [];
  const names = new Set(preferred.map(c => key(c.name)));
  const credits = [...preferred, ...other.filter(c => c.role !== "author" && !names.has(key(c.name)))];
  return { byline: improves ? supplied.byline : existing.byline ?? supplied.byline, credits, journalists: credits.filter(c => c.role === "author").map(c => c.name) };
}
