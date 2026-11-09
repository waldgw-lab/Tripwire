import type { TrackedRecord } from '@workspace/api-client-react';

const HOUR = 3_600_000;
/** A source-attributed reading aid, never a generated statement about an event.
 * All windows are publication-based and restricted to the supplied filtered set. */
export function developmentSnapshot(articles: TrackedRecord[], now = Date.now()) {
  const unique = [...new Map(articles.map(a => [a.id, a])).values()];
  let last6h = 0, last24h = 0, previous18h = 0, earlier = 0, undated = 0, future = 0;
  const dated: { article: TrackedRecord; time: number }[] = [];
  for (const article of unique) {
    const time = article.publishedAt ? Date.parse(article.publishedAt) : NaN;
    if (!Number.isFinite(time)) { undated++; continue; }
    if (time > now) { future++; continue; }
    dated.push({ article, time });
    const age = now - time;
    if (age <= 24 * HOUR) {
      last24h++;
      if (age <= 6 * HOUR) last6h++;
      else previous18h++;
    } else earlier++;
  }
  dated.sort((a, b) => b.time - a.time || a.article.id.localeCompare(b.article.id));
  const source = dated[0]?.article ?? unique[0] ?? null;
  const status = dated.length ? (now - dated[0].time <= 6 * HOUR ? 'current' : now - dated[0].time <= 24 * HOUR ? 'recent' : 'earlier')
    : future ? 'future-dated' : 'undated';
  const summary = source?.summary?.replace(/\s+/g, ' ').trim() ?? '';
  const distinctSummary = summary && summary.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '') !== source?.title.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
  const rawExcerpt = distinctSummary ? summary : source?.title ?? '';
  const maxLength = 420;
  const truncated = rawExcerpt.length > maxLength;
  const excerpt = truncated ? `${rawExcerpt.slice(0, maxLength).replace(/\s+\S*$/, '')}…` : rawExcerpt;
  return { last6h, last24h, previous18h, earlier, undated, future, source, status, excerpt, truncated,
    excerptKind: distinctSummary ? 'summary' as const : 'headline' as const };
}
