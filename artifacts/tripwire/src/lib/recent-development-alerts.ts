import type { TrackedRecord } from '@workspace/api-client-react';
import { impactRating } from './article-signals';
import type { ClaimSummary } from './claim-group-core';
import { groupFeedArticles } from './feed-development-groups';

const WINDOW = 12 * 60 * 60 * 1000;

/** Publication-based reading prompts, not claims of new facts or independence.
 * Filter before grouping: old coverage cannot make fresh routine reporting
 * noteworthy, contribute to its counts, or supply its latest timestamp.
 */
export function recentDevelopmentAlerts(articles: (TrackedRecord & { hidden?: boolean })[], summaries: ClaimSummary[], now: number) {
  const recent = articles.filter(a => {
    if (a.kind !== 'article' || a.hidden) return false;
    const published = a.publishedAt;
    // A calendar date alone, a local time without an offset, or an ingestion
    // timestamp cannot establish that reporting falls inside a 12-hour window.
    if (!published || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/.test(published)) return false;
    const time = Date.parse(published);
    const calendar = Date.parse(`${published.slice(0, 10)}T00:00:00Z`);
    return Number.isFinite(time) && Number.isFinite(calendar)
      && new Date(calendar).toISOString().slice(0, 10) === published.slice(0, 10)
      && time <= now && time >= now - WINDOW;
  });
  const impacts = new Map(recent.map(a => [a.id, impactRating(a, [])]));
  return groupFeedArticles(recent, { summaries, impacts, order: 'newest' })
    .filter(g => g.kind === 'development' || g.highestImpact === 'high' || g.highestImpact === 'critical');
}
