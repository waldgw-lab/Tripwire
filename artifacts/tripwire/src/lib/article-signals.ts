import type { TrackedRecord } from '@workspace/api-client-react';

export type Impact = 'critical' | 'high' | 'low';
type Article = Pick<TrackedRecord, 'title' | 'summary' | 'fullText' | 'fullTextComplete' | 'impact' | 'entities' | 'reportingType' | 'focus'>;

const words = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
function mentions(text: string, term: string) {
  const normalized = words(term);
  return normalized.length > 2 && ` ${words(text)} `.includes(` ${normalized} `);
}

/** Prominence heuristic, not a judgment about truth or independently verified sourcing. */
export function impactRating(article: Article, watches: TrackedRecord[]): { value: Impact; reason: string; manual: boolean } {
  if (article.impact) return { value: article.impact, reason: 'Analyst-selected impact', manual: true };
  if (article.reportingType === 'original') return { value: 'critical', reason: 'Assessed as original reporting', manual: false };
  const relevantWatches = watches.filter(w => w.enabled !== false && (w.watchType === 'position' || w.watchType === 'person' || w.watchType === 'organization'));
  const names = (w: TrackedRecord) => [w.title, w.individual ?? '', w.position ?? '', ...(w.aliases ?? [])];
  if (relevantWatches.some(w => w.tier === 1 && names(w).some(name => mentions(article.title, name)))) {
    return { value: 'critical', reason: 'Primary watchlist subject mentioned in headline', manual: false };
  }
  if (article.reportingType === 'independent') return { value: 'high', reason: 'Assessed as independently reported', manual: false };
  const text = `${article.title} ${article.summary ?? ''} ${article.fullText ?? ''}`;
  if (relevantWatches.some(w => names(w).some(name => mentions(text, name) || article.entities?.some(entity => words(entity) === words(name)))) || ['blame', 'performance', 'replacement', 'decision-making', 'institutional'].includes(article.focus ?? '')) {
    return { value: 'high', reason: 'Watchlist subject or substantive accountability focus', manual: false };
  }
  return { value: 'low', reason: 'Broader relevant coverage; no higher-prominence signal recorded', manual: false };
}

export function contentStatus(article: Pick<Article, 'title' | 'summary' | 'fullText' | 'fullTextComplete'>) {
  const title = article.title.trim();
  const text = article.fullText?.trim();
  if (title && text && article.fullTextComplete === true) return { value: 'complete', label: 'Headline and full article text retained', color: 'bg-emerald-600' } as const;
  if (text || article.summary?.trim()) return { value: 'partial', label: 'Partial content: summary or incomplete article text retained', color: 'bg-amber-500' } as const;
  return { value: 'minimal', label: 'Minimal content: headline and metadata only', color: 'bg-red-600' } as const;
}

/** Never substitute intake time for an unknown publication time. America/New_York handles DST. */
export function publicationET(value?: string): { date: string; time: string; label: string } {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return { date: 'Date unknown', time: 'Time unknown', label: 'Publication time unknown' };
  const day = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', month: 'short', day: '2-digit', year: 'numeric' }).format(date);
  const time = new Intl.DateTimeFormat('en-GB', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(date);
  return { date: day, time: `${time} ET`, label: `${day} · ${time} ET` };
}
