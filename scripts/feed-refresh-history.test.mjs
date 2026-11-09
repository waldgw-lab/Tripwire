import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { pool } from '@workspace/db';
import { refreshFeeds } from '../artifacts/api-server/src/lib/tripwire-feeds.ts';
import { parseRssItems, sitemapItems } from '../artifacts/api-server/src/lib/tripwire-intake.ts';
import { recordsFor, writeRecord } from '../artifacts/api-server/src/lib/tripwire-store.ts';

test('full publisher collector preserves headline history and curated workspace metadata without network', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
  const schema = `feed_history_${randomUUID().replaceAll('-', '')}`;
  const admin = await pool.connect();
  const setPath = client => { void client.query(`set search_path to "${schema}"`); };
  const network = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('Network forbidden in collector fixture'); };
  try {
    await admin.query(`create schema "${schema}"`);
    await admin.query(`set search_path to "${schema}"`);
    await admin.query('create table tripwire_records (like public.tripwire_records including all)');
    await admin.query('create table tripwire_content (like public.tripwire_content including all)');
    pool.on('connect', setPath);
    for (const client of pool._clients) if (client !== admin) await client.query(`set search_path to "${schema}"`);
    await admin.query("insert into tripwire_records(id,owner,kind,data) values('fixture-cnn','public','outlet',$1)",
      [JSON.stringify({ kind: 'outlet', title: 'CNN', feedUrl: 'https://rss.cnn.com/rss/cnn_allpolitics.rss' })]);
    let headline = 'Pentagon officials announced a review of fictional Army leadership';
    const original = headline;
    const url = 'https://www.cnn.com/2026/11/09/politics/fictional-command-review';
    const published = new Date(Date.now() - 60_000).toISOString();
    const reads = [];
    const readSource = async source => {
      reads.push(source.kind);
      assert.notEqual(source.kind, 'google-news', 'connected publisher sources must prevent discovery fallback');
      if (source.kind === 'sitemap') return sitemapItems(`<urlset xmlns:news="http://www.google.com/schemas/sitemap-news/0.9"><url><loc>${url}</loc><news:news><news:title>${headline}</news:title><news:publication_date>${published}</news:publication_date></news:news></url></urlset>`, 'CNN');
      return parseRssItems(`<rss version="2.0"><channel><title>Isolated CNN fixture</title><link>https://www.cnn.com</link><description>Fictional regression only</description><item><title>${headline}</title><link>${url}?utm_source=fixture</link><pubDate>${new Date(published).toUTCString()}</pubDate></item></channel></rss>`);
    };
    const first = await refreshFeeds(undefined, readSource);
    let articles = (await recordsFor('workspace')).filter(r => r.kind === 'article');
    assert.equal(articles.length, 1, JSON.stringify({ first, reads }));
    const id = articles[0].id;
    assert.ok(articles[0].verifiedHeadlines.some(h => h.title === original));
    assert.ok(articles[0].retainedContent.some(c => c.source.startsWith('headline:')), 'headline evidence survives an excerpt-free feed');
    await writeRecord('workspace', { ...articles[0], title: 'Analyst-curated fictional review title', publishedAt: published, publicationSource: 'manual' }, false, true);
    headline = 'Pentagon officials expanded the review of fictional Army leadership';
    t.mock.timers.tick(61_000);
    await refreshFeeds(undefined, readSource);
    t.mock.timers.tick(61_000);
    await refreshFeeds(undefined, readSource);
    articles = (await recordsFor('workspace')).filter(r => r.kind === 'article');
    assert.equal(articles.length, 1, 'tracking variants reuse the same article identity');
    assert.equal(articles[0].id, id);
    assert.equal(articles[0].title, 'Analyst-curated fictional review title');
    assert.equal(articles[0].publishedAt, published);
    assert.ok(articles[0].verifiedHeadlines.some(h => h.title === original));
    assert.ok(articles[0].verifiedHeadlines.some(h => h.title === headline));
    assert.equal(articles[0].verifiedHeadlines.length, 2, 'repeat refreshes do not duplicate history');
    assert.ok(reads.length >= 3);
    await admin.query("update tripwire_records set data=data || $1::jsonb where kind='outlet' and owner='public'",
      [JSON.stringify({ feedUrl: 'https://unfamiliar.example.org/rss' })]);
    const unverifiedTitle = 'Pentagon officials questioned the fictional Army leadership review';
    t.mock.timers.tick(61_000);
    const custom = await refreshFeeds(undefined, async source => {
      assert.equal(source.url, 'https://unfamiliar.example.org/rss', 'connected custom source keeps fallback standby');
      return parseRssItems(`<rss version="2.0"><channel><title>Unverified feed fixture</title><link>https://unfamiliar.example.org</link><description>Fictional regression only</description><item><title>${unverifiedTitle}</title><link>${url}</link><pubDate>${new Date(published).toUTCString()}</pubDate></item></channel></rss>`);
    });
    assert.deepEqual(custom.failures, [], 'the unverified-source assertion must exercise successful ingestion, not a parser failure');
    const afterCustom = (await recordsFor('workspace')).find(r => r.id === id);
    assert.equal(afterCustom.verifiedHeadlines.length, 2);
    assert.ok(!afterCustom.verifiedHeadlines.some(h => h.title === unverifiedTitle), 'an unfamiliar feed cannot establish a verified publisher alias');
    t.mock.timers.tick(61_000);
    await refreshFeeds(undefined, async source => {
      if (source.kind !== 'google-news') throw new Error('Isolated fixture: publisher temporarily unavailable');
      return [{
        title: 'Pentagon officials discussed a fictional Army staffing transition - CNN',
        link: 'https://news.google.com/articles/fictional-isolated-discovery',
        isoDate: published, publisherSource: [{ _: 'CNN', $: { url: 'https://www.cnn.com' } }],
      }];
    });
    const discovery = (await recordsFor('workspace')).find(r => r.discoveryOnly);
    assert.ok(discovery);
    assert.equal(discovery.verifiedHeadlines?.length ?? 0, 0, 'Google discovery cannot establish verified publisher aliases');
    assert.ok(!discovery.fullText, 'discovery metadata must not become an article body');
  } finally {
    globalThis.fetch = network;
    pool.off('connect', setPath);
    for (const client of pool._clients) await client.query('set search_path to public');
    await admin.query(`drop schema if exists "${schema}" cascade`);
    admin.release();
    await pool.end();
  }
});
