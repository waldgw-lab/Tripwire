/** Deterministic relevance/impact only. Never establishes sourcing or triage. */
import { exactEvidence } from "./entity-policy";
export const IMPACT_POLICY_VERSION = "consequence-2026-11-06.2";
type Input = { title: string; summary?: string; fullText?: string; fullTextHash?: string };
export function subjectText(value: string) {
  return value.replace(/\b(?:president|director|head) of (?:basketball|baseball|football|business|hockey) operations\b/gi, "sports executive")
    .replace(/\b(?:Harry Trump\s*\/?\s*Getty|(?:labor|labour|union|memory inhibition|hunger) strikes?)\b/gi, "")
    .split(/\n/).filter(line => !/^\s*(?:photo(?:graph)?s?(?:\s+credit)?|image(?:s|\s+credit)?|credit|by|getty|related(?: stories| articles)?|recommended|read more|also read|sign up|subscribe)\s*[:/|]/i.test(line))
    .join("\n").split(/\n(?:Related (?:Stories|Articles)|You may also like|Recommended (?:Stories|Articles)|More from (?:the|this))\b/i)[0]!;
}
export function inferTopic(title: string, body: string, section = "") {
  if (/^politics(?:\s*&\s*policy)?$/i.test(section.trim())) return "Politics";
  const text = subjectText(`${title}\n${body}`).replace(/\bartificial intelligence\b/gi, "AI")
    .replace(/\b(?:basketball|business|baseball|football|hockey) operations\b/gi, "")
    .replace(/\b(?:labor|labour|union|memory inhibition|hunger) strikes?\b/gi, "");
  const patterns: [string, RegExp][] = [
    ["Intelligence", /\b(?:CIA|ODNI|FBI|intelligence (?:agenc|communit|assessment|finding|report|official)|classified (?:document|information|material)|espionage|counterintelligence|spies|spy agency)\w*/i],
    ["Military Operations", /\b(?:airstrikes?|missile strikes?|drone attacks?|troops|military.{0,50}(?:operations?|strikes?|actions?|bases?)|(?:US|U\.S\.|Russian|Israeli|Iranian|NATO) (?:strikes?|bombing|attacks?)|bombardment|interceptors?|Patriot missiles?|bases?.{0,55}(?:damage|battered)|battered.{0,40}bases?)\b/i],
    ["Defense", /\b(?:pentagon|department of (?:defen[cs]e|war)|munitions|weapons|procurement|military aid|defen[cs]e (?:secretary|budget|policy)|army|navy|National Guard)\b/i],
    ["Foreign Policy", /\b(?:diplomacy|diplomatic|foreign policy|state department|nuclear (?:proposal|deal|talks)|negotiations?|sanctions?)\b/i],
    ["Politics", /\b(?:elections?|midterms?|congress|senate|voting|White House|president|federal (?:court|government)|administration|judges?)\b/i],
    ["Geopolitics", /\b(?:iran|israel|ukraine|russia|china|NATO)\b/i],
  ];
  // A title hit outranks background mentions, but uses the same contextual boundaries.
  const cleanTitle = subjectText(title).replace(/\bartificial intelligence\b/gi, "AI").replace(/\b(?:basketball|business|baseball) operations\b/gi, "").replace(/\b(?:labor|labour|union) strikes?\b/gi, "");
  return patterns.find(([, re]) => re.test(cleanTitle))?.[0] ??
    patterns.find(([, re]) => re.test(text))?.[0] ?? (/^politics(?:\s*&\s*policy)?$/i.test(section) ? "Politics" : "Unclassified");
}
const scope = /\b(?:pentagon|military|generals?|National Guard|army|navy|interceptors?|Patriot|troops|NATO|munitions|nuclear|weapons|intelligence (?:agency|community|findings?|assessment)|CIA|ODNI|FBI|federal|congress|senate|voting|elections?|White House|president|administration|policy|sanctions?|diploma\w*|iran(?:ian)?|ukrain(?:e|ian)|russia(?:n)?|israel(?:i)?|chin(?:a|ese)|Trump|Hegseth|Rubio|Vance)\b/i;
const consequence = /\b(?:consult(?:ation|ed|ing|s)?|advis(?:ers?|ors?|ed|ing|es)|discuss(?:ed|ing|es)?|decid(?:ed|es|ing)|decision|constraints?|oversight|accountability|succession|leadership|remov(?:al|ed|ing|e)|fir(?:ed|ing)|dismiss(?:al|ed)|resign(?:ation|ed|s)?|investigat\w*|accused|secur(?:e|ing)|approv\w*|cutoff|cut off|halt\w*|suspend\w*|budget|funding|procurement|sale|patrol|aid|strikes?|attacks?|damage|bombing|interceptors?|negotiations?|nuclear proposals?|facilitat\w*|pullback|planning|plans?|consults?|law|reforms?|court order|ruling|intelligence findings?|intelligence assessment)\b/i;
const critical = /\b(?:(?:Hegseth|defen[cs]e secretary|senior military|generals?|military leadership).{0,100}(?:remov(?:al|ed)|fir(?:ed|ing)|resign\w*|fallout)|(?:remov(?:al|ing)|firing).{0,60}(?:Hegseth|defen[cs]e secretary)|(?:US|U\.S\.|American).{0,55}(?:strikes?|attacks?|bases?.{0,35}damage)|(?:imminent|direct|launch(?:es|ed)?).{0,40}(?:military strike|airstrike|attack)|military aid.{0,60}(?:cutoff|cut off|halt|suspend)|Pentagon.{0,65}(?:oversight|budget cut|budget overhaul))\b/i;
export function assessArticle(input: Input) {
  const body = subjectText(input.fullText ?? "");
  const lead = subjectText(`${input.title}\n${input.summary ?? ""}\n${body.slice(0, 1600)}`);
  const sentences = subjectText(`${input.title}\n${input.summary ?? ""}\n${body}`).split(/\n+|(?<=[!?])\s+|(?<=[a-z0-9”"])\.\s+(?=[A-Z])/u).filter(s => s.trim());
  const substantive = sentences.filter(s => scope.test(s) && consequence.test(s));
  const unrelatedGenre = /\b(?:Photos of the Week|electroconvulsive|box.office|basketball|NBA|NHL|book reviewer|hockey (?:novel|book)|blockbusters?)\b/i.test(lead);
  const broaderSports = /\b(?:LIV Golf|golf tournament|sports|Army.Navy.{0,50}(?:attend|game)|(?:attend|game).{0,50}Army.Navy|Melania.{0,50}(?:suit|fashion)|interview.{0,30}(?:schedule|airing)|Oval Office.{0,30}(?:decor|arch))\b/i.test(input.title);
  const strongLead = substantive.some(s => lead.includes(s)) || scope.test(input.title) && consequence.test(input.title);
  const unrelated = unrelatedGenre && !scope.test(input.title) && !substantive.slice(0, 2).some(s => lead.includes(s));
  const topic = unrelated ? "Unclassified" : inferTopic(input.title, `${input.summary ?? ""}\n${body}`);
  const relevance = unrelated ? "unrelated" : strongLead ? "relevant" : "review";
  const confidence = body.length >= 250 && (strongLead || unrelated) ? "high" : "limited";
  const reactionLed = /\b(?:defiant|lashes out|defends|assails|reaction|reacts|responds)\b/i.test(input.title);
  const impact = unrelated || broaderSports || !strongLead ? "low" : critical.test(lead) && !reactionLed ? "critical" : "high";
  // Reuse the monitoring system's exact-quotation primitive, but do not reuse
  // its triage or sourcing conclusions as impact. Each quote names its source.
  const evidence = substantive.slice(0, 4).map(s => s.trim().slice(0, 400));
  const evidenceRefs = evidence.flatMap(excerpt => {
    for (const [source, text] of [["headline", input.title], ["summary", input.summary ?? ""], ["body", input.fullText ?? ""]] as const) {
      const start = text.indexOf(excerpt);
      if (exactEvidence(text, excerpt, start, start + excerpt.length)) return [{ source, excerpt, start, end: start + excerpt.length,
        ...(source === "body" && input.fullTextHash ? { contentHash: input.fullTextHash } : {}) }];
    }
    return [];
  });
  return {
    policyVersion: IMPACT_POLICY_VERSION, impact, topic, relevance, confidence,
    explanation: (confidence === "limited" ? "Limited retained text; provisional assessment. " : "") + (unrelated ? "Unrelated subject matter; incidental names/credits do not establish research relevance."
      : broaderSports ? "Ceremonial, lifestyle or sports-led coverage; retain for collection without automatic elevated impact."
      : !strongLead ? "Relevance or consequence needs review; no supported elevated-impact signal in retained article-owned text."
      : impact === "critical" ? "Concrete major military or senior institutional consequence in retained headline/lead; sourcing remains unassessed."
      : "Substantive policy, institutional, military or leadership consequence; not promoted for a name or originality label."),
    evidence, evidenceRefs,
    ...(input.fullTextHash ? { contentHash: input.fullTextHash } : {}),
  } as const;
}
