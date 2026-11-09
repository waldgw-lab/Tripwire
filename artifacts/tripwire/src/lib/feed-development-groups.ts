import type { TrackedRecord } from '@workspace/api-client-react';
import type { ClaimSummary } from './claim-group-core';

export type FeedGroupOrder = 'relevant' | 'newest' | 'coverage';
type Impact = 'critical' | 'high' | 'low';
type Tone = 'positive' | 'negative' | 'neutral' | 'mixed' | 'unassessed';
export type FeedDevelopmentGroup = {
  id: string; title: string; articles: TrackedRecord[]; outlets: string[];
  latestAt: string | null; earliestAt: string | null; highestImpact?: Impact;
  basis: string; kind: 'development' | 'similar-headlines' | 'single';
  tones: Record<Tone, number>;
  claimLinks: { categoryId: string; topicId: string; title: string; articleCount: number }[];
};
type Options = {
  impacts?: Map<string, { value: Impact; reason?: string }>;
  summaries?: ClaimSummary[];
  order?: FeedGroupOrder;
  flaggedFirst?: boolean;
};
const WINDOW = 72 * 60 * 60 * 1000;
const weights = { critical: 2, high: 1, low: 0 };
const stamp = (a: TrackedRecord) => a.publishedAt && Number.isFinite(Date.parse(a.publishedAt)) ? Date.parse(a.publishedAt) : null;
const text = (s: string) => s.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[’‘]/g, "'").replace(/\b([a-z]+)'s\b/g, '$1');
const STOP = new Set(('about after again also amid america american another around before being could democrats donald during first from government have into latest live more news other over party people politics president republicans report reports says said should some their them there these they this those today trump under updates very what when where which white will with would years biden house congress').split(' '));
const tokens = (s: string) => new Set((text(s).match(/[a-z0-9]{4,}/g) ?? []).filter(t => !STOP.has(t)));
const properAnchors = (s: string) => {
  const words = s.match(/[A-Za-z][A-Za-z'-]*/g) ?? [];
  // Only sentence-case titles provide reliable capitalization cues.
  if (words.filter(w => /^[A-Z]/.test(w)).length > words.length * 0.6) return new Set<string>();
  return new Set(words.slice(1).filter(w => /^[A-Z][a-z]{2,}$/.test(w) && !STOP.has(w.toLowerCase())
    && !/^(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)$/.test(w)).map(w => w.toLowerCase()));
};

/** Headline-level event anchors, not article-wide entity mentions or claim assertions.
 * Noun-phrase labels preserve the distinction between a topic and a verified outcome. */
function development(a: TrackedRecord): { key: string; title: string } | null {
  const h = text(a.title);
  const opening = h.split(/\s+(?:as|while|after|whereas|amid)\s+/)[0];
  const match = (key: string, title: string) => ({ key, title });
  if (/\b(wall street|stock markets?|stock prices?|oil prices)\b/.test(opening)) return null;
  const staffActor = /\b(susie wiles|ste(?:phen|ve) miller)\b/.test(opening) ||
    (/\b(miller|wiles)\b/.test(opening) && /\b(chief[ -]of[ -]staff)\b/.test(h) && !/\b(?!Stephen\b|Steve\b|Susie\b)[A-Z][a-z]+\s+(?:Miller|Wiles)\b/.test(a.title));
  if (staffActor && /\b(chief of staff|chief-of-staff|white house|trump chief|exit|departures?|roles?)\b/.test(h))
    return match('white-house-chief-staff', 'White House chief-of-staff transition — Miller / Wiles');
  if (/\bdana white\b/.test(h) && /\b(press|secretary|offer|ufc)\b/.test(h))
    return match('dana-white-press', 'Dana White — press secretary offer and responses');
  if (/\bhegseth\b/.test(opening) && /\b(partisan|government resources|campaign video)\b/.test(h))
    return match('hegseth-partisan-video', 'Pete Hegseth — use of government resources for a partisan video');
  if (/\bhegseth\b/.test(opening) && /\b(impeach\w*|fire[ds]?|firing|remov\w*|resign\w*|confidence|defiant|future|pressure|leadership)\b/.test(h))
    return match('hegseth-leadership', 'Pete Hegseth — impeachment and leadership pressure');
  if (/\bcaine\b/.test(opening) && /\b(fire[ds]?|firing|remov\w*|replac\w*|resign\w*|future|chairman|joint chiefs)\b/.test(h))
    return match('caine-leadership', 'Dan Caine — Pentagon leadership discussions');
  if (/\b(60 minutes|60 minute)\b/.test(h) && /\btrump\b/.test(h))
    return match('trump-60-minutes', 'Trump’s 60 Minutes interview — reporting and reactions');
  if ((/\b(huang|nvidia)\b/.test(h) || (/\bceo\b/.test(h) && /\b(huang|nvidia)\b/.test(text(a.summary ?? ''))))
    && /\b(spy|scandal|affair|investigat\w*|probe|crisis)\b/.test(h))
    return match('huang-investigation', 'Jensen Huang / Nvidia — investigation and responses');
  if (/\b(iran|iranian)\b/.test(opening) && /\b(talks?|deal|negotiat\w*|mediator|diplomac\w*|peace|escalat\w*)\b/.test(h))
    return match('iran-talks', 'Iran — negotiations and prospects for de-escalation');
  if (/\b(iran|iranian)\b/.test(opening) && /\b(strikes?|bomb\w*|attack\w*|military|missiles?)\b/.test(h))
    return match('iran-operations', 'Iran — military action and operational reporting');
  if (/\bukraine\b/.test(opening) && /\b(talks?|peace|abu dhabi|negotiat\w*)\b/.test(h))
    return match('ukraine-talks', 'Ukraine — peace talks and security arrangements');
  if (/\b(hyde-smith|hyde smith|colom|mississippi)\b/.test(h) && /\b(senate|race|votes?|lead|election)\b/.test(h))
    return match('mississippi-senate', 'Mississippi Senate race — results and outstanding votes');
  if (/\b(immigration|deportation|deportations)\b/.test(opening) && /\b(too tough|hurt|midterm|bipartisan|regret)\b/.test(h))
    return match('immigration-reassessment', 'Immigration enforcement — post-midterm reassessment');
  if (/\bcongress\b/.test(opening) && /\b(returns?|lame.duck|funding|shutdown|debt limit|agenda)\b/.test(h))
    return match('congress-return', 'Congress returns — funding, oversight and the legislative agenda');
  if (/\bjeffries\b/.test(opening) && /\b(speaker|leadership|support|democrats)\b/.test(h))
    return match('house-democratic-leadership', 'House Democratic leadership — Jeffries and the speaker race');
  if (/\b(eisenberg|us attorney|u s attorney|u.s. attorney|justice department)\b/.test(opening) && /\b(resign\w*|depart\w*|oust\w*|exodus)\b/.test(h))
    return match('justice-departures', 'Justice Department — leadership departures');
  if (/\b(vance|ossoff|aoc|ocasio-cortez)\b/.test(opening) && /\b2028\b/.test(h)) {
    const subject = /\bvance\b/.test(opening) ? 'JD Vance' : /\bossoff\b/.test(opening) ? 'Jon Ossoff' : 'Alexandria Ocasio-Cortez';
    return match(`2028-${subject}`, `${subject} — 2028 presidential positioning`);
  }
  return null;
}

function sourceKey(s: string) {
  const n = s.trim().toLowerCase().replace(/^the\s+/, '');
  return /^(nbc|cbs|abc)( news)?$/.test(n) ? n.split(' ')[0] : n;
}
type Draft = { group: FeedDevelopmentGroup; key: string | null; latest: number | null; anchor: Set<string>; names: Set<string> };

/** Every distinct input article appears exactly once. Claim linkage can add
 * navigation, but never decides eligibility or supplies synthesized reporting. */
export function groupFeedArticles(input: TrackedRecord[], options: Options = {}): FeedDevelopmentGroup[] {
  const rows = [...new Map(input.map(a => [a.id, a])).values()].sort((a, b) => {
    const ta = stamp(a), tb = stamp(b);
    return ta == null ? (tb == null ? a.id.localeCompare(b.id) : 1) : tb == null ? -1 : tb - ta || a.id.localeCompare(b.id);
  });
  const drafts: Draft[] = [], byRule = new Map<string, Draft[]>(), byToken = new Map<string, Draft[]>();
  for (const a of rows) {
    const time = stamp(a), rule = development(a), words = tokens(a.title), names = properAnchors(a.title);
    let draft: Draft | undefined;
    if (time != null && rule) draft = byRule.get(rule.key)?.find(d => d.latest! - time <= WINDOW);
    if (time != null && !rule && words.size >= 4) {
      const candidates = new Set([...words].flatMap(w => byToken.get(w) ?? []));
      let best = 0.66;
      for (const d of candidates) {
        if (d.key || d.latest == null || d.latest - time > WINDOW) continue;
        if (names.size && d.names.size && ![...names].some(n => d.names.has(n))) continue;
        const shared = [...words].filter(w => d.anchor.has(w)).length;
        const similarity = shared / (words.size + d.anchor.size - shared);
        if (shared >= 3 && similarity > best) { best = similarity; draft = d; }
      }
    }
    if (!draft) {
      const group: FeedDevelopmentGroup = { id: `${rule?.key ?? 'headline'}:${a.id}`, title: rule?.title ?? a.title,
        articles: [], outlets: [], latestAt: time == null ? null : new Date(time).toISOString(), earliestAt: null,
        basis: rule ? 'Headline indicators suggest a shared development within 72 hours. Retained summary context can resolve an ambiguous reference. This is navigation, not a verified shared claim.'
          : 'No confident development match. This article remains individually accessible.',
        kind: rule ? 'development' : 'single', tones: { positive: 0, negative: 0, neutral: 0, mixed: 0, unassessed: 0 }, claimLinks: [] };
      draft = { group, key: rule?.key ?? null, latest: time, anchor: words, names };
      drafts.push(draft);
      if (rule && time != null) byRule.set(rule.key, [...(byRule.get(rule.key) ?? []), draft]);
      else if (time != null) for (const w of words) byToken.set(w, [...(byToken.get(w) ?? []), draft]);
    } else if (!rule) {
      draft.group.kind = 'similar-headlines';
      draft.group.basis = 'Strong headline-word overlap within 72 hours, compared with one anchor headline; not a claim or source-independence judgment.';
    }
    const g = draft.group;
    g.articles.push(a);
    if (time != null) g.earliestAt = new Date(time).toISOString();
    const rawImpact = options.impacts?.get(a.id)?.value ?? a.impact;
    if (rawImpact && Object.hasOwn(weights, rawImpact) && (g.highestImpact == null || weights[rawImpact as Impact] > weights[g.highestImpact])) g.highestImpact = rawImpact as Impact;
    const tone = typeof a.sentiment === 'string' && Object.hasOwn(g.tones, a.sentiment) ? a.sentiment as Tone : 'unassessed';
    g.tones[tone]++;
  }
  const linksByArticle = new Map<string, Map<string, { categoryId: string; topicId: string; title: string }>>();
  for (const s of options.summaries ?? []) for (const p of s.placements?.length ? s.placements : [s]) {
    if (!p.categoryId || !p.topicId || !p.topicTitle) continue;
    for (const id of p.articleIds ?? []) {
      const m = linksByArticle.get(id) ?? new Map();
      m.set(`${p.categoryId}::${p.topicId}`, { categoryId: p.categoryId, topicId: p.topicId, title: p.topicTitle });
      linksByArticle.set(id, m);
    }
  }
  for (const { group: g } of drafts) {
    const sources = new Map<string, string>(), links = new Map<string, { categoryId: string; topicId: string; title: string; ids: Set<string> }>();
    for (const a of g.articles) {
      if (a.outlet?.trim()) sources.set(sourceKey(a.outlet), a.outlet.trim());
      for (const [key, value] of linksByArticle.get(a.id) ?? []) {
        const l = links.get(key) ?? { ...value, ids: new Set<string>() };
        l.ids.add(a.id); links.set(key, l);
      }
    }
    g.outlets = [...sources.values()];
    g.claimLinks = [...links.values()].map(({ ids, ...v }) => ({ ...v, articleCount: ids.size }));
  }
  const flag = (g: FeedDevelopmentGroup) => g.articles.some(a => a.flagged ?? a.saved ?? false);
  const score = (g: FeedDevelopmentGroup) => Date.parse(g.latestAt!) + (g.highestImpact === 'critical' ? 90 : g.highestImpact === 'high' ? 30 : 0) * 60_000 + Math.min(20, Math.max(0, g.outlets.length - 1) * 5) * 60_000;
  return drafts.map(d => d.group).sort((a, b) => {
    if (options.flaggedFirst && flag(a) !== flag(b)) return Number(flag(b)) - Number(flag(a));
    if (!a.latestAt || !b.latestAt) return a.latestAt ? -1 : b.latestAt ? 1 : a.id.localeCompare(b.id);
    if (options.order === 'coverage') return b.outlets.length - a.outlets.length || Date.parse(b.latestAt) - Date.parse(a.latestAt) || a.id.localeCompare(b.id);
    return (options.order === 'newest' ? Date.parse(b.latestAt) - Date.parse(a.latestAt) : score(b) - score(a)) || a.id.localeCompare(b.id);
  });
}
