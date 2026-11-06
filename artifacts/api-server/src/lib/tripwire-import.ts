import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import { pdfDocument } from "./tripwire-pdf";
import mammoth from "mammoth";
import WordExtractor from "word-extractor";
import { parseByline } from "./tripwire-bylines";
import { captureContent, plainText, type Capture } from "./tripwire-content";
import type { RecordData } from "./tripwire-store";
import { classifyContent } from "./tripwire-classification";
import { parsePublisherCopy, pasteSourceUrl } from "./tripwire-paste";
import { inferArticleTopic } from "./tripwire-signals";

const publishers: [string, string][] = [
  ["washingtonpost.com", "The Washington Post"], ["nytimes.com", "The New York Times"], ["axios.com", "Axios"],
  ["cbsnews.com", "CBS"], ["theatlantic.com", "The Atlantic"], ["wsj.com", "The Wall Street Journal"],
  ["reuters.com", "Reuters"], ["abcnews.go.com", "ABC"], ["cnn.com", "CNN"], ["washingtonexaminer.com", "Washington Examiner"],
  ["dailymail.co.uk", "Daily Mail"], ["dailymail.com", "Daily Mail"], ["nbcnews.com", "NBC"],
];
export function canonicalUrl(raw?: string) {
  if (!raw?.trim()) return undefined;
  const url = new URL(raw.trim());
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error("Use an http or https source URL");
  for (const key of [...url.searchParams.keys()]) if (/^(utm_|fbclid|gclid)/i.test(key)) url.searchParams.delete(key);
  url.hash = ""; url.hostname = url.hostname.replace(/^www\./, "");
  url.pathname = url.pathname.replace(/\/+$/, "") || "/";
  return url.href;
}
export function inferOutlet(url?: string, text = "") {
  if (url) {
    const hostname = new URL(url).hostname;
    const known = publishers.find(([host]) => hostname === host || hostname.endsWith(`.${host}`));
    if (known) return known[1];
  }
  return publishers.find(([, name]) => text.split("\n").slice(0, 15).some(line => line.trim().toLowerCase() === name.toLowerCase()))?.[1];
}
export function matchImport<T extends RecordData & { id: string }>(candidate: Pick<RecordData, "title" | "url" | "outlet">, records: T[]) {
  const articles = records.filter(r => r.kind === "article");
  const safeUrl = (value?: string) => { try { return canonicalUrl(value); } catch { return undefined; } };
  const url = safeUrl(candidate.url);
  const byUrl = url ? articles.filter(r => safeUrl(r.url) === url) : [];
  if (byUrl.length === 1) return { record: byUrl[0], reason: "Matching source URL" };
  if (byUrl.length > 1) return { ambiguous: true };
  const titleKey = (value: string) => value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  const title = titleKey(candidate.title);
  if (title.length < 8) return {};
  const byTitle = articles.filter(r => titleKey(r.title) === title && (!candidate.outlet || r.outlet?.toLowerCase() === candidate.outlet.toLowerCase()));
  return byTitle.length === 1 ? { record: byTitle[0], reason: "Matching headline and publisher" } : byTitle.length > 1 ? { ambiguous: true } : {};
}

export async function documentText(bytes: Buffer, filename: string) {
  if (bytes.length > 10485760) throw new Error("Files must be 10 MB or smaller");
  let text: string;
  if (bytes.subarray(0, 5).toString() === "%PDF-") {
    const result = await pdfDocument(bytes);
    text = result.text;
  } else if (bytes.subarray(0, 8).toString("hex") === "d0cf11e0a1b11ae1") {
    const document = await new WordExtractor().extract(bytes);
    text = [document.getHeaders(), document.getBody(), document.getTextboxes(), document.getFootnotes(), document.getEndnotes()].filter(Boolean).join("\n\n");
  } else if (bytes.subarray(0, 2).toString() === "PK" && /\.docx$/i.test(filename)) {
    let total = 0, entries = 0;
    for (let offset = 0; offset < bytes.length - 46; offset++) if (bytes.readUInt32LE(offset) === 0x02014b50) {
      total += bytes.readUInt32LE(offset + 24); entries++;
      if (total > 25_000_000 || entries > 3000) throw new Error("Document expands beyond the safe parsing limit");
    }
    text = (await mammoth.extractRawText({ buffer: bytes })).value;
  } else throw new Error("The file is not a supported PDF, DOC or DOCX document");
  text = text.trim();
  if (!text) throw new Error("No readable text was found. Scanned or encrypted documents need text extraction before import.");
  if (text.length > 1_000_000) throw new Error("Extracted text exceeds the 1,000,000-character intake limit; no content was saved or truncated.");
  return text;
}

export async function documentCandidate(bytes: Buffer, filename: string, url?: string, outletHint?: string) {
  if (bytes.length > 10485760) throw new Error("Files must be 10 MB or smaller");
  const pdf = bytes.subarray(0, 5).toString() === "%PDF-" ? await pdfDocument(bytes) : undefined;
  const text = pdf ? pdf.text.trim() : await documentText(bytes, filename);
  if (!text || text.length > 1_000_000) throw new Error("Document has no readable text or exceeds the 1,000,000-character intake limit");
  return { text, candidate: textCandidate(text, url, pdf?.outlet ?? outletHint) };
}

export function textCandidate(text: string, url?: string, outletHint?: string): RecordData {
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const sourceUrl = url ?? pasteSourceUrl(text);
  const cleanUrl = sourceUrl ? canonicalUrl(sourceUrl) : undefined;
  const copy = parsePublisherCopy(text, cleanUrl, outletHint);
  const outlet = inferOutlet(cleanUrl, text) ?? copy.outlet ?? outletHint;
  const byline = copy.byline;
  const rawTitle = (lines.find(l => l !== outlet && l !== sourceUrl && l !== byline && !/^(published|updated)\s*:/i.test(l)) ?? "");
  const title = (copy.contentNormalization ? copy.title : rawTitle.replace(/^\[([^\]]+)\]\(https?:\/\/[^)]+\)$/, "$1")).slice(0, 250);
  const credits = copy.credits;
  return { kind: "article", title, url: cleanUrl, outlet, byline, credits, journalists: credits?.filter(c => c.role === "author").map(c => c.name),
    ...classifyContent({ url: cleanUrl, title }),
    publishedAt: copy.publishedAt, topic: inferArticleTopic(title, copy.text, copy.section),
    summary: copy.contentNormalization ? copy.summary ?? copy.text.slice(0, 450) : undefined,
    fullText: copy.text, contentNormalization: copy.contentNormalization, fullTextComplete: false, sourceType: cleanUrl && /^(?:www\.)?(?:x|twitter)\.com$/i.test(new URL(cleanUrl).hostname) ? "x" : "article",
    sentiment: "unassessed", reportingType: "unassessed" };
}

export function htmlClassification(html: string, sourceUrl: string, title?: string) {
  return classificationFromDocument(parseHTML(html).document, sourceUrl, title);
}
function classificationFromDocument(document: ReturnType<typeof parseHTML>["document"], sourceUrl: string, title?: string) {
  const labels: string[] = [];
  const types: string[] = [];
  const walk = (node: unknown, depth = 0) => {
    if (!node || depth > 5) return;
    if (Array.isArray(node)) { node.forEach(n => walk(n, depth + 1)); return; }
    if (typeof node !== "object") return;
    const data = node as Record<string, unknown>;
    for (const type of Array.isArray(data["@type"]) ? data["@type"] : [data["@type"]]) if (typeof type === "string") types.push(type);
    for (const label of Array.isArray(data.articleSection) ? data.articleSection : [data.articleSection]) if (typeof label === "string") labels.push(label);
    walk(data["@graph"], depth + 1); walk(data.mainEntity, depth + 1);
  };
  for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
    try { walk(JSON.parse(script.textContent ?? "")); } catch { /* Other signals remain valid. */ }
  }
  for (const name of ["article:section", "parsely-section", "section", "CG", "SCG", "genre"]) {
    const value = document.querySelector(`meta[property="${name}"],meta[name="${name}"]`)?.getAttribute("content");
    if (value) labels.push(...value.split(",").map((s: string) => s.trim()));
  }
  const ogType = document.querySelector('meta[property="og:type"]')?.getAttribute("content") ?? "";
  const result = classifyContent({ url: sourceUrl, title, labels, schemaTypes: types });
  // A video embedded in a NewsArticle does NOT make the article a video.
  if (/^video[.:]/.test(ogType) || types.includes("VideoObject") && !types.some(t => /Article|Posting/.test(t))) {
    return classifyContent({ evidence: [...result.classificationEvidence, { signal: "Primary publisher media type", value: ogType || "VideoObject", contentFormat: "video", rank: 95 }] });
  }
  return result;
}
export function htmlCandidate(html: string, sourceUrl: string) {
  const { document } = parseHTML(html);
  const meta = (name: string) => document.querySelector(`meta[property="${name}"],meta[name="${name}"]`)?.getAttribute("content") ?? undefined;
  const nodes: Record<string, unknown>[] = [];
  const walk = (value: unknown, depth = 0) => {
    if (!value || depth > 5 || nodes.length >= 1000) return;
    if (Array.isArray(value)) { value.forEach(v => walk(v, depth + 1)); return; }
    if (typeof value !== "object") return;
    const node = value as Record<string, unknown>;
    nodes.push(node);
    for (const key of ["@graph", "mainEntity", "mainEntityOfPage", "video"]) walk(node[key], depth + 1);
  };
  for (const element of document.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      walk(JSON.parse(element.textContent ?? ""));
    } catch { /* Invalid publisher JSON-LD does not prevent extracting its visible article text. */ }
  }
  const initialClassification = classificationFromDocument(document, sourceUrl, meta("og:title"));
  const isVideo = initialClassification.contentFormat === "video";
  const videos = nodes.filter(n => (Array.isArray(n["@type"]) ? n["@type"] : [n["@type"]]).includes("VideoObject"));
  const samePage = (n: Record<string, unknown>) => {
    const page = n.mainEntityOfPage;
    const url = typeof page === "string" ? page : page && typeof page === "object" ? (page as Record<string, unknown>).url : n.url;
    try { return typeof url === "string" && canonicalUrl(url) === canonicalUrl(sourceUrl); } catch { return false; }
  };
  const video = videos.find(samePage) ?? (videos.length === 1 ? videos[0] : undefined);
  const ld = isVideo ? video : nodes.find(node => /article|report|posting/i.test(String(node["@type"])));
  const description = (isVideo && typeof video?.description === "string" ? plainText(video.description) : "") ||
    plainText(meta("description") ?? meta("og:description") ?? "");
  // Readability can mistake navigation and related stories for a video's body.
  // Retain the publisher's description, not an invented transcript.
  const readable = isVideo ? undefined : new Readability(document.cloneNode(true) as never).parse();
  // Mail's JSON-LD often contains only a teaser, and generic Readability can pick
  // a short related-links block. Its own article paragraph markers are reliable.
  const mailParagraphs = inferOutlet(sourceUrl) === "Daily Mail"
    ? [...document.querySelectorAll("#js-article-text p.mol-para-with-font")].map(p => p.textContent?.trim()).filter(Boolean).join("\n\n") : "";
  const text = (isVideo ? description : mailParagraphs || (typeof ld?.articleBody === "string" ? plainText(ld.articleBody) : readable?.textContent ?? "")).trim();
  if (!text || text.length < 40) throw new Error("No usable article text was available at this URL. Paste or upload the content instead.");
  if (text.length > 1_000_000) throw new Error("Article text exceeds the intake limit; no content was truncated.");
  const candidate = textCandidate(text, sourceUrl);
  const authors = ld?.author;
  const authorNames = (Array.isArray(authors) ? authors : authors ? [authors] : []).flatMap(author => typeof author === "string" ? [author] : author && typeof author === "object" && "name" in author ? [String(author.name)] : []);
  const byline = authorNames.join(", ") || meta("author") || readable?.byline || undefined;
  const page = isVideo && video?.mainEntityOfPage && typeof video.mainEntityOfPage === "object" ? video.mainEntityOfPage as Record<string, unknown> : undefined;
  const published = typeof ld?.datePublished === "string" ? ld.datePublished : typeof page?.datePublished === "string" ? page.datePublished : meta("article:published_time");
  const title = String(ld?.headline ?? (isVideo ? ld?.name : undefined) ?? meta("og:title") ?? readable?.title ?? candidate.title).trim();
  const outlet = inferOutlet(sourceUrl) ?? meta("og:site_name");
  const credits = byline ? parseByline(byline) : undefined;
  const classification = classificationFromDocument(document, sourceUrl, title);
  return { ...candidate, ...classification, title, outlet, byline, credits, journalists: credits?.filter(c => c.role === "author").map(c => c.name),
    extractionMethod: isVideo ? "video description" : mailParagraphs ? "publisher article paragraphs" : typeof ld?.articleBody === "string" ? "structured article body" : "article extraction",
    contentNormalization: { method: isVideo ? "html:video-description" : "html:article-extraction", sourceCharacters: html.length, articleCharacters: text.length },
    publishedAt: published && !isNaN(Date.parse(published)) ? new Date(published).toISOString() : undefined,
    summary: description || undefined };
}
export function importCapture(candidate: RecordData, source: string, extra: Partial<Capture> = {}) {
  return captureContent(candidate.fullText ?? "", source, { ...extra, sourceUrl: candidate.url ?? extra.sourceUrl });
}
