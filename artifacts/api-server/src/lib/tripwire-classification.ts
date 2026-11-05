export type Evidence = { signal: string; value: string; contentType?: string; contentFormat?: string; rank?: number };
export type Classification = { contentType?: string; contentFormat?: string; classificationEvidence?: Evidence[] };

const labels: Record<string, string> = {
  opinion: "opinion", opinions: "opinion", oped: "opinion", "op-ed": "opinion",
  editorial: "editorial", editorials: "editorial", "editorial board": "editorial",
  commentary: "commentary", comment: "commentary", columns: "commentary", column: "commentary", columnists: "commentary",
  analysis: "analysis", "news analysis": "analysis", breakingviews: "opinion",
  interview: "interview", interviews: "interview", "q&a": "interview",
  explainer: "explainer", explainers: "explainer", "fact check": "fact-check", "fact-check": "fact-check",
  review: "review", reviews: "review", transcript: "transcript", transcripts: "transcript",
  "press release": "press-release",
};
const schemaTypes: Record<string, string> = {
  OpinionNewsArticle: "opinion", AnalysisNewsArticle: "analysis", ReviewNewsArticle: "review",
  BackgroundNewsArticle: "explainer", ReportageNewsArticle: "news", NewsArticle: "news",
};
function labelValue(raw: string) { return raw.trim().toLowerCase().replace(/_/g, " ").replace(/\s+/g, " "); }
export function classifyContent(input: { url?: string; title?: string; labels?: unknown[]; schemaTypes?: string[]; evidence?: Evidence[] }): Required<Classification> {
  const evidence: Evidence[] = [...input.evidence ?? []];
  for (const raw of input.labels ?? []) {
    // RSS XML attributes can make categories objects despite rss-parser's types.
    const value = typeof raw === "string" ? raw : raw && typeof raw === "object"
      ? ["_", "#text", "term", "label"].map(key => (raw as Record<string, unknown>)[key]).find(v => typeof v === "string") : undefined;
    if (typeof value !== "string") continue;
    const type = labels[labelValue(value)];
    if (type) evidence.push({ signal: "Publisher section / feed label", value, contentType: type, rank: 100 });
    if (/^(video|audio|podcast|live updates?|live blog)$/i.test(value.trim())) evidence.push({
      signal: "Publisher format label", value, contentFormat: /live/i.test(value) ? "live-updates" : /audio|podcast/i.test(value) ? "audio" : "video", rank: 100,
    });
  }
  for (const raw of input.schemaTypes ?? []) {
    const value = raw.replace(/^https?:\/\/schema\.org\//, "");
    if (schemaTypes[value]) evidence.push({ signal: "Schema.org @type", value, contentType: schemaTypes[value], rank: value === "NewsArticle" ? 30 : 95 });
    if (value === "LiveBlogPosting") evidence.push({ signal: "Schema.org @type", value, contentFormat: "live-updates", rank: 95 });
  }
  if (input.url) {
    try {
      const path = new URL(input.url).pathname.toLowerCase().split("/").filter(Boolean);
      for (const segment of path) {
        const type = labels[segment];
        if (type) evidence.push({ signal: "Publisher URL section", value: `/${segment}/`, contentType: type, rank: 90 });
        const format = ["live", "live-updates", "liveblog", "live-blog", "livecoverage"].includes(segment) ? "live-updates"
          : ["video", "videos"].includes(segment) ? "video" : ["podcast", "podcasts", "audio"].includes(segment) ? "audio" : undefined;
        if (format) evidence.push({ signal: "Publisher URL format", value: `/${segment}/`, contentFormat: format, rank: 90 });
      }
    } catch { /* Invalid URLs provide no classification evidence. */ }
  }
  // An explicit publisher prefix is a label, unlike guessing genre from tone.
  const prefix = input.title?.match(/^(opinion|editorial|analysis|commentary|interview|explainer|fact[- ]check|transcript)\s*[:|—–-]\s+/i)?.[1];
  if (prefix && labels[labelValue(prefix)]) evidence.push({ signal: "Publisher headline label", value: prefix, contentType: labels[labelValue(prefix)], rank: 95 });
  const unique = [...new Map(evidence.map(e => [`${e.signal}:${e.value}:${e.contentType ?? e.contentFormat}`, e])).values()];
  const ranked = [...unique].sort((a, b) => (b.rank ?? 0) - (a.rank ?? 0));
  return { contentType: ranked.find(e => e.contentType)?.contentType ?? "unclassified",
    contentFormat: ranked.find(e => e.contentFormat)?.contentFormat ?? "text", classificationEvidence: unique };
}
export function mergeClassification(existing: Classification, incoming: Classification) {
  return classifyContent({ evidence: [...existing.classificationEvidence ?? [], ...incoming.classificationEvidence ?? []] });
}
