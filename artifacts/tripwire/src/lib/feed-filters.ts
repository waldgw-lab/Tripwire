import type { TrackedRecord } from '@workspace/api-client-react';

export type FeedFilterKey = 'impact' | 'topic' | 'outlet' | 'reporting' | 'sentiment' | 'focus';
export type FeedFilters = Record<FeedFilterKey, string[]>;
export const emptyFeedFilters = (): FeedFilters => ({ impact: [], topic: [], outlet: [], reporting: [], sentiment: [], focus: [] });
export const defaultFeedFilters = (): FeedFilters => ({ ...emptyFeedFilters(), impact: ['critical', 'high'] });
export const filterSelectionCount = (filters: FeedFilters) => Object.values(filters).reduce((sum, values) => sum + values.length, 0);

/** Alternatives within a category; intersection across categories. No selections means all. */
export function matchesFeedFilters(article: TrackedRecord, impact: string | undefined, filters: FeedFilters) {
  const values: Record<FeedFilterKey, string | undefined> = {
    impact, topic: article.topic, outlet: article.outlet, reporting: article.reportingType ?? 'unassessed',
    sentiment: article.sentiment ?? 'unassessed', focus: article.focus,
  };
  return (Object.keys(filters) as FeedFilterKey[]).every(key => !filters[key].length || filters[key].includes(values[key] ?? ''));
}
