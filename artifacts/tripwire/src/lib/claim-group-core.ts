/** Pure claim grouping / linkage helpers. No hooks or React imports: unit-testable. */
export type ClaimSummary = {
  claimId: string; attributions: number; firstDate: string | null; lastDate: string | null; ongoing?: boolean;
  latestReportAt?: string | null; categoryId?: string; primaryCategory?: string; secondaryCategories?: { id: string; label: string; description: string }[]; topicId?: string; topicTitle?: string; articleIds?: string[]; classificationReason?: string; developmentType?: string | null; developmentReason?: string | null;
};
type Cat = { id: string; label: string; description?: string };
export const UNCATEGORIZED = 'uncategorized';
export const UNCATEGORIZED_LABEL = 'Uncategorized / Needs review';
export const NO_TOPIC = '_unassigned';
export const categoryKey = (s?: ClaimSummary) => s?.categoryId || UNCATEGORIZED;
export const topicKey = (s?: ClaimSummary) => s?.topicId || NO_TOPIC;
export const groupKey = (s?: ClaimSummary) => `${categoryKey(s)}::${topicKey(s)}`;

export function categoryLabel(id: string, cats: Map<string, Cat>, s?: ClaimSummary) {
  if (id === UNCATEGORIZED) return cats.get(id)?.label ?? UNCATEGORIZED_LABEL;
  return cats.get(id)?.label ?? s?.primaryCategory ?? id.replace(/[-_]/g, ' ');
}
export const topicLabel = (s?: ClaimSummary) => s?.topicTitle || 'Unassigned topic';

export const reportTime = (s?: ClaimSummary) => {
  const v = s?.latestReportAt ?? s?.lastDate;
  const t = v ? Date.parse(v) : NaN;
  return Number.isFinite(t) ? t : -Infinity;
};
export const firstTime = (s?: ClaimSummary) => {
  const v = s?.firstDate ?? s?.latestReportAt;
  const t = v ? Date.parse(v) : NaN;
  return Number.isFinite(t) ? t : -Infinity;
};

export type ClaimLinkMode = 'all' | 'with' | 'without';
export type ClaimFeedFilter = { mode: ClaimLinkMode; categories: string[]; topics: string[] };
export const defaultClaimFeedFilter = (): ClaimFeedFilter => ({ mode: 'all', categories: [], topics: [] });
export const claimFilterCount = (f: ClaimFeedFilter) => (f.mode !== 'all' ? 1 : 0) + f.categories.length + f.topics.length;

/** Returns null when the filter cannot be evaluated (linkage unknown); callers should not filter then. */
export function matchesClaimFilter(articleId: string, f: ClaimFeedFilter, claimsByArticle: Map<string, string[]>, summaryById: Map<string, ClaimSummary>) {
  const ids = claimsByArticle.get(articleId) ?? [];
  if (f.mode === 'without') return ids.length === 0;
  if (f.mode === 'with' && !ids.length) return false;
  if (!f.categories.length && !f.topics.length) return true;
  return ids.some(id => {
    const s = summaryById.get(id);
    return (!f.categories.length || f.categories.includes(categoryKey(s))) && (!f.topics.length || f.topics.includes(groupKey(s)));
  });
}

/** articleId -> claimIds from explicit per-claim articleIds only; never inferred via shared topics. */
export function indexClaimsByArticle(summaries: ClaimSummary[]) {
  const m = new Map<string, string[]>();
  for (const s of summaries) for (const a of s.articleIds ?? []) { const l = m.get(a) ?? []; if (!l.includes(s.claimId)) l.push(s.claimId); m.set(a, l); }
  return m;
}
/** Count distinct reporting articles, never the number of extracted statements
 * or captures. Shared claims appear only under their explicitly linked articles. */
export function groupClaimsByArticle<T extends { id: string }>(claims: T[], byId: Map<string, ClaimSummary>) {
  const articles = new Map<string, { articleId: string; claims: T[] }>();
  const unattributed: T[] = [];
  const seen = new Set<string>();
  let complete = true;
  for (const claim of claims) {
    if (seen.has(claim.id)) continue;
    seen.add(claim.id);
    const ids = byId.get(claim.id)?.articleIds;
    if (!Array.isArray(ids)) complete = false;
    if (!ids?.length) { unattributed.push(claim); continue; }
    for (const articleId of new Set(ids)) {
      const row = articles.get(articleId) ?? { articleId, claims: [] };
      row.claims.push(claim);
      articles.set(articleId, row);
    }
  }
  return { articles: [...articles.values()], unattributed, articleCount: articles.size, complete };
}
export const linkageAvailable = (summaries?: ClaimSummary[]) => !!summaries && summaries.some(s => Array.isArray(s.articleIds));

export type ClaimSort = 'newest' | 'oldest' | 'linked';
export const linkedCount = (s?: ClaimSummary) => s?.articleIds?.length ?? s?.attributions ?? 0;
/** Comparator honoring requested sort; unknown dates always sort last; ties by title then id. */
export function compareClaims<T extends { id: string; title: string }>(a: T, b: T, sort: ClaimSort, byId: Map<string, ClaimSummary>) {
  const sa = byId.get(a.id), sb = byId.get(b.id);
  let d = 0;
  if (sort === 'linked') d = linkedCount(sb) - linkedCount(sa);
  else {
    const ta = sort === 'newest' ? reportTime(sa) : firstTime(sa), tb = sort === 'newest' ? reportTime(sb) : firstTime(sb);
    const ua = !Number.isFinite(ta), ub = !Number.isFinite(tb);
    if (ua !== ub) return ua ? 1 : -1;
    if (!ua) d = sort === 'newest' ? tb - ta : ta - tb;
  }
  return d || a.title.localeCompare(b.title) || a.id.localeCompare(b.id);
}
/** Prefer an ongoing claim for default selection, else the first in order. */
export function pickDefault<T extends { id: string }>(ordered: T[], byId: Map<string, ClaimSummary>) {
  return ordered.find(c => byId.get(c.id)?.ongoing) ?? ordered[0];
}
