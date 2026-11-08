import { pool } from "@workspace/db";
import { WORKSPACE_OWNER as W } from "./tripwire-access";
import { suppliedDate } from "./source-search-rules";
import { claimDevelopments } from "./claim-developments";
import { organizeClaimCoverage } from "./claim-taxonomy";

type RecordRow = { id: string; data: Record<string, any> };
type Attribution = { claim_id: string; article_id: string };
const day = (value: unknown) => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}(?:T|$)/.test(value)) return null;
  const d = value.slice(0, 10);
  const time = Date.parse(`${d}T00:00:00Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === d ? d : null;
};

/** Article attributions, not source-human counts or independently verified paths. */
export function summariseClaimCoverage(records: RecordRow[], attributed: Attribution[]) {
  const articles = new Map<string, Record<string, any>>();
  for (const r of records.filter(r => r.data.kind === "article" && !r.data.hidden)) {
    articles.set(r.id, r.data);
    if (r.data.baseId) articles.set(r.data.baseId, r.data);
  }
  return records.filter(r => r.data.kind === "claim" && !r.data.hidden).map(r => {
    const claimId = r.data.baseId || r.id;
    const rich = attributed.filter(a => a.claim_id === claimId || a.claim_id === r.id).filter(a => articles.has(a.article_id));
    const richArticles = new Set(rich.map(a => a.article_id));
    const dates: string[] = [];
    const addDate = (article: Record<string, any>, fallback?: unknown) => {
      const d = day(article.publishedAt) ?? suppliedDate(article.sourceSearch?.date) ?? day(fallback);
      if (d) dates.push(d);
    };
    for (const a of rich) addDate(articles.get(a.article_id)!);
    const legacy = (r.data.observations ?? []).filter((o: any) => articles.has(o.articleId) && !richArticles.has(o.articleId));
    for (const o of legacy) addDate(articles.get(o.articleId)!, o.observedAt);
    dates.sort();
    return { claimId, attributions: rich.length + legacy.length, firstDate: dates[0] ?? null, lastDate: dates.at(-1) ?? null };
  });
}

export async function claimCoverageSummaries() {
  // Select the workspace override before filtering hidden records, never resurrect a dismissed public base.
  const records = (await pool.query(`with selected as (
    select distinct on (kind,coalesce(data->>'baseId',id)) id,kind,data
    from tripwire_records where kind in ('claim','article') and owner in ('public',$1)
    order by kind,coalesce(data->>'baseId',id),(owner=$1) desc)
    select s.id,s.data || jsonb_build_object('kind',s.kind) ||
      case when s.kind='article' then jsonb_build_object('focusLead',left(c.text,2400)) else '{}'::jsonb end data
    from selected s left join tripwire_content c on c.hash=s.data->>'fullTextHash'`, [W])).rows;
  const attributed = (await pool.query(`select f.claim_id,c.article_id,c.proposition from tripwire_attributed_claims c
    join tripwire_claim_families f on f.workspace=c.workspace and f.id=c.family_id where c.workspace=$1`, [W])).rows;
  const developments = claimDevelopments(records, attributed);
  const summaries = summariseClaimCoverage(records, attributed).map(summary => ({ ...summary, ...developments.get(summary.claimId) }));
  return organizeClaimCoverage(records, attributed, summaries);
}
