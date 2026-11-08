import { developmentKind } from "./claim-developments";

export const CLAIM_CATEGORIES = [
  { id: "leadership-staffing", label: "Leadership & Staffing", description: "Appointments, nominations, possible firings, departures and succession, including related advice and confidence about the same personnel development." },
  { id: "authority-structure", label: "Authority & Organizational Structure", description: "Institutional powers, reporting lines, reorganizations and delegated authority." },
  { id: "advice-deliberations", label: "Advice & Deliberations", description: "Recommendations, options and internal planning without a more specific supported development; otherwise secondary context for that development." },
  { id: "institutional-relationships", label: "Institutional Relationships & Confidence", description: "Institutional trust, disagreements and confidence as the main development; otherwise secondary context for a specific personnel, policy, legal or operational story." },
  { id: "policy-rulemaking", label: "Policy & Rulemaking", description: "Legislation, executive orders, regulations, policy changes and formal directives." },
  { id: "operations-enforcement", label: "Operations & Enforcement", description: "Military missions, deployments, enforcement activity and operational results." },
  { id: "diplomacy-agreements", label: "Diplomacy & Agreements", description: "Negotiations, diplomatic engagements, ceasefires and international commitments." },
  { id: "resources-capabilities", label: "Resources & Capabilities", description: "Budgets, economic resources, procurement, readiness, staffing capacity, equipment and logistical constraints." },
  { id: "oversight-accountability", label: "Oversight & Accountability", description: "Hearings, subpoenas, audits, ethics inquiries, investigations and impeachment proceedings." },
  { id: "courts-legal", label: "Courts & Legal Proceedings", description: "Lawsuits, charges, judicial rulings, injunctions, appeals and compliance with court orders." },
  { id: "records-information", label: "Records & Information Access", description: "Preservation, disclosure, withholding, classification and alteration of official records." },
  { id: "elections-control", label: "Elections & Political Control", description: "Election outcomes, governing majorities, coalitions and transfers of political control." },
  { id: "uncategorized", label: "Uncategorized / Needs Review", description: "No sufficiently clear development category; retained for review rather than forced into a match." },
] as const;
export type CategoryId = typeof CLAIM_CATEGORIES[number]["id"];

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

export { organizeArticleFocus as organizeClaimCoverage } from "./article-focus";
