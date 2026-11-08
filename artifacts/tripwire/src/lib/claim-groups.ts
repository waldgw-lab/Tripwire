import { useMemo } from 'react';
import {
  getGetClaimCategoriesQueryKey, getGetClaimCoverageSummariesQueryKey, useGetClaimCategories, useGetClaimCoverageSummaries,
} from '@workspace/api-client-react';
import { indexClaimsByArticle, linkageAvailable } from './claim-group-core';
export * from './claim-group-core';

/** Shared, 30-second-fresh claim linkage data. Summaries never invent links: missing articleIds means unknown. */
export function useClaimLinkage() {
  const summaries = useGetClaimCoverageSummaries({ query: { queryKey: getGetClaimCoverageSummariesQueryKey(), staleTime: 30_000, refetchInterval: 30_000, retry: 1 } });
  const categories = useGetClaimCategories({ query: { queryKey: getGetClaimCategoriesQueryKey(), staleTime: 5 * 60_000, retry: 1 } });
  const summaryById = useMemo(() => new Map((summaries.data ?? []).map(s => [s.claimId, s])), [summaries.data]);
  const categoryById = useMemo(() => new Map((categories.data ?? []).map(c => [c.id, c])), [categories.data]);
  /** articleId -> claimIds, only from explicit articleIds. */
  const claimsByArticle = useMemo(() => indexClaimsByArticle(summaries.data ?? []), [summaries.data]);
  /** Whether linkage data includes articleIds at all (older backend may omit). */
  const linkageKnown = linkageAvailable(summaries.data);
  return { summaries, categories, summaryById, categoryById, claimsByArticle, linkageKnown };
}

