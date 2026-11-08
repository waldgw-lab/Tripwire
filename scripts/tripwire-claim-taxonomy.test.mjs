import test from 'node:test';
import assert from 'node:assert/strict';
import { CLAIM_CATEGORIES, claimCategory, claimTopic, organizeClaimCoverage } from '../artifacts/api-server/src/lib/claim-taxonomy.ts';
const now = Date.parse('2026-11-08T15:00:00Z');
test('all twelve primary categories and the explicit review fallback are distinguishable', () => {
  const examples = [
    ['leadership-staffing', 'President Trump is considering replacing Defense Secretary Hegseth.'],
    ['authority-structure', 'The president reorganized the agency and its chain of command.'],
    ['advice-deliberations', 'Military advisers recommended a different plan to the president.'],
    ['institutional-relationships', 'Pentagon officials described disagreements with presidential advisers.'],
    ['policy-rulemaking', 'The president signed an executive order changing regulations.'],
    ['operations-enforcement', 'Military forces deployed troops and fired missiles.'],
    ['diplomacy-agreements', 'The countries are negotiating a ceasefire.'],
    ['resources-capabilities', 'Congress approved funding for new ammunition.'],
    ['oversight-accountability', 'The committee issued a subpoena and began an impeachment inquiry.'],
    ['courts-legal', 'The judge ordered the government to comply with the injunction.'],
    ['records-information', 'The agency deleted official records and withheld documents.'],
    ['elections-control', 'Democrats won control of Congress in the election.'],
    ['uncategorized', 'The population is fourteen million.'],
  ];
  assert.equal(CLAIM_CATEGORIES.length, 13);
  assert.equal(new Set(CLAIM_CATEGORIES.map(c => c.id)).size, 13);
  for (const [id, text] of examples) assert.equal(claimCategory(text, '', now), id, text);
});
test('specific proceedings and recommendations are not swallowed by broad staffing keywords', () => {
  assert.equal(claimCategory('Congress opened an impeachment inquiry into Hegseth.', '', now), 'oversight-accountability');
  assert.equal(claimCategory('Pentagon advisers recommended replacing Hegseth.', '', now), 'advice-deliberations');
  assert.equal(claimCategory('New documents revealed Trump is considering replacing Hegseth.', '', now), 'leadership-staffing');
  assert.equal(claimCategory('Iran fired missiles, President Trump said.', '', now), 'operations-enforcement');
  assert.equal(claimCategory('There are 435 seats.', 'Trump may fire Hegseth', now), 'uncategorized');
});
test('Hegseth threads remain distinct from the Miller/Wiles handoff, without conflating unrelated Millers', () => {
  const h = claimTopic('Trump may fire Hegseth.', '', 'leadership-staffing', 'h');
  const m = claimTopic('Stephen Miller would replace Susie Wiles as chief of staff.', '', 'leadership-staffing', 'm');
  const w = claimTopic('Susie Wiles is departing.', '', 'leadership-staffing', 'w');
  const m2 = claimTopic('Steve\u00a0Miller is the new chief of staff.', '', 'leadership-staffing', 'm2');
  assert.equal(m.topicId, w.topicId); assert.equal(m.topicId, m2.topicId);
  assert.notEqual(h.topicId, m.topicId);
  assert.notEqual(claimTopic('Matt Miller denied campaign allegations.', '', 'elections-control', 'other').topicId, m.topicId);
});
test('unknown topics are not forcibly merged and grouping does not infer a real-world appointment', () => {
  const a = claimTopic('An unnamed official disputed that account.', '', 'uncategorized', 'a');
  const b = claimTopic('An unnamed official disputed that account.', '', 'uncategorized', 'b');
  assert.notEqual(a.topicId, b.topicId);
});
test('article focus uses explicit source context; incidental claim names cannot change its home', () => {
  const rows = [
    { id: 'c1', data: { kind: 'claim', title: 'Stephen Miller was promoted to White House chief of staff.' } },
    { id: 'c2', data: { kind: 'claim', title: 'Slotkin pointed to Miller’s promotion as Trump doubling down.' } },
    { id: 'a', data: { kind: 'article', title: 'Slotkin discusses chief of staff Miller', summary: 'Stephen Miller is the White House chief of staff.' } },
  ];
  const links = rows.slice(0, 2).map(r => ({ claim_id: r.id, article_id: 'a', proposition: r.data.title }));
  const summaries = rows.slice(0, 2).map(r => ({ claimId: r.id, latestReportAt: '2026-11-08T12:00:00Z' }));
  const out = organizeClaimCoverage(rows, links, summaries, now);
  assert.equal(out[0].topicId, 'white-house-chief-of-staff');
  assert.equal(out[1].topicId, out[0].topicId);
  const other = { claim_id: 'other', article_id: 'a', proposition: 'Matt Miller also discussed his campaign.' };
  assert.equal(organizeClaimCoverage(rows, [...links, other], summaries, now)[1].topicId, out[0].topicId);
});
test('feed linkages are exact, visible, canonical and deduplicated, never inherited from a shared topic', () => {
  const rows = [
    { id: 'c1', data: { kind: 'claim', title: 'Trump may fire Hegseth.', observations: [{ articleId: 'a1' }] } },
    { id: 'c2', data: { kind: 'claim', title: 'Hegseth may be replaced.' } },
    { id: 'owner:a1', data: { baseId: 'a1', kind: 'article', title: 'Hegseth future', publishedAt: '2026-11-08T12:00:00Z' } },
    { id: 'a2', data: { kind: 'article', title: 'Hegseth future', publishedAt: '2026-11-08T11:00:00Z' } },
    { id: 'hidden', data: { kind: 'article', title: 'Hidden Hegseth report', hidden: true } },
  ];
  const snapshot = structuredClone(rows);
  const out = organizeClaimCoverage(rows, [
    { claim_id: 'c1', article_id: 'owner:a1', proposition: 'Trump may fire Hegseth.' },
    { claim_id: 'c1', article_id: 'hidden', proposition: 'Trump may fire Hegseth.' },
    { claim_id: 'c2', article_id: 'a2', proposition: 'Hegseth may be replaced.' },
  ], [{ claimId: 'c1', latestReportAt: '2026-11-08T12:00:00Z' }, { claimId: 'c2', latestReportAt: '2026-11-08T11:00:00Z' }], now);
  assert.equal(out[0].topicId, out[1].topicId);
  assert.deepEqual(out[0].articleIds, ['a1']);
  assert.deepEqual(out[1].articleIds, ['a2']);
  assert.equal(out[0].ongoing, true);
  assert.deepEqual(rows, snapshot);
});
test('fresh saves cannot revive old or undated claims; historical background is not an ongoing development', () => {
  const rows = [
    { id: 'stats', data: { kind: 'claim', title: 'Since 1934 the president gained seats in three midterm elections.', updatedAt: '2026-11-08' } },
    { id: 'a', data: { kind: 'article', title: 'Midterms' } },
  ];
  const links = [{ claim_id: 'stats', article_id: 'a' }];
  for (const latestReportAt of ['2026-11-08T12:00:00Z', '2025-11-08T12:00:00Z', null])
    assert.equal(organizeClaimCoverage(rows, links, [{ claimId: 'stats', latestReportAt }], now)[0].ongoing, false);
});

test('one article focus has one primary home regardless of the quantity of differently categorized claims', () => {
  const statements = [
    ['staff1', 'a1', 'Stephen Miller would replace Susie Wiles as chief of staff.'],
    ['staff2', 'a2', 'Susie Wiles is departing as chief of staff.'],
    ...Array.from({ length: 8 }, (_, i) => [`confidence${i}`, 'a3', 'Susie Wiles described disagreements with presidential advisers.']),
  ];
  const rows = [
    ...statements.map(([id, , title]) => ({ id, data: { kind: 'claim', title } })),
    ...['a1', 'a2', 'a3'].map(id => ({ id, data: { kind: 'article', title: 'Stephen Miller / Susie Wiles: White House chief-of-staff transition' } })),
  ];
  const links = statements.map(([claim_id, article_id, proposition]) => ({ claim_id, article_id, proposition }));
  const summaries = statements.map(([claimId]) => ({ claimId, latestReportAt: '2026-11-08T12:00:00Z' }));
  const out = organizeClaimCoverage(rows, links, summaries, now);
  assert.equal(new Set(out.map(r => r.topicId)).size, 1);
  assert.deepEqual([...new Set(out.map(r => r.categoryId))], ['leadership-staffing']);
  assert.equal(new Set(out.flatMap(r => r.articleIds)).size, 3);
  for (const r of out) {
    assert.deepEqual(r.secondaryCategories.map(c => c.id), ['institutional-relationships']);
    assert.deepEqual(r.articleIds, [statements.find(([id]) => id === r.claimId)[1]]);
  }
  const reversed = organizeClaimCoverage([...rows].reverse(), [...links].reverse(), [...summaries].reverse(), now);
  assert.deepEqual(reversed.map(r => [r.claimId, r.categoryId, r.secondaryCategories]).sort(),
    out.map(r => [r.claimId, r.categoryId, r.secondaryCategories]).sort());
});

test('geography alone does not collapse unrelated military and diplomatic developments into one category', () => {
  const statements = [
    ['ops', 'Military forces deployed troops and fired missiles in Iran.'],
    ['talks', 'Iran and the other countries are negotiating a ceasefire.'],
  ];
  const rows = statements.flatMap(([id, title]) => [
    { id, data: { kind: 'claim', title } }, { id: `${id}-article`, data: { kind: 'article', title } },
  ]);
  const out = organizeClaimCoverage(rows, statements.map(([claim_id, proposition]) =>
    ({ claim_id, article_id: `${claim_id}-article`, proposition })),
    statements.map(([claimId]) => ({ claimId })), now);
  assert.notEqual(out[0].topicId, out[1].topicId);
  assert.notEqual(out[0].topicTitle, out[1].topicTitle);
  assert.deepEqual(out.map(r => r.categoryId), ['operations-enforcement', 'diplomacy-agreements']);
  assert.equal(out[0].topicTitle, 'Iran — military operations');
  assert.equal(out[1].topicTitle, 'Iran — diplomacy & negotiations');
});
