import { CLAIM_CATEGORIES, claimCategory, type CategoryId } from "./claim-taxonomy";

type Data = Record<string, any>;
type Row = { id: string; data: Data };
type Link = { claim_id: string; article_id: string; proposition?: string };
type Summary = { claimId: string; latestReportAt?: string | null; ongoing?: boolean };
type Focus = { categoryId: CategoryId; topicId: string; topicTitle: string; classificationReason: string };
const reason = "Grouped by the article's headline, subheading and retained lead—not individual claim actions. Development labels describe reporting, not verified outcomes. Source links and claim identities remain unchanged.";
const named = (categoryId: CategoryId, topicId: string, topicTitle: string): Focus =>
  ({ categoryId, topicId, topicTitle, classificationReason: reason });

/** One deterministic home per article; no models, identity guesses or registry writes. */
export function articleFocus(article: Data, id: string): Focus {
  const headline = String(article.title || "").trim();
  const lead = [article.subheading, article.description, article.summary, article.focusLead, article.fullText?.slice(0, 2400)]
    .filter(v => typeof v === "string").join(" ").slice(0, 3000);
  // A useful headline sets the subject. The lead refines its context; incidental
  // people mentioned later in a story must not displace that subject.
  const context = `${headline} ${lead}`;
  const opening = headline.split(/\s+(?:as|while|after|whereas|amid)\s+/i)[0];
  if (/\b(wall street|stock markets?|stock prices?|oil prices|financial markets?)\b/i.test(opening))
    return named("resources-capabilities", "financial-markets", "Financial markets — economic outlook");
  if (/\b(immigration|deportation|deportations|ice|border enforcement)\b/i.test(headline))
    return named("operations-enforcement", "immigration-enforcement", "Immigration — policy & enforcement");
  if (/\bhegseth\b/i.test(opening) && /\b(impeach|defiant|confidence|resign|replac|remov|fire|firing|future|leadership|partisan|government resources|statement)/i.test(context))
    return named("leadership-staffing", "person-pete-hegseth", "Pentagon leadership — Pete Hegseth");
  if (/\bcaine\b/i.test(opening) && /\b(joint chiefs|chairman|general|confidence|replac|remov|fir|future|leadership)/i.test(context))
    return named("leadership-staffing", "person-dan-caine", "Pentagon leadership — Dan Caine");
  if (/\b(susie wiles|ste(?:phen|ve) miller)\b/i.test(opening) && /\b(chief of staff|white house|staffing)\b/i.test(context))
    return named("leadership-staffing", "white-house-chief-of-staff", "White House leadership — Miller / Wiles");
  if (/\b(?:wiles|miller)\b/i.test(headline) && /\bchief of staff\b/i.test(headline) &&
      /\b(?:susie wiles|ste(?:phen|ve) miller)\b/i.test(lead) && !/\b(?!Stephen\b|Steve\b)[A-Z][a-z]+ Miller\b/.test(context))
    return named("leadership-staffing", "white-house-chief-of-staff", "White House leadership — Miller / Wiles");
  if (/\b(press secretary|communications director)\b/i.test(headline))
    return named("leadership-staffing", "white-house-communications", "White House — communications staffing");
  if (/\b(cabinet|administration)\b/i.test(headline) && /\b(firings?|dismissals?|reshuffl|staffing|departures?|replacements?)/i.test(headline))
    return named("leadership-staffing", "cabinet-staffing", "Trump administration — Cabinet staffing");
  if (/\b(doj|justice department|department of justice|attorney|eisenberg|dhillon)\b/i.test(headline) && /\b(resign|depart|exodus|oust|staff|stepp?ing down)/i.test(headline))
    return named("leadership-staffing", "justice-leadership", "Justice Department — leadership departures");
  if (/\bossoff\b/i.test(headline) && /\b(2028|presiden|straw poll)/i.test(context))
    return named("elections-control", "ossoff-2028", "Jon Ossoff — 2028 presidential prospects");
  if (/\b(gun control|gun violence|firearms? policy|public health)\b/i.test(headline))
    return named("policy-rulemaking", "firearms-public-health", "Firearms — public-health policy");
  if (/\b(supreme court|sotomayor|justices?)\b/i.test(headline) && /\bimmunity\b/i.test(context))
    return named("courts-legal", "presidential-immunity", "Supreme Court — presidential immunity");
  if (/\b(midterms?|election|congress|house|senate)\b/i.test(headline) &&
      /\b(majorit|control|balance of power|take congress|wins?|losses|defeat|rout|democrats prepare)/i.test(headline))
    return named("elections-control", "congress-political-control", "Congress — post-midterm balance of power");
  const country = /\b(iran|hormuz|tehran)\b/i.test(headline) ? "Iran" : /\b(ukraine|kyiv|zelensky)\b/i.test(headline) ? "Ukraine" : null;
  if (country && /\b(deal|talks|negotiat|ceasefire|diploma)/i.test(headline))
    return named("diplomacy-agreements", `${country.toLowerCase()}--diplomacy-agreements`, `${country} — diplomacy & negotiations`);
  if (country && /\b(strike|attack|war|military|forces|missile|blockade|troops)/i.test(headline) && !/\b(oil prices|markets|stocks)\b/i.test(headline))
    return named("operations-enforcement", `${country.toLowerCase()}--operations-enforcement`, `${country} — military operations`);
  // Whole-article fallback: retain a readable headline and one article home.
  // Never turn a first proper noun or an extracted sentence into a new topic.
  const category = claimCategory(headline) || "uncategorized";
  return named(category, `article-${id}`, headline || "Article focus not available");
}

const descriptors: [RegExp, string][] = [
  [/\bimpeach/i, "Impeachment efforts"],
  [/\b(?:may|might|consider|weigh|could|whether|possible)\b.{0,100}\b(?:fir|replac|remov|stay)/i, "Possible removal or replacement"],
  [/\bconfidence\b/i, "Leadership confidence"],
  [/\b(?:chief of staff|appoint|nominat|new role|transition)/i, "Leadership transition"],
  [/\b(?:resign|depart|stepp?ing down)/i, "Departures & resignation discussions"],
  [/\b(?:disagre|rift|friction|clashes)/i, "Internal relationships"],
  [/\b(?:government resources|taxpayer|government staff|partisan video)/i, "Use of public resources"],
  [/\b(?:investigat|subpoena|hearing|audit)/i, "Investigations & oversight"],
  [/\b(?:negotiat|ceasefire|peace talks)/i, "Negotiations"],
  [/\b(?:missile|airstrike|deployed|blockade)/i, "Military activity"],
];

export function organizeArticleFocus<T extends Summary>(records: Row[], links: Link[], summaries: T[], now = Date.now()) {
  const articles = new Map<string, Data>(), aliases = new Map<string, string>(), claims = new Map<string, Data>(), claimAliases = new Map<string, string>();
  for (const r of records) {
    if (r.data.hidden) continue;
    const id = r.data.baseId || r.id;
    if (r.data.kind === "article") { articles.set(id, r.data); aliases.set(id, id); aliases.set(r.id, id); }
    if (r.data.kind === "claim") { claims.set(id, r.data); claims.set(r.id, r.data); claimAliases.set(r.id, id); claimAliases.set(id, id); }
  }
  const sourceLinks = new Map<string, Map<string, Set<string>>>();
  const add = (claimId: string, articleId: string, text: string) => {
    claimId = claimAliases.get(claimId) ?? claimId;
    const id = aliases.get(articleId);
    if (!id) return;
    const byArticle = sourceLinks.get(claimId) ?? new Map<string, Set<string>>();
    const texts = byArticle.get(id) ?? new Set<string>();
    if (text) texts.add(text);
    byArticle.set(id, texts); sourceLinks.set(claimId, byArticle);
  };
  for (const l of links) add(l.claim_id, l.article_id, l.proposition || claims.get(l.claim_id)?.title || "");
  for (const s of summaries) for (const o of claims.get(s.claimId)?.observations ?? [])
    add(s.claimId, o.articleId, claims.get(s.claimId)?.title || "");
  const homes = new Map([...articles].map(([id, a]) => [id, articleFocus(a, id)]));
  const metadata = new Map<string, { developments: Set<string>; categories: Set<CategoryId>; subjects: Set<string> }>();
  for (const byArticle of sourceLinks.values()) for (const [id, texts] of byArticle) {
    const focus = homes.get(id)!;
    const m = metadata.get(focus.topicId) ?? { developments: new Set<string>(), categories: new Set<CategoryId>(), subjects: new Set<string>() };
    for (const name of articles.get(id)?.entities ?? []) if (typeof name === "string" && name.trim()) m.subjects.add(name.trim());
    for (const text of texts) {
      for (const [pattern, label] of descriptors) if (pattern.test(text)) m.developments.add(label);
      const cat = claimCategory(text);
      if (cat !== "uncategorized") m.categories.add(cat);
      for (const match of text.matchAll(/\b(?:Pete Hegseth|Stephen Miller|Steve Miller|Susie Wiles|Barack Obama|Jon Ossoff|Dan Caine)\b/g))
        m.subjects.add(match[0]);
    }
    metadata.set(focus.topicId, m);
  }
  const date = (id: string) => {
    const value = articles.get(id)?.publishedAt || articles.get(id)?.sourceSearch?.date;
    return typeof value === "string" && /^\d{4}-\d\d-\d\d(?:T|$)/.test(value) && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
  };
  return summaries.map(s => {
    const byArticle = sourceLinks.get(s.claimId) ?? new Map<string, Set<string>>();
    const buckets = new Map<string, string[]>();
    for (const id of [...byArticle.keys()].sort()) {
      const key = homes.get(id)!.topicId, ids = buckets.get(key) ?? [];
      ids.push(id); buckets.set(key, ids);
    }
    const placements = [...buckets].map(([key, articleIds]) => {
      const focus = homes.get(articleIds[0])!, m = metadata.get(key)!;
      const dates = articleIds.map(date).filter((d): d is string => !!d).sort();
      const latestReportAt = dates.at(-1) ?? null;
      const texts = articleIds.flatMap(id => [...byArticle.get(id)!]);
      const background = texts.length > 0 && texts.every(t =>
        /^\s*(?:since|in|during|back in)\s+(?:the\s+)?(?:19|20)\d{2}\b/i.test(t) ||
        /\b(historically|on average|statistically|every midterm|if elected as president|appointed.{0,45}former president)\b/i.test(t));
      const time = latestReportAt ? Date.parse(latestReportAt) : NaN;
      const ongoing = focus.categoryId !== "uncategorized" && !background && Number.isFinite(time) && time <= now + 300_000 && time >= now - 14 * 86_400_000;
      return { ...focus, primaryCategory: CLAIM_CATEGORIES.find(c => c.id === focus.categoryId)!.label, articleIds,
        developments: descriptors.map(([, label]) => label).filter(label => m.developments.has(label)),
        relatedSubjects: [...m.subjects].filter(name => !focus.topicTitle.includes(name) && !focus.topicTitle.includes(name.split(" ").at(-1)!)).sort().slice(0, 12),
        secondaryCategories: CLAIM_CATEGORIES.filter(c => c.id !== focus.categoryId && m.categories.has(c.id)),
        firstDate: dates[0]?.slice(0, 10) ?? null, lastDate: latestReportAt?.slice(0, 10) ?? null, latestReportAt, ongoing };
    });
    const primary = placements[0] ?? { ...named("uncategorized", "_unassigned", "No article attribution"),
      primaryCategory: "Uncategorized / Needs Review", articleIds: [], developments: [], relatedSubjects: [], secondaryCategories: [], ongoing: false, latestReportAt: null };
    return { ...s, ...primary, firstDate: (s as any).firstDate ?? null, lastDate: (s as any).lastDate ?? null,
      latestReportAt: s.latestReportAt ?? primary.latestReportAt ?? null, ongoing: placements.some(p => p.ongoing),
      articleIds: [...byArticle.keys()].sort(), placements, developmentType: primary.primaryCategory };
  });
}
