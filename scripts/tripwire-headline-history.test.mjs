import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { db, pool, tripwireRecords } from '@workspace/db';
import { and, eq } from 'drizzle-orm';
import { recordsFor, writeRecord } from '../artifacts/api-server/src/lib/tripwire-store.ts';
import { analyzeImport, commitImport } from '../artifacts/api-server/src/routes/tripwire-imports.ts';
import { captureContent } from '../artifacts/api-server/src/lib/tripwire-content.ts';
import { observeHeadline } from '../artifacts/api-server/src/lib/tripwire-headlines.ts';
import { htmlCandidate } from '../artifacts/api-server/src/lib/tripwire-import.ts';
import { archiveArticle } from '../artifacts/api-server/src/lib/tripwire-content-storage.ts';

test('verified history survives imports and editor changes in an isolated workspace', async t => {
  const owner = `headline-test-${randomUUID()}`;
  const id = randomUUID(), laterId = randomUUID(), promotedId = randomUUID();
  const oldTitle = `Pentagon policy review ${randomUUID()}`;
  const newTitle = `Pentagon revised policy review ${randomUUID()}`;
  const curated = `Curated defense headline ${randomUUID()}`;
  const url = `https://www.cnn.com/2026/11/05/politics/video/${id}`;
  const publishedAt = '2026-11-05T14:48:05.960Z';
  const body = 'Publisher reporting about the defense policy review. '.repeat(12);
  const publisherVersion = (title, articleUrl = url) => {
    const raw = `<html><head><script type="application/ld+json">${JSON.stringify({ '@type': 'VideoObject', name: title, datePublished: publishedAt, description: body, mainEntityOfPage: articleUrl })}</script></head><body><article>${body}</article></body></html>`;
    const candidate = htmlCandidate(raw, articleUrl);
    const capture = captureContent(candidate.fullText, 'url', { raw, sourceUrl: articleUrl });
    return { ...candidate, verifiedHeadlines: observeHeadline({ ...candidate, title: candidate.publisherHeadline }, capture, 'publisher-page'),
      retainedContent: [capture], publicationSource: 'publisher', publicationSourceUrl: articleUrl };
  };
  const commitDraft = (draft, changes = {}) => commitImport(owner, { draftId: draft.draftId, title: draft.candidate.title,
    outlet: draft.candidate.outlet, url: draft.candidate.url, publishedAt: draft.candidate.publishedAt,
    byline: draft.candidate.byline, ...changes });
  try {
    await writeRecord(owner, { ...publisherVersion(oldTitle), id, title: curated }, false, false, true);
    await writeRecord(owner, { ...publisherVersion(newTitle), id, title: curated }, true, false, true);
    let current = (await recordsFor(owner)).find(r => r.id === id);
    assert.equal(current.title, curated);
    assert.equal(current.publishedAt, publishedAt);
    assert.equal(current.verifiedHeadlines.length, 2);
    assert.equal(current.retainedContent.length, 2);
    assert.ok(current.retainedContent.every(c => c.bodyHash && c.raw.includes('application/ld+json')));

    await t.test('Dashboard paste without a URL updates the existing curated story', async () => {
      const draft = await analyzeImport(owner, { text: `${oldTitle}\nCNN\n\n${body}` }, { allowMatchReview: true });
      assert.equal(draft.matchedId, id);
      assert.equal(draft.candidate.title, curated);
      assert.equal(draft.candidate.publishedAt, publishedAt);
      const saved = await commitDraft(draft);
      assert.equal(saved.id, id);
      assert.equal(saved.verifiedHeadlines.length, 2);
      assert.equal(saved.publishedAt, publishedAt);
      assert.equal((await db.select().from(tripwireRecords).where(and(eq(tripwireRecords.owner, owner), eq(tripwireRecords.kind, 'article')))).length, 1);
    });
    await t.test('unverified pasted prose and editor-supplied aliases never become verified history', async () => {
      const proseTitle = `Unverified alternate headline ${randomUUID()}`;
      const draft = await analyzeImport(owner, { targetId: id, text: `${proseTitle}\nCNN\n\n${body}` }, { allowMatchReview: true });
      await commitDraft(draft);
      current = (await recordsFor(owner)).find(r => r.id === id);
      const forged = { ...current.verifiedHeadlines[0], title: proseTitle };
      await writeRecord(owner, { ...current, verifiedHeadlines: [...current.verifiedHeadlines, forged] }, false, true);
      current = (await recordsFor(owner)).find(r => r.id === id);
      assert.equal(current.verifiedHeadlines.length, 2);
      const unmatched = await analyzeImport(owner, { text: `${proseTitle}\nCNN\n\n${body}` }, { allowMatchReview: true });
      assert.equal(unmatched.matchedId, undefined);
    });
    await writeRecord(owner, { ...publisherVersion(oldTitle), id: laterId,
      url: `https://www.cnn.com/2026/11/06/politics/video/${laterId}`, title: `Distinct later clip ${randomUUID()}`,
      verifiedHeadlines: [], retainedContent: [], publishedAt: '2026-11-06T14:48:05.960Z' });
    await t.test('a match appearing after preview requires a new review before saving', async () => {
      const lateTitle = `Newly verified publisher headline ${randomUUID()}`;
      const draft = await analyzeImport(owner, { text: `${lateTitle}\nCNN\n\n${body}` }, { allowMatchReview: true });
      assert.equal(draft.matchedId, undefined);
      const later = (await recordsFor(owner)).find(r => r.id === laterId);
      const capture = captureContent('', 'headline:rss', { raw: `<title>${lateTitle}</title>`, sourceUrl: 'https://www.cnn.com/politics/feed' });
      await writeRecord(owner, { ...later, verifiedHeadlines: observeHeadline({ ...later, title: lateTitle }, capture, 'publisher-rss'), retainedContent: [capture] }, false, false, true);
      await assert.rejects(commitDraft(draft), e => e.status === 409 && /Analyze again/.test(e.message));
    });
    await t.test('per-item review redirects only on explicit interactive preview; strict enrichment rejects', async () => {
      const same = await analyzeImport(owner, { targetId: id, text: `${oldTitle}\nCNN\n\n${body}` });
      assert.equal(same.matchedId, id, 'strict enrichment accepts verified history for its own source');
      const input = { targetId: laterId, text: `${oldTitle}\nCNN\n\n${body}` };
      const draft = await analyzeImport(owner, input, { allowMatchReview: true });
      assert.equal(draft.matchedId, id);
      await assert.rejects(analyzeImport(owner, input), /different article/);
      const later = (await recordsFor(owner)).find(r => r.id === laterId);
      assert.notEqual(later.title, curated);
      assert.equal(later.publishedAt, '2026-11-06T14:48:05.960Z');
    });
    await t.test('ambiguous historical headlines block Dashboard, per-item and unattended intake', async () => {
      const later = (await recordsFor(owner)).find(r => r.id === laterId);
      const capture = captureContent('', 'headline:rss', { raw: `<title>${oldTitle}</title>`, sourceUrl: 'https://www.cnn.com/politics/feed' });
      await writeRecord(owner, { ...later, verifiedHeadlines: observeHeadline({ ...later, title: oldTitle }, capture, 'publisher-rss'), retainedContent: [capture] }, false, false, true);
      for (const [input, options] of [
        [{ text: `${oldTitle}\nCNN\n\n${body}` }, { allowMatchReview: true }],
        [{ targetId: id, text: `${oldTitle}\nCNN\n\n${body}` }, { allowMatchReview: true }],
        [{ targetId: id, text: `${oldTitle}\nCNN\n\n${body}` }, {}],
      ]) await assert.rejects(analyzeImport(owner, input, options), /More than one existing item/);
      // A unique reviewed URL resolves the collision without changing the other clip.
      const draft = await analyzeImport(owner, { text: `${oldTitle}\nCNN\n${url}\n\n${body}` }, { allowMatchReview: true });
      assert.equal(draft.matchedId, id);
    });
    await t.test('a shadowed Google discovery retains publisher history after promotion and protected refresh', async () => {
      const discoveryTitle = `Discovery headline ${randomUUID()}`;
      const historicalTitle = `Earlier publisher headline ${randomUUID()}`;
      const revisedTitle = `Revised publisher headline ${randomUUID()}`;
      const curatedTitle = `Curated bookmarked headline ${randomUUID()}`;
      const publisherUrl = `https://cnn.com/2026/11/05/politics/video/${promotedId}`;
      const discovery = { kind: 'article', title: discoveryTitle, outlet: 'CNN',
        url: `https://news.google.com/rss/articles/${promotedId}`, discoveryOnly: true,
        publishedAt: '2026-11-05T14:00:00.000Z', publicationSource: 'google-news', publicationSourceUrl: 'https://news.google.com/rss' };
      // The shared base stays hidden for its entire lifetime. Only this isolated
      // owner's explicit shadow is visible; shared feeds/queues never see it.
      await db.insert(tripwireRecords).values({ id: promotedId, owner: 'public', kind: 'article', data: { ...discovery, hidden: true } });
      await writeRecord(owner, { ...discovery, id: promotedId, hidden: false, title: curatedTitle, flagged: true, summary: 'Analyst summary' });
      const old = publisherVersion(historicalTitle, publisherUrl);
      const revised = publisherVersion(revisedTitle, publisherUrl);
      const promoted = await archiveArticle({ ...revised, hidden: true, discoveryOnly: false, intakeMethod: 'rss', intakeUrl: 'https://www.cnn.com/politics/feed',
        retainedContent: [...old.retainedContent, ...revised.retainedContent], verifiedHeadlines: [...old.verifiedHeadlines, ...revised.verifiedHeadlines] });
      await db.update(tripwireRecords).set({ data: promoted }).where(and(eq(tripwireRecords.id, promotedId), eq(tripwireRecords.owner, 'public')));
      const projected = (await recordsFor(owner, false)).find(r => r.id === promotedId);
      assert.equal(projected.url, publisherUrl);
      assert.equal(projected.discoveryOnly, false);
      assert.equal(projected.title, curatedTitle);
      assert.equal(projected.verifiedHeadlines.length, 2);
      assert.equal(projected.publishedAt, publishedAt);
      assert.equal(projected.flagged, true);
      // The collector refreshes a pre-existing shadow using this protected write.
      await writeRecord(owner, projected, true);
      const [persisted] = await db.select().from(tripwireRecords).where(eq(tripwireRecords.id, `${owner}:${promotedId}`));
      assert.equal(persisted.data.url, publisherUrl);
      assert.equal(persisted.data.discoveryOnly, false);
      assert.equal(persisted.data.verifiedHeadlines.length, 2);
      assert.equal(persisted.data.title, curatedTitle);
      assert.equal(persisted.data.summary, 'Analyst summary');
      const draft = await analyzeImport(owner, { text: `${historicalTitle}\nCNN\n\n${body}` }, { allowMatchReview: true });
      assert.equal(draft.matchedId, promotedId);
      const saved = await commitDraft(draft);
      assert.equal(saved.id, promotedId);
      assert.equal(saved.title, curatedTitle);
      assert.equal(saved.verifiedHeadlines.length, 2);
      assert.equal(saved.publishedAt, publishedAt);
      assert.ok(!(await recordsFor('workspace', false)).some(r => r.id === promotedId), 'fixture must never appear in the shared feed');
    });
  } finally {
    await db.delete(tripwireRecords).where(eq(tripwireRecords.owner, owner));
    await db.delete(tripwireRecords).where(and(eq(tripwireRecords.owner, 'public'), eq(tripwireRecords.id, promotedId)));
    assert.equal((await db.select().from(tripwireRecords).where(and(eq(tripwireRecords.owner, owner), eq(tripwireRecords.kind, 'article')))).length, 0);
    await pool.end();
  }
});
