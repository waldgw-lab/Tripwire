import type { ArticleCredit, TrackedRecord } from '@workspace/api-client-react';

export const creditRoles = ['author', 'contributor', 'reporting', 'research', 'photography', 'editing', 'other'] as const;
export const nameKey = (value: string) => value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-US');
const suffix = /^(?:jr\.?|sr\.?|ii|iii|iv)$/i;

export function articleCredits(article: Pick<TrackedRecord, 'credits' | 'journalists'>): ArticleCredit[] {
  if (article.credits !== undefined) return article.credits.filter(c => c.name.trim()).map(c => ({ ...c, name: c.name.trim() }));
  const names: string[] = [];
  for (const raw of article.journalists ?? []) {
    const name = raw.trim();
    if (!name) continue;
    if (suffix.test(name) && names.length) names[names.length - 1] += `, ${name}`;
    else if (!suffix.test(name)) names.push(name);
  }
  return [...new Map(names.map(name => [nameKey(name), { name, role: 'author' as const }])).values()];
}

export function creditLabel(credit: ArticleCredit) {
  return credit.role === 'author' ? credit.name : `${credit.name} (${credit.role})`;
}

export function surnameKey(name: string) {
  const parts = name.replace(/,\s*(?:Jr\.?|Sr\.?|II|III|IV)\s*$/i, '').trim().split(/\s+/);
  if (suffix.test(parts.at(-1) ?? '')) parts.pop();
  let start = parts.length - 1;
  while (start > 0 && /^(?:de|del|da|di|van|von|der|den|la|le)$/i.test(parts[start - 1])) start--;
  return nameKey(parts.slice(Math.max(0, start)).join(' '));
}

export type CoverageItem = { article: TrackedRecord; credits: ArticleCredit[] };
export type JournalistCoverage = {
  key: string;
  name: string;
  watch?: TrackedRecord;
  aliases: string[];
  outlets: string[];
  coverage: CoverageItem[];
  latest: number;
};
export type JournalistSort = 'last-name' | 'recent' | 'items';
export function sortJournalists(profiles: JournalistCoverage[], sort: JournalistSort = 'last-name') {
  return [...profiles].sort((a, b) => {
    const alphabetical = surnameKey(a.name).localeCompare(surnameKey(b.name)) || a.name.localeCompare(b.name);
    return (sort === 'recent' ? b.latest - a.latest : sort === 'items' ? b.coverage.length - a.coverage.length : 0) || alphabetical;
  });
}

export function buildMediaCoverage(records: TrackedRecord[]): JournalistCoverage[] {
  const profiles = new Map<string, JournalistCoverage>();
  const aliases = new Map<string, string>();
  const ensure = (key: string, name: string) => {
    if (!profiles.has(key)) profiles.set(key, { key, name, aliases: [], outlets: [], coverage: [], latest: 0 });
    return profiles.get(key)!;
  };
  for (const watch of records.filter(r => r.kind === 'watch' && r.watchType === 'journalist')) {
    const key = nameKey(watch.title);
    const p = ensure(key, watch.title);
    p.watch = watch;
    p.aliases = watch.aliases ?? [];
    if (watch.outlet) p.outlets.push(watch.outlet);
    for (const name of [watch.title, ...p.aliases]) aliases.set(nameKey(name), key);
  }
  const articles = records.filter(r => r.kind === 'article' && r.sourceType !== 'x').sort((a, b) => {
    const time = (r: TrackedRecord) => Date.parse(r.publishedAt ?? '') || 0;
    return time(b) - time(a);
  });
  const observedNames = new Set<string>();
  for (const article of articles) {
    const perPerson = new Map<string, ArticleCredit[]>();
    for (const credit of articleCredits(article)) {
      const key = aliases.get(nameKey(credit.name)) ?? nameKey(credit.name);
      const p = ensure(key, credit.name);
      if (!observedNames.has(key)) {
        if (nameKey(p.name) !== nameKey(credit.name)) p.aliases = [...new Set([...p.aliases, p.name])];
        p.name = credit.name; // Preserve the latest actual byline spelling, initials and suffix.
        observedNames.add(key);
      }
      const list = perPerson.get(key) ?? [];
      if (!list.some(c => c.role === credit.role && nameKey(c.name) === nameKey(credit.name))) list.push(credit);
      perPerson.set(key, list);
    }
    for (const [key, credits] of perPerson) {
      const p = profiles.get(key)!;
      if (!p.coverage.some(item => item.article.id === article.id)) p.coverage.push({ article, credits });
      if (article.outlet && !p.outlets.some(o => nameKey(o) === nameKey(article.outlet!))) p.outlets.push(article.outlet);
      p.latest = Math.max(p.latest, Date.parse(article.publishedAt ?? '') || 0);
    }
  }
  return sortJournalists([...profiles.values()]);
}

export const coverageAtOutlet = (profile: JournalistCoverage, outlet?: string) =>
  outlet ? profile.coverage.filter(item => nameKey(item.article.outlet ?? '') === nameKey(outlet)) : profile.coverage;
