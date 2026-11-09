import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { db, pool, tripwireRecords } from '@workspace/db';
import { and, eq } from 'drizzle-orm';
import { CorrectArticleFocusBody, GetArticleFocusResponse } from '@workspace/api-zod';
import { correctFocus, focusState, resolveFocus } from '../artifacts/api-server/src/lib/article-focus-feedback.ts';
import { writeRecord, recordsFor } from '../artifacts/api-server/src/lib/tripwire-store.ts';
import { dismissArticle, restoreArticleState } from '../artifacts/api-server/src/lib/tripwire-feedback.ts';
import { captureContent } from '../artifacts/api-server/src/lib/tripwire-content.ts';

test('focus contract rejects malformed corrections and normalizes new group identity', () => {
  assert.equal(CorrectArticleFocusBody.safeParse({ mode: 'manual', expectedRevision: -1, requestId: 'short' }).success, false);
  assert.throws(() => resolveFocus({mode:'manual', categoryId:'unknown', topicTitle:'Label'}, []), e=>e.status===400);
  assert.throws(() => resolveFocus({mode:'manual', categoryId:'courts-legal', topicTitle:'   '}, []), e=>e.status===400);
  const first = resolveFocus({mode:'manual',categoryId:'courts-legal',topicTitle:'A readable label'},[]);
  const same = resolveFocus({mode:'manual',categoryId:'courts-legal',topicTitle:'a readable label'},[]);
  assert.equal(first.topicId,same.topicId);
});

test('persistent article-only focus survives refresh, stale edits and restore without content changes', async () => {
  // Both connections can be occupied by correction transactions. Reads made
  // after taking the advisory lock must reuse the holder's connection.
  pool.options.max = 2;
  pool.options.connectionTimeoutMillis = 5000;
  const owner = `focus-test-${randomUUID()}`, id = randomUUID(), other = randomUUID();
  const fixture = { kind:'article',title:'Pete Hegseth faces possible removal',url:`https://example.org/${id}`,
    outlet:'Isolated fixture',summary:'Preserved summary', retainedContent:[captureContent('Isolated retained test content.','paste')] };
  const queryRows = () => db.select().from(tripwireRecords).where(eq(tripwireRecords.owner, owner));
  try {
    const initial = await writeRecord(owner,{...fixture,id,focusOverride:{categoryId:'courts-legal',topicId:'forged',topicTitle:'Forged'}});
    assert.equal(initial.focusOverride,null,'generic creation cannot forge analyst decisions');
    await writeRecord(owner,{...fixture,id:other,url:`https://example.org/${other}`});
    const input = {mode:'manual',categoryId:'courts-legal',topicTitle:'Analyst court focus',requestId:randomUUID(),expectedRevision:0};
    const saved = await correctFocus(owner,id,input);
    assert.equal(saved.focusRevision,1);
    assert.equal(saved.fullTextHash,initial.fullTextHash);
    assert.deepEqual(saved.retainedContent,initial.retainedContent);
    assert.equal(saved.title,initial.title);
    assert.equal(saved.url,initial.url);
    assert.equal(saved.classificationRevision,initial.classificationRevision);
    const state = GetArticleFocusResponse.parse(await focusState(owner,id));
    assert.equal(state.mode,'manual'); assert.equal(state.effective.topicTitle,input.topicTitle);
    assert.equal(state.automatic.topicTitle,'Pentagon leadership — Pete Hegseth');
    await correctFocus(owner,id,input);
    assert.equal((await queryRows()).filter(r=>r.kind==='feedback'&&r.data.field==='focus').length,1);
    await assert.rejects(correctFocus(owner,id,{...input,topicTitle:'Different'}), e=>e.status===409);
    await assert.rejects(correctFocus(owner,id,{...input,requestId:randomUUID()}), e=>e.status===409);
    await assert.rejects(correctFocus(owner,id,{...input,topicId:'missing',requestId:randomUUID(),expectedRevision:1}), e=>e.status===409);
    const refreshed = await writeRecord(owner,{...initial,title:'Publisher changes the headline',focusOverride:null,focusRevision:99}, true);
    assert.deepEqual(refreshed.focusOverride,saved.focusOverride);
    const edited = await writeRecord(owner,{...refreshed,summary:'An ordinary editor update',focusOverride:null},false,true);
    assert.deepEqual(edited.focusOverride,saved.focusOverride);
    const originalGroup = (await focusState(owner,other)).effective;
    const joined = await correctFocus(owner,other,{...input,...saved.focusOverride,requestId:randomUUID()});
    assert.deepEqual(joined.focusOverride,saved.focusOverride);
    const relabeled = await correctFocus(owner,id,{...input,topicTitle:'Only this article gets renamed',expectedRevision:1,requestId:randomUUID()});
    assert.notEqual(relabeled.focusOverride.topicId,joined.focusOverride.topicId);
    assert.equal((await focusState(owner,other)).effective.topicTitle,input.topicTitle);
    const cleared = await correctFocus(owner,id,{mode:'auto',expectedRevision:2,requestId:randomUUID()});
    assert.equal(cleared.focusOverride,null);
    assert.equal((await focusState(owner,id)).mode,'auto');
    assert.equal((await focusState(owner,other)).automatic.topicId,originalGroup.topicId);
    const serial = await Promise.all([
      correctFocus(owner,id,{...input,expectedRevision:3,requestId:randomUUID()}),
      correctFocus(owner,other,{mode:'auto',expectedRevision:1,requestId:randomUUID()}),
    ]);
    assert.equal(serial[0].focusRevision,4);
    assert.equal(serial[1].focusRevision,2);
    const results = await Promise.allSettled([
      correctFocus(owner,id,{...input,topicTitle:'First racing choice',expectedRevision:4,requestId:randomUUID()}),
      correctFocus(owner,id,{...input,topicTitle:'Other choice',expectedRevision:4,requestId:randomUUID()}),
    ]);
    assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
    assert.equal(results.find(r=>r.status==='rejected').reason.status,409);
    await dismissArticle(owner,id,{reason:'Irrelevant item',requestId:randomUUID()});
    await assert.rejects(correctFocus(owner,id,{mode:'auto',expectedRevision:5,requestId:randomUUID()}),e=>e.status===409);
    assert.ok(!(await recordsFor(owner,false)).some(r=>r.id===id));
    await restoreArticleState(owner,id);
    assert.equal((await focusState(owner,id)).mode,'manual','restoration retains the analyst choice');
    const leadId = randomUUID();
    await writeRecord(owner,{...fixture,id:leadId,title:'Ossoff gains supporters',url:`https://example.org/${leadId}`,
      fullText:'Supporters discussed the 2028 presidential campaign.',
      retainedContent:[captureContent('Supporters discussed the 2028 presidential campaign.','paste')]});
    assert.equal((await focusState(owner,leadId)).automatic.topicId,'ossoff-2028','focus editor uses the same retained lead as Claims');
    const [publicRow] = await db.select().from(tripwireRecords).where(and(eq(tripwireRecords.owner,'public'),eq(tripwireRecords.kind,'article'))).limit(1);
    assert.ok(publicRow);
    const publicSaved = await correctFocus(owner,publicRow.id,{...input,requestId:randomUUID()});
    const [publicAfter] = await db.select().from(tripwireRecords).where(eq(tripwireRecords.id,publicRow.id));
    assert.deepEqual(publicAfter.data,publicRow.data,'isolated analyst choice never rewrites public source data');
    assert.deepEqual((await recordsFor(owner,false)).find(r=>r.id===publicRow.id).focusOverride,publicSaved.focusOverride);
    await assert.rejects(correctFocus(owner,randomUUID(),input),e=>e.status===404);
    const events=(await queryRows()).filter(r=>r.kind==='feedback'&&r.data.field==='focus');
    assert.ok(events.every(e=>e.data.action==='correction'&&!e.data.snapshot.fullText));
  } finally {
    await db.delete(tripwireRecords).where(eq(tripwireRecords.owner,owner));
    await pool.end();
  }
});
