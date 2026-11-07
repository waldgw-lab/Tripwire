import { sourceKey, sourceUrl, titleKey } from "./source-search-rules";

export type InputRow = { row: number; data: Record<string, string> };
export type Inventory = {
  packageHash: string; manifest: { file: string; hash: string; bytes: number }[];
  sheets: Record<string, { headers: Record<string, string>; rows: InputRow[] }>;
  documents: Record<string, string[]>;
};
export type Segment = {
  file: string; start: number; end: number; title: string; url: string | null;
  raw: string; text: string; complete: boolean; reason: string; byline?: string;
};
export type CorpusArticle = {
  url: string; title: string; outlet: string; rows: { sheet: string; row: number; data: Record<string, string> }[];
  segments: Segment[]; conflicts: string[];
};
export const masterSheets = ["WaPo", "NYT", "FT", "Axios", "WSJ"];
const domains: Record<string, string> = { "The Washington Post": "washingtonpost.com", "The New York Times": "nytimes.com",
  "Financial Times": "ft.com", Axios: "axios.com", "The Wall Street Journal": "wsj.com" };
export const splitIds = (s?: string) => (s ?? "").split(";").map(s => s.trim().replace(/^"|"$/g, "")).filter(Boolean);
export function corpusPlan(input: Inventory) {
  const articles = new Map<string, CorpusArticle>();
  const dispositions: { sheet: string; row: number; status: string; reason?: string; url?: string }[] = [];
  const docUrls = new Map<string, Set<string>>();
  const normalizeId = (s: string) => s.trim().replace(/^"|"$/g, "");
  for (const [sheet, { rows }] of Object.entries(input.sheets)) {
    if (!masterSheets.includes(sheet) && !/^(WaPo Hudson|NYT Haberman|NYT Schmitt|NYT Kanno-Youngs)$/.test(sheet)) continue;
    for (const row of rows) {
      const d = row.data, url = sourceUrl(d.URL ?? ""), outlet = d["Source Name"] ?? "";
      const domain = domains[outlet];
      if (!url || !domain || !d.Title?.trim() || ![domain, `www.${domain}`].includes(new URL(url).hostname)) {
        dispositions.push({ sheet, row: row.row, status: "quarantined", reason: "Invalid URL/title/outlet consistency" }); continue;
      }
      const id = normalizeId(d["Document ID"] ?? "");
      if (id) { const urls = docUrls.get(id) ?? new Set(); urls.add(url); docUrls.set(id, urls); }
      const prior = articles.get(url);
      if (prior) {
        prior.rows.push({ sheet, ...row });
        if (titleKey(prior.title) !== titleKey(d.Title)) prior.conflicts.push(`Headline variant at ${sheet}:${row.row}`);
        dispositions.push({ sheet, row: row.row, status: "duplicate-url", url });
      } else {
        articles.set(url, { url, title: d.Title.trim(), outlet, rows: [{ sheet, ...row }], segments: [], conflicts: [] });
        dispositions.push({ sheet, row: row.row, status: "candidate", url });
      }
    }
  }
  const segments: Segment[] = [];
  for (const [file, ps] of Object.entries(input.documents)) {
    if (file.startsWith("NYT_Coverage")) {
      const starts = ps.flatMap((p, i) => /^https?:\/\/\S+$/.test(p.trim()) ? [i] : []);
      for (let k = 0; k < starts.length; k++) {
        const u = starts[k]!, start = u - 3, end = k + 1 < starts.length ? starts[k + 1]! - 3 : ps.length;
        const raw = ps.slice(start, end).join("\n\n").trim();
        const text = ps.slice(u + 1, end).join("\n\n").trim();
        segments.push({ file, start, end, title: ps[start] ?? "", url: sourceUrl(ps[u]!), raw, text,
          complete: false, reason: "User-supplied archive segment; completeness not independently established; yearless header retained" });
      }
    } else if (/^(WaPo_Coverage|07_Washington_Post)/.test(file)) {
      // Explicit section headers in the two supplied copies, not fuzzy topic matching.
      const boundaries = ps.flatMap((p, i) => /^Close Trump aides|^Contradicting public statements|^Opinion: Hegseth/.test(p) ? [i] : []);
      for (let k = 0; k < boundaries.length; k++) {
        const start = boundaries[k]!, end = boundaries[k + 1] ?? ps.length;
        const lines = ps.slice(start, end);
        const mixed = lines[0]!.startsWith("Opinion:");
        const raw = lines.join("\n\n").trim();
        const byIndex = lines.findIndex(p => /^By[\s\u00a0]/.test(p));
        const title = lines[0]!.replace(/^Opinion: /, "");
        const matches = [...articles.values()].filter(a => a.outlet === "The Washington Post" && titleKey(a.title) === titleKey(title));
        const urlLine = lines.find(p => /^https?:\/\//.test(p));
        const url = urlLine ? sourceUrl(urlLine) : matches.length === 1 ? matches[0]!.url : null;
        // Only these two explicitly bounded full article copies have been inspected.
        const body = mixed ? lines.slice(byIndex + 1).filter(p => p.trim() && !/^August |^https?:/.test(p))
          .slice(0, 4).join("\n\n") : lines.slice(byIndex + 1).filter(p =>
          !/^Washington Post Exclusive$|^\(Video:|^\s*$/.test(p) &&
          !/^\s*(A catering truck is parked|President Donald Trump disembarks|The new VC-25B|Air Force One and the C-32A were parked| Trump speaks with reporters)/.test(p))
          .map(p => p.replace(/Ask The Post AIDive deeper/g, "")).join("\n\n");
        segments.push({ file, start, end, title, url, raw, text: body.trim(), complete: !mixed && byIndex >= 0 && !!url,
          byline: lines[byIndex]?.replace(/^By[\s\u00a0]+/, ""), reason: mixed ? "Partial Boot excerpt only; third-person synthesis and analytical note retained separately, never publisher body" : "Inspected structurally bounded user-supplied full article copy" });
      }
    }
  }
  for (const segment of segments) {
    if (!segment.url) continue;
    let article = articles.get(segment.url);
    if (!article) {
      const host = new URL(segment.url).hostname.replace(/^www\./, "");
      const outlet = Object.entries(domains).find(([, d]) => d === host)?.[0];
      if (!outlet) continue;
      article = { url: segment.url, title: segment.title, outlet, rows: [], segments: [], conflicts: [] };
      articles.set(segment.url, article);
    }
    if (titleKey(article.title) !== titleKey(segment.title)) {
      article.conflicts.push(`Archive title conflict: ${segment.file}:${segment.start}`);
      continue;
    }
    article.segments.push(segment);
  }
  return { articles: [...articles.values()], dispositions, segments, docUrls,
    ambiguousExternalIds: [...docUrls].filter(([, urls]) => urls.size !== 1).map(([id]) => id),
    hash: sourceKey(input) };
}
