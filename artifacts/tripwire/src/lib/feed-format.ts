import type { ArticleCredit } from '@workspace/api-client-react';
import { nameKey } from './media-coverage.ts';

/** Compact metadata, using Eastern time for both publication and current-year comparison. */
export function feedPublication(value?: string, now = new Date()) {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return { date: 'Date unknown', time: 'Time unknown', label: 'Publication time unknown' };
  const options = { timeZone: 'America/New_York' } as const;
  const parts = new Intl.DateTimeFormat('en-GB', { ...options, day: '2-digit', month: 'short', year: 'numeric' }).formatToParts(date);
  const part = (type: string) => parts.find(p => p.type === type)?.value ?? '';
  const currentYear = new Intl.DateTimeFormat('en-GB', { ...options, year: 'numeric' }).format(now);
  const day = `${part('day')} ${part('month').toUpperCase()}${part('year') === currentYear ? '' : ` ${part('year')}`}`;
  const clock = new Intl.DateTimeFormat('en-GB', { ...options, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(date).replace(':', '');
  return { date: day, time: clock, label: `${day} · ${clock}` };
}

/** Shortening is presentation-only; full names and roles remain on article credits. */
export function feedByline(credits: ArticleCredit[]) {
  const distinct = [...new Map(credits.filter(c => c.name.trim()).map(c => [nameKey(c.name), c.name.trim()])).values()];
  if (distinct.length < 2) return distinct[0] ?? '';
  return distinct.map(name => {
    const withoutSuffix = name.replace(/,?\s+(?:Jr\.?|Sr\.?|II|III|IV)\s*$/i, '');
    const parts = withoutSuffix.split(/\s+/);
    let start = parts.length - 1;
    while (start > 0 && /^(?:de|del|da|di|van|von|der|den|la|le)$/i.test(parts[start - 1])) start--;
    return parts.slice(Math.max(start, 0)).join(' ');
  }).join(', ');
}

export const impactTextColor = {
  critical: 'text-[#8b1e22]',
  high: 'text-[#98410f]',
  low: 'text-[#806400]',
} as const;
