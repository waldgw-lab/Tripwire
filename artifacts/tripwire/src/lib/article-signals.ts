import type { TrackedRecord } from '@workspace/api-client-react';
import { formatDate, formatTime } from './date-format';

export type Impact = 'critical' | 'high' | 'low';
type Article = Pick<TrackedRecord, 'title' | 'summary' | 'fullText' | 'fullTextComplete' | 'impact' | 'entities' | 'reportingType' | 'focus' | 'impactMode' | 'impactOverrideOrigin' | 'automaticAssessment'>;

const words = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
function mentions(text: string, term: string) {
  const normalized = words(term);
  return normalized.length > 2 && ` ${words(text)} `.includes(` ${normalized} `);
}

/** Prominence heuristic, not a judgment about truth or independently verified sourcing. */
export function impactRating(article: Article, watches: TrackedRecord[]): { value: Impact; reason: string; manual: boolean } {
  void watches;
  if (article.impactMode === 'manual' || !article.impactMode && article.impact) return { value: article.impact ?? 'low',
    reason: article.impactOverrideOrigin === 'legacy-unknown' ? 'Retained impact override; legacy origin unknown' : 'Analyst-selected impact', manual: true };
  return { value: article.automaticAssessment?.impact ?? 'low', reason: article.automaticAssessment?.explanation ?? 'Automatic assessment pending; relevance needs review.', manual: false };
}

export function hasMainText(article: Pick<TrackedRecord, 'fullText' | 'fullTextHash' | 'fullTextLength'>) {
  return !!(article.fullText?.trim() || article.fullTextHash || (article.fullTextLength ?? 0) > 0);
}

export function contentStatus(article: Pick<TrackedRecord, 'title' | 'summary' | 'fullText' | 'fullTextComplete' | 'fullTextHash' | 'fullTextLength' | 'retainedCharacters' | 'retainedContent'>) {
  const title = article.title.trim();
  const text = hasMainText(article) || (article.retainedCharacters ?? 0) > 0 || (article.retainedContent ?? []).some(c => (c.textLength ?? 0) > 0 || !!c.text?.trim());
  if (title && text && article.fullTextComplete === true) return { value: 'complete', label: 'Headline and full article text retained', color: 'bg-[#4ca548]' } as const;
  if (text || article.summary?.trim()) return { value: 'partial', label: 'Partial content: summary or incomplete article text retained', color: 'bg-[#f2af0d]' } as const;
  return { value: 'minimal', label: 'Minimal content: headline and metadata only', color: 'bg-[#f20d0d]' } as const;
}

/** Never substitute intake time for an unknown publication time. America/New_York handles DST. */
export function publicationET(value?: string, now = new Date()): { date: string; time: string; label: string } {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return { date: 'Date unknown', time: 'Time unknown', label: 'Publication time unknown' };
  const day = formatDate(value, false, now);
  if (/^\d{4}-\d{2}-\d{2}$/.test(value!)) return { date: day, time: 'Time unknown', label: `${day} · Time unknown` };
  const time = formatTime(value!);
  return { date: day, time: `${time} ET`, label: `${day} · ${time} ET` };
}
