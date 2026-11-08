import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { db, pool, tripwireRecords } from '@workspace/db';
import { and, eq } from 'drizzle-orm';
import { analyzeImport, commitImport } from '../artifacts/api-server/src/routes/tripwire-imports.ts';
import { recordsFor, writeRecord } from '../artifacts/api-server/src/lib/tripwire-store.ts';
import { articleLock } from '../artifacts/api-server/src/lib/tripwire-feedback.ts';

test('concurrent Dashboard commits serialize identity and preserve review in an isolated owner', async t => {
  const token = randomUUID(), owner = `import-concurrency-test-${token}`;
  const url = `https://example.org/concurrent-import/${token}`;
  // A transaction must not need a second connection while other commits wait
  // for its advisory lock. A small pool exposes that deadlock deterministically.
  pool.options.max = 2;
  pool.options.connectionTimeoutMillis = 5000;
  const owned = () => db.select().from(tripwireRecords).where(eq(tripwireRecords.owner, owner));
  const articles = async () => (await owned()).filter(r => r.kind === 'article');
  const text = (title, source = url) => `${title}\n${source}\nFixture Publisher\n\nRetained fixture content for ${token}. Not real reporting.`;
  const preview = (title, source = url, targetId, allowMatchReview = true) =>
    analyzeImport(owner, { text: text(title, source), targetId }, { allowMatchReview });
  const input = draft => ({ draftId: draft.draftId, title: draft.candidate.title, url: draft.candidate.url, outlet: 'Fixture Publisher' });
  const isReviewConflict = e => e.status === 409 && /Analyze again.*review/i.test(e.message);
  try {
    const drafts = [
      await preview(`First isolated draft ${token}`),
      await preview(`Second isolated draft ${token}`, `${url}/?utm_source=other-draft#reader`),
    ];
    assert.ok(drafts.every(d => !d.matchedId));
    assert.equal(drafts[0].candidate.url, drafts[1].candidate.url);
    let winner, losingDraft;
    await t.test('two previews for one canonical URL save one story, not two', async () => {
      const results = await Promise.allSettled(drafts.map(d => commitImport(owner, input(d))));
      const success = results.filter(r => r.status === 'fulfilled');
      const conflict = results.filter(r => r.status === 'rejected');
      assert.equal(success.length, 1, JSON.stringify(results));
      assert.equal(conflict.length, 1);
      assert.ok(isReviewConflict(conflict[0].reason), conflict[0].reason.message);
      winner = success[0].value;
      losingDraft = drafts[results.findIndex(r => r.status === 'rejected')];
      assert.equal((await articles()).length, 1);
      const storedDrafts = (await owned()).filter(r => r.kind === 'import-draft');
      assert.equal(storedDrafts.filter(r => r.data.committedId === winner.id).length, 1);
      assert.ok(!storedDrafts.find(r => r.id === `draft:${losingDraft.draftId}`).data.committedId);
      await assert.rejects(commitImport(owner, { ...input(losingDraft), matchAction: 'create' }), e =>
        e.status === 409 && /source URL already belongs/.test(e.message));
    });
    await t.test('retries of one saved draft are idempotent even when the pool is saturated', async () => {
      const winningDraft = drafts.find(d => d.draftId !== losingDraft.draftId);
      const results = await Promise.allSettled(Array.from({ length: 6 }, () => commitImport(owner, input(winningDraft))));
      assert.ok(results.every(r => r.status === 'fulfilled'), JSON.stringify(results));
      const retries = results.map(r => r.value);
      assert.ok(retries.every(r => r.id === winner.id && r.createdAt === winner.createdAt));
      assert.equal((await articles()).length, 1);
    });
    await t.test('simultaneous first saves of the same draft return the same article', async () => {
      const draft = await preview(`Repeated first save ${token}`, `${url}-same-draft`);
      const [first, retry] = await Promise.all([commitImport(owner, input(draft)), commitImport(owner, input(draft))]);
      assert.equal(first.id, retry.id);
      assert.equal(first.createdAt, retry.createdAt);
      assert.equal((await articles()).length, 2);
    });
    await t.test('the losing draft requires a new explicit review before updating the winner', async () => {
      await assert.rejects(commitImport(owner, input(losingDraft)), isReviewConflict);
      const reviewed = await preview(`Reviewed second copy ${token}`);
      assert.equal(reviewed.matchedId, winner.id);
      const result = await commitImport(owner, { ...input(reviewed), matchAction: 'update' });
      assert.equal(result.id, winner.id);
      assert.equal((await articles()).length, 2);
      const current = (await recordsFor(owner)).find(r => r.id === winner.id);
      assert.ok(current.retainedContent.length >= 2, 'both reviewed source captures survive');
    });
    await t.test('unattended enrichment cannot redirect to another record; interactive review can', async () => {
      const separate = await preview(`Distinct isolated source ${token}`, `${url}-distinct`);
      const other = await commitImport(owner, { ...input(separate), matchAction: 'create' });
      const before = (await articles()).find(r => r.data.baseId === winner.id);
      await assert.rejects(preview(other.title, other.url, winner.id, false), /matches a different article/);
      const reviewed = await preview(other.title, other.url, winner.id, true);
      assert.equal(reviewed.matchedId, other.id);
      assert.equal((await commitImport(owner, { ...input(reviewed), matchAction: 'update' })).id, other.id);
      assert.deepEqual((await articles()).find(r => r.data.baseId === winner.id), before, 'selected original remains untouched');
    });
    await t.test('failed transaction rolls back new article text and article rows together', async () => {
      const id = randomUUID(), body = `Rollback-only fixture ${randomUUID()}`;
      const hash = createHash('sha256').update(JSON.stringify([body, body])).digest('hex');
      await assert.rejects(db.transaction(async tx => {
        await articleLock(tx, owner);
        await writeRecord(owner, { id, kind: 'article', title: `Rollback fixture ${token}`, url: `${url}-rollback`, fullText: body }, false, false, false, tx);
        assert.ok((await recordsFor(owner, true, tx)).some(r => r.id === id && r.fullText === body), 'transaction reads its own article and content');
        throw new Error('Intentional isolated rollback');
      }), /Intentional isolated rollback/);
      assert.ok(!(await articles()).some(r => r.data.baseId === id));
      assert.equal((await pool.query('select hash from tripwire_content where hash=$1', [hash])).rowCount, 0);
    });
    const ids = (await articles()).map(r => r.data.baseId);
    assert.equal(ids.length, 3);
    const visibleElsewhere = await pool.query(`select id from tripwire_records where owner in ('public','workspace')
      and (data->>'baseId'=any($1::text[]) or data->>'url' like $2)`, [ids, `%${token}%`]);
    assert.equal(visibleElsewhere.rowCount, 0, 'fixtures never enter public/workspace feeds');
    assert.equal((await pool.query('select 1 from tripwire_claim_jobs where article_id=any($1::text[])', [ids])).rowCount, 0);
  } finally {
    // All fixtures have a private random owner; none ever enter shared feeds.
    await db.delete(tripwireRecords).where(and(eq(tripwireRecords.owner, owner)));
    assert.equal((await owned()).length, 0);
    await pool.end();
  }
});
