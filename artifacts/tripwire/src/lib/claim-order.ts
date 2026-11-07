type Claim = { id: string; title: string };
type Summary = { ongoing?: boolean; developmentType?: string | null; latestReportAt?: string | null; lastDate: string | null };
export function orderClaims<T extends Claim>(claims: T[], summaries: Map<string, Summary>): T[] {
  const time = (s?: Summary) => {
    const value = s?.latestReportAt ?? s?.lastDate;
    const date = value ? Date.parse(value) : NaN;
    return Number.isFinite(date) ? date : -Infinity;
  };
  return [...claims].sort((a, b) => {
    const sa = summaries.get(a.id), sb = summaries.get(b.id);
    const ongoing = Number(!!sb?.ongoing) - Number(!!sa?.ongoing);
    if (ongoing) return ongoing;
    if (sa?.ongoing && sb?.ongoing) {
      const rank = (s: Summary) => s.developmentType === 'Leadership & staffing' ? 0 : s.developmentType === 'Institutional relationships' ? 1 : 2;
      const category = rank(sa) - rank(sb);
      if (category) return category;
    }
    const ta = time(sa), tb = time(sb);
    return ta !== tb ? (ta < tb ? 1 : -1) : a.title.localeCompare(b.title) || a.id.localeCompare(b.id);
  });
}
