type RecordRow = { id: string; data: Record<string, any> };
type Link = { claim_id: string; article_id: string; proposition?: string };
export type Development = {
  ongoing: boolean; developmentType: string | null;
  latestReportAt: string | null; developmentReason: string | null;
};
const DAY = 86_400_000;
const leadershipContext = /\b(president|white house|pentagon|secretar(?:y|ies)|chief of staff|joint chiefs|chairman|chair|general|director|minister|cabinet|advis[eo]rs?|administration|trump|hegseth|caine)\b/i;
const personnel = /\b(dismiss(?:ed|al)?|oust(?:ed|er)?|replac(?:e|ed|ing|ement)|resign(?:ed|ation|s)?|remov(?:e|ed|al)|impeach(?:ed|ment)?|appoint(?:ed|ment)?|nominat(?:e|ed|ion)|promot(?:e|ed|ion)|elevat(?:e|ed|ion)|stepp?ing down|step down|take over|taking over|new role|new (?:white house )?chief of staff|stay in (?:his|her|their) job|should (?:stay|go)|expect.{0,45}gone)\b/i;
const pendingDecision = /\b(consider(?:s|ed|ing)?|weigh(?:s|ed|ing)?|discuss(?:es|ed|ing)?|plan(?:s|ned|ning)?|prepar(?:e|es|ed|ing)|order(?:s|ed)?|authoriz(?:e|es|ed)|approv(?:e|es|ed)|announc(?:e|es|ed)|set to)\b/i;
const consequential = /\b(strikes?|deploy(?:ment|ing)?|operations?|investigat(?:e|ion)|funding|sanctions?|ceasefire|negotiat(?:e|ions?)|military|national security|policy|legislation|war)\b/i;
const relationships = /\b(confidence|disagre(?:e|ed|ements?)|consult(?:ed|ing|ations?)?|advis(?:ed|ing)|pressure|rift|friction)\b/i;
const roleTransition = /\b(?:becom(?:e|es|ing)|nam(?:e[ds]?|ing)|select(?:ed|s)?)\b.{0,100}\b(?:chief|secretary|chairman|director|minister)\b/i;
function personnelFiring(text: string) {
  return [...text.matchAll(/\b(?:fire|fires|fired|firing)\b/gi)].some(match => {
    const before = text.slice(Math.max(0, match.index! - 90), match.index);
    const after = text.slice(match.index! + match[0].length, match.index! + match[0].length + 90);
    if (/\b(caught|catch|on|under|open|opens|opened|return|returned|friendly)\s*$/i.test(before)) return false;
    if (/^\s+(?:(?:a|an|the)\s+)?(?:on|at|into|back|up|missiles?|rockets?|shots?|shells?|torpedoes?|weapons?|rounds?)\b/i.test(after)) return false;
    if (/\b(?:missiles?|rockets?|shots?|weapons?|guns?|ships?|vessels?)\s+(?:were\s+|was\s+|had been\s+)?$/i.test(before)) return false;
    return leadershipContext.test(before + after);
  });
}

/** A prominence rule, never a truth, identity, independence or unresolved-status decision. */
export function developmentKind(proposition: string, articleTitle: string, now = Date.now()): string | null {
  if (!leadershipContext.test(`${proposition} ${articleTitle}`)) return null;
  const historical = proposition.match(/^\s*(?:in|during|back in|before|after)\s+(?:the\s+)?((?:19|20)\d{2})\b/i);
  if (historical && Number(historical[1]) < new Date(now).getUTCFullYear() &&
      !/\b(now|currently|again|today|still|this week)\b/i.test(proposition)) return null;
  const roleHeadline = /\b(chief of staff|secretary|joint chiefs|chairman|cabinet|general|director|minister)\b/i.test(articleTitle);
  // Copied passages can contain several run-together sentences. A role elsewhere
  // in the passage must not turn replacing an object or deportation into staffing.
  const personnelChange = [...proposition.matchAll(new RegExp(personnel.source, "gi"))].some(match =>
    roleHeadline || leadershipContext.test(proposition.slice(Math.max(0, match.index! - 75), match.index! + match[0].length + 75)));
  if (personnelChange || roleTransition.test(proposition) || personnelFiring(proposition)) return "Leadership & staffing";
  if (pendingDecision.test(proposition) && consequential.test(proposition)) return "Decisions & policy";
  if (relationships.test(proposition) && /\b(officials?|advis[eo]rs?|president|cabinet|pentagon|chief|secretary|general)\b/i.test(proposition))
    return "Institutional relationships";
  return null;
}

function publication(article: Record<string, any>): { value: string; time: number } | null {
  const value = article.publishedAt;
  // Ingestion, capture and editing times are not publication evidence.
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}(?:$|T.*(?:Z|[+-]\d{2}:\d{2})$)/.test(value)) return null;
  const time = Date.parse(value);
  const calendar = Date.parse(`${value.slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(time) || !Number.isFinite(calendar) || new Date(calendar).toISOString().slice(0, 10) !== value.slice(0, 10)) return null;
  return { value, time };
}

export function claimDevelopments(records: RecordRow[], links: Link[], now = Date.now()): Map<string, Development> {
  const articles = new Map<string, Record<string, any>>();
  for (const r of records) if (r.data.kind === "article" && !r.data.hidden) {
    articles.set(r.id, r.data);
    if (r.data.baseId) articles.set(r.data.baseId, r.data);
  }
  const byClaim = new Map<string, Link[]>();
  for (const link of links) {
    const rows = byClaim.get(link.claim_id) ?? [];
    rows.push(link); byClaim.set(link.claim_id, rows);
  }
  const result = new Map<string, Development>();
  for (const r of records) if (r.data.kind === "claim" && !r.data.hidden) {
    const id = r.data.baseId || r.id;
    const candidates = [...(byClaim.get(id) ?? []), ...(id === r.id ? [] : byClaim.get(r.id) ?? []),
      ...(r.data.observations ?? []).map((o: any) => ({ article_id: o.articleId, proposition: r.data.title }))];
    let latest = -Infinity, latestDevelopment = -Infinity;
    const d: Development = { ongoing: false, latestReportAt: null, developmentType: null, developmentReason: null };
    for (const link of candidates) {
      const article = articles.get(link.article_id);
      if (!article) continue;
      const reported = publication(article);
      if (!reported || reported.time > now + 5 * 60_000) continue;
      if (reported.time > latest) { latest = reported.time; d.latestReportAt = reported.value; }
      const kind = developmentKind(link.proposition || r.data.title || "", article.title || "", now);
      if (kind && reported.time >= now - 14 * DAY && reported.time >= latestDevelopment) {
        latestDevelopment = reported.time; d.ongoing = true; d.developmentType = kind;
        d.developmentReason = "Article-linked reporting within the last 14 days. Prominence does not establish truth, confirmation, source independence or whether the matter is resolved.";
      }
    }
    result.set(id, d);
  }
  return result;
}
