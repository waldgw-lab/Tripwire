const EASTERN = 'America/New_York';
const dateOnly = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) ||
  /^(?:[A-Za-z]+\s+\d{1,2},?\s+\d{4}|\d{1,2}\s+[A-Za-z]+\s+\d{4})$/.test(value);

/** Calendar-only dates stay on their supplied day; timestamps use Eastern time. */
export function formatDate(value?: string | null, withTime = false, now = new Date()): string {
  if (!value) return '—';
  if (/^\d{4}(?:-\d{2})?$/.test(value)) return value; // Preserve incomplete date precision.
  const calendarOnly = dateOnly(value);
  const date = new Date(calendarOnly && !/^\d{4}-/.test(value) ? `${value} UTC` : value);
  if (Number.isNaN(date.getTime())) return value;
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: calendarOnly ? 'UTC' : EASTERN, day: 'numeric', month: 'short', year: 'numeric',
  }).formatToParts(date);
  const part = (type: string) => parts.find(p => p.type === type)?.value ?? '';
  const currentYear = new Intl.DateTimeFormat('en-GB', { timeZone: EASTERN, year: 'numeric' }).format(now);
  const label = `${part('day')} ${part('month').toUpperCase()}${part('year') === currentYear ? '' : ` ${part('year')}`}`;
  return withTime && !calendarOnly ? `${label} · ${formatTime(value)} ET` : label;
}

export function formatTime(value: string, compact = false): string {
  const time = new Intl.DateTimeFormat('en-GB', {
    timeZone: EASTERN, hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).format(new Date(value));
  return compact ? time.replace(':', '') : time;
}
