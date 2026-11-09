import { test as base, expect } from '@playwright/test';

// Browser-only data, deliberately not imported into any database or served by the API.
// The representative home of "shared" is staffing; the policy article must not inherit it.
export const staffing = {
  category: 'leadership-staffing', label: 'Leadership & staffing',
  topic: 'pentagon-leadership', title: 'Pentagon leadership — Pete Hegseth',
};
export const policy = {
  category: 'policy-rulemaking', label: 'Policy & rulemaking',
  topic: 'firearms-public-health', title: 'Firearms — public-health policy',
};
const stamp = '2026-11-08T12:00:00Z';
const record = (id, kind, title, extra = {}) => ({
  id, kind, title, createdAt: stamp, updatedAt: stamp, entities: [], ...extra,
});
const article = (id, title, publishedAt) => record(id, 'article', title, {
  outlet: 'Reuters', url: `https://example.invalid/${id}`, publishedAt,
  summary: 'Isolated navigation fixture. Not real reporting.', sourceType: 'article',
  // Feed defaults to Critical/High; keep navigation independent of impact rules.
  impact: 'high', impactMode: 'manual',
});
export const records = [
  article('staff-new', 'Pete Hegseth faces possible removal', '2026-11-08T12:00:00Z'),
  article('staff-old', 'Earlier reporting on Pentagon leadership', '2026-11-01T12:00:00Z'),
  article('policy', 'Senator supports gun control on public health grounds', '2026-11-07T12:00:00Z'),
  article('unlinked', 'An article with no claim attributions', '2026-11-06T12:00:00Z'),
  record('shared', 'claim', 'Congress is considering an investigation.'),
  record('staff-only', 'claim', 'The president expressed confidence in Pete Hegseth.'),
  record('older', 'claim', 'Pentagon leadership was discussed last week.'),
];
const placement = (home, articleIds, date) => ({
  categoryId: home.category, primaryCategory: home.label,
  topicId: home.topic, topicTitle: home.title, articleIds,
  firstDate: date.slice(0, 10), lastDate: date.slice(0, 10), latestReportAt: date,
  ongoing: false, developments: [], secondaryCategories: [], relatedSubjects: [],
});
const staffNew = placement(staffing, ['staff-new'], stamp);
const policyPlacement = placement(policy, ['policy'], '2026-11-07T12:00:00Z');
const staffOld = placement(staffing, ['staff-old'], '2026-11-01T12:00:00Z');
const summaries = [
  { claimId: 'shared', attributions: 2, ...staffNew, articleIds: ['staff-new', 'policy'], placements: [staffNew, policyPlacement] },
  { claimId: 'staff-only', attributions: 1, ...staffNew, placements: [staffNew] },
  { claimId: 'older', attributions: 1, ...staffOld, placements: [staffOld] },
];
const categories = [staffing, policy].map(h => ({ id: h.category, label: h.label, description: h.label }));

export const test = base.extend({
  page: async ({ page, context, baseURL }, use) => {
    const unexpected = [];
    const errors = [];
    const origin = new URL(baseURL).origin;
    page.on('pageerror', error => errors.push(error.message));
    // Fail closed: no API request reaches the real server, including accidental writes,
    // refreshes, model calls, processing, or newly introduced endpoints.
    await context.route('**/*', async route => {
      const req = route.request();
      const url = new URL(req.url());
      if (!['GET', 'HEAD'].includes(req.method())) {
        unexpected.push(`${req.method()} ${url.pathname}`);
        return route.abort('blockedbyclient');
      }
      if (url.origin !== origin) return route.abort('blockedbyclient');
      if (!url.pathname.startsWith('/api/')) return route.continue();
      const p = url.pathname;
      let json;
      if (p === '/api/tripwire/workspace') json = {
        records, stats: { articles: 4, claims: 3, journalists: 0, watches: 0, flagged: 0 }, lastRefreshed: null,
      };
      else if (p === '/api/tripwire/provenance/summaries') json = summaries;
      else if (p === '/api/tripwire/claim-categories') json = categories;
      else if (p === '/api/tripwire/claims/processing') json = { pending: 0, failed: 0, recent: [], policy: 'local' };
      else if (p === '/api/tripwire/developments') json = { items: [], total: 0, offset: 0 };
      else if (p === '/api/tripwire/provenance') json = {
        claims: [], sources: [], matches: [], context: [], counts: {}, total: 0, offset: 0,
      };
      else {
        unexpected.push(`${req.method()} ${p}`);
        return route.abort('blockedbyclient');
      }
      return route.fulfill({ json });
    });
    await use(page);
    expect(unexpected, 'No unmocked backend reads or writes are permitted').toEqual([]);
    expect(errors, 'No uncaught browser errors').toEqual([]);
  },
});
export { expect };
