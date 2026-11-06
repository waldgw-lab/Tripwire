import { DOMParser } from "linkedom";
import Parser from "rss-parser";

// keepArray is essential: rss-parser otherwise replaces <source> with its text,
// dropping the publisher URL needed to validate Google News attribution.
const parser = new Parser({ customFields: { item: [["dc:creator", "creator"], ["source", "publisherSource", { keepArray: true }]] } });
export type IntakeItem = Parser.Item & { raw?: string; publisherSource?: { _?: string; $?: { url?: string } }[] };
export async function parseRssItems(xml: string): Promise<IntakeItem[]> {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error("Document type declarations are not accepted");
  const feed = await parser.parseString(xml);
  if (!feed.items) throw new Error("Response is not an RSS or Atom feed");
  return feed.items as IntakeItem[];
}

export type IntakeSource = { url: string; kind: "rss" | "sitemap" | "google-news"; role: "primary" | "supplement" | "fallback" };
export type FeedHealth = IntakeSource & { status: "connected" | "failed" | "stale" | "empty" | "standby"; checkedAt?: string; message: string; items: number; latestItemAt?: string; nextAttemptAt?: string; failures?: number };
const rss = (url: string, role: IntakeSource["role"] = "supplement"): IntakeSource => ({ url, role, kind: "rss" });
const google = (domain: string): IntakeSource => ({
  kind: "google-news", role: "fallback",
  url: `https://news.google.com/rss/search?${new URLSearchParams({ q: `site:${domain} when:7d`, hl: "en-US", gl: "US", ceid: "US:en" })}`,
});
export const publisherDomains: Record<string, string[]> = {
  "The Washington Post": ["washingtonpost.com"], "The New York Times": ["nytimes.com"], Axios: ["axios.com"],
  CBS: ["cbsnews.com"], "The Atlantic": ["theatlantic.com"], "The Wall Street Journal": ["wsj.com"],
  Reuters: ["reuters.com"], ABC: ["abcnews.go.com"], CNN: ["cnn.com"],
  "Washington Examiner": ["washingtonexaminer.com"], "Daily Mail": ["dailymail.co.uk"], NBC: ["nbcnews.com"],
};
const plans: Record<string, IntakeSource[]> = {
  "The Washington Post": [
    rss("https://www.washingtonpost.com/arcio/rss/category/politics/", "primary"),
    rss("https://www.washingtonpost.com/arcio/rss/category/world/"),
    { url: "https://www.washingtonpost.com/sitemaps/news-sitemap.xml.gz", kind: "sitemap", role: "supplement" },
    rss("https://feeds.washingtonpost.com/rss/national", "fallback"), google("washingtonpost.com"),
  ],
  "The New York Times": [
    rss("https://rss.nytimes.com/services/xml/rss/nyt/Politics.xml", "primary"),
    rss("https://rss.nytimes.com/services/xml/rss/nyt/World.xml"),
    rss("https://rss.nytimes.com/services/xml/rss/nyt/US.xml", "fallback"),
  ],
  Axios: [rss("https://api.axios.com/feed/", "primary"), rss("https://www.axios.com/feeds/feed.rss", "fallback")],
  CBS: [rss("https://www.cbsnews.com/latest/rss/politics", "primary"), rss("https://www.cbsnews.com/latest/rss/world"), rss("https://www.cbsnews.com/latest/rss/us", "fallback")],
  "The Atlantic": [rss("https://www.theatlantic.com/feed/all/", "primary"), rss("https://www.theatlantic.com/feed/channel/politics/", "fallback")],
  "The Wall Street Journal": [
    rss("https://feeds.content.dowjones.io/public/rss/RSSWorldNews", "primary"),
    rss("https://feeds.content.dowjones.io/public/rss/RSSUSnews"),
  ],
  Reuters: [google("reuters.com")],
  ABC: [rss("https://abcnews.go.com/abcnews/politicsheadlines", "primary"), rss("https://abcnews.go.com/abcnews/internationalheadlines"), rss("https://abcnews.go.com/abcnews/usheadlines", "fallback")],
  CNN: [
    { url: "https://www.cnn.com/sitemap/news.xml", kind: "sitemap", role: "primary" },
    { url: "https://www.cnn.com/sitemaps/cnn/news.xml", kind: "sitemap", role: "fallback" },
    google("cnn.com"),
  ],
  "Washington Examiner": [rss("https://www.washingtonexaminer.com/feed/", "primary"), rss("https://www.washingtonexaminer.com/policy/defense/feed/"), rss("https://www.washingtonexaminer.com/policy/foreign-policy/feed/", "fallback")],
  "Daily Mail": [rss("https://www.dailymail.co.uk/news/us-politics/index.rss", "primary"), rss("https://www.dailymail.co.uk/news/worldnews/index.rss"), rss("https://www.dailymail.co.uk/news/index.rss", "fallback")],
  NBC: [rss("https://feeds.nbcnews.com/nbcnews/public/politics", "primary"), rss("https://feeds.nbcnews.com/nbcnews/public/world"), rss("https://feeds.nbcnews.com/nbcnews/public/news", "fallback")],
};
export function intakeSources(title: string, configured?: string): IntakeSource[] {
  const sources = plans[title] ?? [];
  // Replace known dead legacy defaults, but respect explicitly customized feeds.
  const obsolete = ["https://feeds.washingtonpost.com/rss/politics", "https://rss.cnn.com/rss/cnn_allpolitics.rss"];
  if (configured && !obsolete.includes(configured) && !sources.some(s => s.url === configured)) {
    return [rss(configured, "primary"), ...sources.map(s => ({ ...s, role: "fallback" as const }))];
  }
  return sources;
}
export function publisherUrl(raw: string, outlet: string) {
  try {
    const u = new URL(raw);
    return u.protocol === "https:" && !u.username && !u.password && (!u.port || u.port === "443") &&
      (publisherDomains[outlet] ?? []).some(domain => u.hostname === domain || u.hostname.endsWith(`.${domain}`));
  } catch { return false; }
}
export function titleKey(title: string) {
  return title.toLowerCase().normalize("NFKC").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}
export function discoveryTitle(title: string, publisher: string) {
  const suffix = ` - ${publisher}`;
  return title.endsWith(suffix) ? title.slice(0, -suffix.length) : title;
}
export function feedFreshness(dates: (string | undefined)[], now = Date.now()) {
  const valid = dates.map(d => Date.parse(d ?? "")).filter(t => Number.isFinite(t) && t <= now + 86_400_000);
  const latest = valid.length ? Math.max(...valid) : undefined;
  return { latestItemAt: latest === undefined ? undefined : new Date(latest).toISOString(),
    stale: latest === undefined || now - latest > 7 * 86_400_000 };
}
export function retryAfter(failures: number, now = Date.now()) {
  return new Date(now + Math.min(12 * 3_600_000, 30 * 60_000 * 2 ** Math.min(5, failures - 1))).toISOString();
}
export type SitemapItem = { title: string; link: string; isoDate?: string; raw: string; contentSnippet?: string };
export function sitemapItems(xml: string, outlet: string): SitemapItem[] {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error("Document type declarations are not accepted");
  const document = new DOMParser().parseFromString(xml, "text/xml");
  if (document.documentElement?.localName !== "urlset") throw new Error("Expected a publisher news sitemap, not an index or HTML page");
  return Array.from(document.getElementsByTagName("url")).slice(0, 1000).flatMap(node => {
    const link = node.getElementsByTagName("loc")[0]?.textContent?.trim();
    const title = node.getElementsByTagName("news:title")[0]?.textContent?.trim() || node.getElementsByTagName("video:title")[0]?.textContent?.trim();
    const contentSnippet = node.getElementsByTagName("video:description")[0]?.textContent?.trim() || undefined;
    const date = node.getElementsByTagName("news:publication_date")[0]?.textContent?.trim() || node.getElementsByTagName("video:publication_date")[0]?.textContent?.trim();
    // lastmod is not a publication time; URL slugs are not verified headlines.
    if (!link || !title || !publisherUrl(link, outlet)) return [];
    return [{ title, link, isoDate: date && Number.isFinite(Date.parse(date)) ? new Date(date).toISOString() : undefined, raw: node.toString(), contentSnippet }];
  });
}
