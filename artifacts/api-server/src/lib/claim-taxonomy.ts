import { developmentKind } from "./claim-developments";

export const CLAIM_CATEGORIES = [
  { id: "leadership-staffing", label: "Leadership & Staffing", description: "Appointments, nominations, possible firings, departures and succession, including related advice and confidence about the same personnel development." },
  { id: "authority-structure", label: "Authority & Organizational Structure", description: "Institutional powers, reporting lines, reorganizations and delegated authority." },
  { id: "advice-deliberations", label: "Advice & Deliberations", description: "Recommendations, options and internal planning without a more specific supported development; otherwise secondary context for that development." },
  { id: "institutional-relationships", label: "Institutional Relationships & Confidence", description: "Institutional trust, disagreements and confidence as the main development; otherwise secondary context for a specific personnel, policy, legal or operational story." },
  { id: "policy-rulemaking", label: "Policy & Rulemaking", description: "Legislation, executive orders, regulations, policy changes and formal directives." },
  { id: "operations-enforcement", label: "Operations & Enforcement", description: "Military missions, deployments, enforcement activity and operational results." },
  { id: "diplomacy-agreements", label: "Diplomacy & Agreements", description: "Negotiations, diplomatic engagements, ceasefires and international commitments." },
  { id: "resources-capabilities", label: "Resources & Capabilities", description: "Budgets, procurement, readiness, staffing capacity, equipment and logistical constraints." },
  { id: "oversight-accountability", label: "Oversight & Accountability", description: "Hearings, subpoenas, audits, ethics inquiries, investigations and impeachment proceedings." },
  { id: "courts-legal", label: "Courts & Legal Proceedings", description: "Lawsuits, charges, judicial rulings, injunctions, appeals and compliance with court orders." },
  { id: "records-information", label: "Records & Information Access", description: "Preservation, disclosure, withholding, classification and alteration of official records." },
  { id: "elections-control", label: "Elections & Political Control", description: "Election outcomes, governing majorities, coalitions and transfers of political control." },
  { id: "uncategorized", label: "Uncategorized / Needs Review", description: "No sufficiently clear development category; retained for review rather than forced into a match." },
] as const;
export type CategoryId = typeof CLAIM_CATEGORIES[number]["id"];
const categoryById = new Map(CLAIM_CATEGORIES.map(c => [c.id, c]));

/** Classify the reported action, not an article's overall subject or its truth. */
export function claimCategory(text: string, headline = "", now = Date.now()): CategoryId {
  const p = text.slice(0, 6000);
  if (/\b(court|judge|judicial|lawsuit|injunction|justices?|trial|prosecutors?)\b/i.test(p) &&
      /\b(ruled|ruling|ordered|injunction|sued|lawsuit|appeal|indicted|charges|trial|sentenced|convicted|acquitted)\b/i.test(p)) return "courts-legal";
  if (/\b(impeach(?:ment|ing|ed)?|subpoenas?|inspector general|ethics (?:inquiry|investigation)|congressional (?:hearing|investigation)|oversight hearing|audit(?:s|ed)?)\b/i.test(p)) return "oversight-accountability";
  if (/\b(advis[eo]rs?|aides|officials|generals|cabinet)\b.{0,90}\b(recommended|urged|advised|counseled|presented options|warned against)\b/i.test(p) ||
      /\b(?:presented|weighed|debated)\b.{0,50}\b(?:options|recommendations)\b/i.test(p)) return "advice-deliberations";
  const previous = developmentKind(p, headline, now);
  if (previous === "Leadership & staffing") return "leadership-staffing";
  if (previous === "Institutional relationships") return "institutional-relationships";
  if (/\b(foia|declassif(?:y|ied|ication)|record preservation|classified information|freedom of information)\b/i.test(p) ||
      /\b(?:records|documents|files|official account)\b.{0,65}\b(withheld|released|destroyed|deleted|altered|concealed|disclosed)\b/i.test(p) ||
      /\b(?:withheld|released|destroyed|deleted|altered|concealed|disclosed)\b.{0,65}\b(?:records|documents|files|official account)\b/i.test(p)) return "records-information";
  if (/\b(reorganiz(?:e|ed|ation|ing)|restructur(?:e|ed|ing)|chain of command|reporting lines|delegat(?:ed|ing) authority)\b/i.test(p) ||
      /\b(?:merge|abolish|dismantle|transfer)\b.{0,55}\b(?:agency|department|authority|powers|functions)\b/i.test(p)) return "authority-structure";
  if (/\b(budgets?|funding|appropriations?|procurement|readiness|ammunition|logistical constraints|equipment shortages|contract awards?)\b/i.test(p) ||
      /\bawarded\b.{0,40}\bcontract\b/i.test(p)) return "resources-capabilities";
  if (/\b(negotiat(?:e|es|ed|ing|ions?)|ceasefires?|treat(?:y|ies)|peace talks|diplomacy|diplomatic (?:talks|meeting|agreement)|bilateral (?:talks|meeting|agreement))\b/i.test(p)) return "diplomacy-agreements";
  if (/\b(executive orders?|rulemaking|regulations?|legislation|policy (?:change|reversal|proposal)|signed.{0,30}(?:law|bill)|tariffs?|sanctions?)\b/i.test(p)) return "policy-rulemaking";
  if (/\b(deport(?:ed|ing|ation|ations)?|arrests?|enforcement operation|raids?|deploy(?:ed|ment|ing)|airstrikes?|missiles?|troops|battlefield)\b/i.test(p) ||
      /\b(strikes?|attack(?:ed|s)?)\b/i.test(p) && /\b(military|iran|ukraine|navy|army|pentagon|war|forces)\b/i.test(p)) return "operations-enforcement";
  if (/\b(elections?|midterms?|ballots?|governing majority|control of (?:congress|the house|the senate)|coalition|voters|polls)\b/i.test(p)) return "elections-control";
  if (previous === "Decisions & policy") return "policy-rulemaking";
  return "uncategorized";
}

const slug = (v: string) => v.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "");
const personCategories = new Set<CategoryId>(["leadership-staffing", "advice-deliberations", "institutional-relationships", "oversight-accountability", "courts-legal"]);
const issues: [RegExp, string, string][] = [
  [/\b(iran|hormuz|tehran)\b/i, "iran", "Iran"],
  [/\b(ukraine|kyiv|zelensky)\b/i, "ukraine", "Ukraine"],
  [/\b(immigration|immigrants?|deport(?:ation|ations|ed|ing)?|asylum|ice raids)\b/i, "immigration-enforcement", "Immigration & deportation"],
  [/\b(israel|gaza|netanyahu|hamas)\b/i, "israel-gaza", "Israel & Gaza"],
  [/\b(tariffs?|trade (?:deal|agreement|war))\b/i, "trade-tariffs", "Trade & tariffs"],
  [/\b(taiwan|south china sea)\b/i, "taiwan", "Taiwan & regional security"],
  [/\b(government shutdown|spending bill|appropriations)\b/i, "government-funding", "Government funding"],
];

/** Topic labels organize navigation only: never join entity identities or merge claims. */
export function claimTopic(text: string, headline: string, category: CategoryId, claimId: string, millerContext?: "whitehouse" | "ambiguous") {
  const p = text.slice(0, 6000);
  const staffContext = `${p} ${headline}`;
  if (personCategories.has(category)) {
    if (/\bhegseth\b/i.test(p)) return { topicId: "person-pete-hegseth", topicTitle: "Pete Hegseth" };
    if (/\b(?:ste(?:phen|ve)\s+miller|susie\s+wiles)\b/i.test(p) ||
        millerContext !== "ambiguous" && /\b(?:miller|wiles)\b/i.test(p) &&
          (millerContext === "whitehouse" || /\bchief of staff\b/i.test(staffContext)))
      return { topicId: "white-house-chief-of-staff", topicTitle: "Stephen Miller / Susie Wiles · White House staffing" };
    if (/\b(?:dan caine|caine)\b/i.test(p)) return { topicId: "person-dan-caine", topicTitle: "Dan Caine" };
    // Use linked-headline context only for an otherwise unnamed role/pronoun.
    if (/\b(he|she|his|her|secretary|chief of staff)\b/i.test(p)) {
      if (/\bhegseth\b/i.test(headline)) return { topicId: "person-pete-hegseth", topicTitle: "Pete Hegseth" };
      if (millerContext !== "ambiguous" && /\b(?:ste(?:phen|ve)\s+miller|susie\s+wiles)\b/i.test(headline) && /\bchief of staff\b/i.test(staffContext))
        return { topicId: "white-house-chief-of-staff", topicTitle: "Stephen Miller / Susie Wiles · White House staffing" };
    }
  }
  for (const [pattern, topicId, topicTitle] of issues) if (pattern.test(p)) return { topicId, topicTitle };
  const names = p.match(/\b[A-Z][a-z]+(?:[-'][A-Za-z]+)?(?:\s+[A-Z][a-z]+(?:[-'][A-Za-z]+)?){1,3}\b/g) ?? [];
  for (const raw of names) {
    const name = raw.replace(/^(?:President|Secretary|Senator|Governor|General|Director|Asked|Before|After|When|Former)\s+/, "").trim();
    if (name.split(/\s+/).length < 2 || /\b(Trump|White House|United States|New York|CBS News|CNN|Supreme Court|Middle East|Central Command|National Security)\b/.test(name)) continue;
    return { topicId: `named-${slug(name)}`, topicTitle: name };
  }
  // Preserve an uncertain claim separately rather than fabricating a shared storyline.
  return { topicId: `claim-${claimId}`, topicTitle: p.length > 90 ? `${p.slice(0, 87)}…` : p || "Topic needs review" };
}

type Row = { id: string; data: Record<string, any> };
type Link = { claim_id: string; article_id: string; proposition?: string };
type Summary = { claimId: string; latestReportAt?: string | null; ongoing?: boolean };
export function organizeClaimCoverage<T extends Summary>(records: Row[], links: Link[], summaries: T[], now = Date.now()) {
  const articles = new Map<string, Row["data"]>(), claims = new Map<string, Row["data"]>();
  const canonicalArticle = new Map<string, string>(), byClaim = new Map<string, Link[]>();
  for (const r of records) {
    if (r.data.hidden) continue;
    const id = r.data.baseId || r.id;
    if (r.data.kind === "article") {
      for (const key of new Set([id, r.id])) { articles.set(key, r.data); canonicalArticle.set(key, id); }
    }
    if (r.data.kind === "claim") { claims.set(id, r.data); claims.set(r.id, r.data); }
  }
  for (const link of links) {
    const rows = byClaim.get(link.claim_id) ?? []; rows.push(link); byClaim.set(link.claim_id, rows);
  }
  // Disambiguate a bare surname only from explicit names in that same article's
  // attributed passages/headline, never from a globally assumed office holder.
  const context = new Map<string, { names: Set<string>; staffing: boolean }>();
  const addContext = (articleId: string, text: string) => {
    const id = canonicalArticle.get(articleId);
    if (!id) return;
    const facts = context.get(id) ?? { names: new Set<string>(), staffing: false };
    facts.staffing ||= /\bchief of staff\b/i.test(text);
    for (const match of text.matchAll(/\b([A-Z][a-z]+)\s+Miller\b/g)) {
      if (["Senator", "Secretary", "President", "Representative", "Chief"].includes(match[1])) continue;
      facts.names.add(/^Ste(?:phen|ve)$/.test(match[1]) ? "Stephen" : match[1]);
    }
    context.set(id, facts);
  };
  for (const [id, article] of articles) addContext(id, article.title || "");
  for (const link of links) if (link.proposition) addContext(link.article_id, link.proposition.slice(0, 6000));
  const relatedByTopic = new Map<string, Set<CategoryId>>();
  const organized = summaries.map(summary => {
    const claim = claims.get(summary.claimId) ?? {};
    const candidates = [...(byClaim.get(summary.claimId) ?? []),
      ...(claim.observations ?? []).map((o: any) => ({ article_id: o.articleId, proposition: claim.title }))];
    const articleIds = [...new Set<string>(candidates.map(l => canonicalArticle.get(l.article_id)).filter((id): id is string => !!id))];
    const categorized = candidates.filter(l => articles.has(l.article_id)).map(l => {
      const article = articles.get(l.article_id)!;
      const text = l.proposition || claim.title || "";
      const facts = context.get(canonicalArticle.get(l.article_id)!);
      const millerContext = facts?.names.size && [...facts.names].some(n => n !== "Stephen") ? "ambiguous" as const
        : facts?.staffing && facts.names.has("Stephen") ? "whitehouse" as const : undefined;
      return { category: claimCategory(text, article.title || "", now), text, headline: article.title || "", millerContext };
    });
    const votes = new Map<CategoryId, number>();
    for (const c of categorized) if (c.category !== "uncategorized") votes.set(c.category, (votes.get(c.category) ?? 0) + 1);
    const chosen = [...votes].sort((a, b) => b[1] - a[1] || CLAIM_CATEGORIES.findIndex(c => c.id === a[0]) - CLAIM_CATEGORIES.findIndex(c => c.id === b[0]))[0]?.[0] ??
      claimCategory(claim.title || "", "", now);
    const selected = categorized.find(c => c.category === chosen) ?? { text: claim.title || "", headline: "", millerContext: undefined };
    const category = categoryById.get(chosen)!;
    const identified = claimTopic(selected.text, selected.headline, chosen, summary.claimId, selected.millerContext);
    // A country is not a single development: military operations and diplomacy
    // need distinguishable scopes, not one enormous "Iran" staffing/policy group.
    const broadIssue = issues.some(([, id]) => id === identified.topicId);
    const topic = broadIssue ? { topicId: `${identified.topicId}--${chosen}`, topicTitle: `${identified.topicTitle} · ${category.label}` } : identified;
    const related = relatedByTopic.get(topic.topicId) ?? new Set<CategoryId>();
    related.add(chosen);
    for (const c of categorized) {
      related.add(c.category);
      // A specific proceeding can coexist with an explicit personnel action
      // or confidence context in the same passage; don't discard that context.
      const contextKind = developmentKind(c.text, c.headline, now);
      if (contextKind === "Leadership & staffing") related.add("leadership-staffing");
      if (contextKind === "Institutional relationships") related.add("institutional-relationships");
    }
    relatedByTopic.set(topic.topicId, related);
    const time = summary.latestReportAt ? Date.parse(summary.latestReportAt) : NaN;
    const background = /^\s*(?:since|in|during|back in)\s+(?:the\s+)?(?:19|20)\d{2}\b/i.test(selected.text) ||
      /\b(historically|on average|statistically|every midterm)\b/i.test(selected.text);
    const ongoing = chosen !== "uncategorized" && articleIds.length > 0 && !background &&
      Number.isFinite(time) && time <= now + 300_000 && time >= now - 14 * 86_400_000;
    return { ...summary, ongoing, developmentType: category.label, categoryId: chosen, primaryCategory: category.label,
      ...topic, articleIds, classificationReason: `Automatic text-based organization. ${category.description} Topic groups do not merge claims, identify anonymous sources, establish confirmation or infer a resolved status.` };
  });
  // Give each actual topic ONE navigation home. A long article with many
  // extracted statements must not outvote several distinct reporting articles.
  const groups = new Map<string, typeof organized>();
  for (const row of organized) {
    const members = groups.get(row.topicId) ?? []; members.push(row); groups.set(row.topicId, members);
  }
  const assignments = new Map<string, { primary: CategoryId; secondary: typeof CLAIM_CATEGORIES[number][] }>();
  for (const [topicId, members] of groups) {
    const voters = new Map<CategoryId, Set<string>>();
    for (const row of members) {
      if (row.categoryId === "uncategorized") continue;
      const ids = voters.get(row.categoryId) ?? new Set<string>();
      for (const articleId of row.articleIds) ids.add(articleId);
      voters.set(row.categoryId, ids);
    }
    const ranked = [...voters].sort((a, b) => b[1].size - a[1].size ||
      CLAIM_CATEGORIES.findIndex(c => c.id === a[0]) - CLAIM_CATEGORIES.findIndex(c => c.id === b[0]));
    const primary = ranked[0]?.[0] ?? "uncategorized";
    const secondary = CLAIM_CATEGORIES.filter(c => c.id !== primary && c.id !== "uncategorized" && relatedByTopic.get(topicId)?.has(c.id));
    assignments.set(topicId, { primary, secondary });
  }
  return organized.map(row => {
    const assignment = assignments.get(row.topicId)!;
    const category = categoryById.get(assignment.primary)!;
    return { ...row, categoryId: category.id, primaryCategory: category.label, developmentType: category.label,
      secondaryCategories: assignment.secondary,
      classificationReason: `One primary category for this topic, chosen by distinct article coverage, with catalog order breaking ties. This statement's original category: ${row.primaryCategory}. Secondary tags describe related reporting in the topic, not additional groups. ${row.classificationReason}` };
  });
}
