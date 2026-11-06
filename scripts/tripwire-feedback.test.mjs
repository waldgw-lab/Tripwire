import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { db, pool, tripwireRecords } from '@workspace/db';
import { eq, and } from 'drizzle-orm';
import { correctArticle, dismissArticle, restoreArticleState, currentArticle } from '../artifacts/api-server/src/lib/tripwire-feedback.ts';
import { writeRecord, removeRecord, recordsFor } from '../artifacts/api-server/src/lib/tripwire-store.ts';
import { archiveArticle } from '../artifacts/api-server/src/lib/tripwire-content-storage.ts';
import { captureContent } from '../artifacts/api-server/src/lib/tripwire-content.ts';

test('atomic retained feedback safety in an isolated non-public owner', async t => {
  const owner = `feedback-test-${randomUUID()}`;
  const id = randomUUID(), other = randomUUID();
  const fixture = { kind:'article',title:'Pentagon advisers discuss leadership succession',url:`https://example.org/${id}`,
    outlet:'Fixture outlet',summary:'Original summary',reportingType:'unassessed',sentiment:'unassessed',
    retainedContent:[captureContent('Retained factual fixture text, not real reporting.','paste')] };
  const eventCount = async action => (await db.select().from(tripwireRecords).where(and(eq(tripwireRecords.owner,owner),eq(tripwireRecords.kind,'feedback')))).filter(r=>!action||r.data.action===action).length;
  try {
    const initial = await writeRecord(owner,{...fixture,id});
    const revision=initial.classificationRevision??0;
    await t.test('invalid reason and Other-without-note are rejected with no event', async()=>{
      await assert.rejects(dismissArticle(owner,id,{reason:'Other',requestId:randomUUID()}));
      await assert.rejects(correctArticle(owner,id,{field:'impact',mode:'manual',value:'high',reason:'',requestId:randomUUID(),expectedRevision:revision}));
      assert.equal(await eventCount(),0);
      assert.ok((await recordsFor(owner,false)).some(r=>r.id===id));
    });
    const change={field:'impact',mode:'manual',value:'low',reason:'Overrated',requestId:randomUUID(),expectedRevision:revision};
    const saved=await correctArticle(owner,id,change);
    await correctArticle(owner,id,change);
    assert.equal(await eventCount('correction'),1);
    await assert.rejects(correctArticle(owner,id,{...change,value:'critical'}),e=>e.status===409);
    assert.equal(saved.impactMode,'manual');
    const topic=await correctArticle(owner,id,{field:'topic',mode:'manual',value:'Custom topic',reason:'Wrong topic',requestId:randomUUID(),expectedRevision:saved.classificationRevision});
    assert.equal(topic.impact,'low');
    await assert.rejects(correctArticle(owner,id,{...change,requestId:randomUUID()}), e=>e.status===409);
    const noop=await correctArticle(owner,id,{...change,requestId:randomUUID(),expectedRevision:topic.classificationRevision});
    assert.equal(noop.classificationRevision,topic.classificationRevision);
    assert.equal(await eventCount('correction'),2);
    const updated=await writeRecord(owner,{...topic,title:fixture.title,summary:'Workspace edit',impact:'critical',impactMode:'auto'});
    assert.equal(updated.impact,'low'); assert.equal(updated.topic,'Custom topic');
    await t.test('full editor cannot bypass reason or overwrite a concurrent classification', async()=>{
      await assert.rejects(writeRecord(owner,{...updated,impact:'high',impactMode:'manual'},false,true),e=>e.status===400);
      await assert.rejects(writeRecord(owner,{...updated,impact:'high',impactMode:'manual',classificationReason:'Underrated',expectedClassificationRevision:0},false,true),e=>e.status===409);
    });
    const auto=await correctArticle(owner,id,{field:'impact',mode:'auto',reason:'Other',notes:'Use current policy',requestId:randomUUID(),expectedRevision:updated.classificationRevision});
    assert.equal(auto.topic,'Custom topic');
    assert.equal(auto.impactMode,'auto');
    const deletion={reason:'Irrelevant item',notes:'Evaluation only',requestId:randomUUID()};
    await assert.rejects(removeRecord(owner,id),e=>e.status===400);
    await dismissArticle(owner,id,deletion); await dismissArticle(owner,id,deletion);
    assert.equal(await eventCount('deletion'),1);
    assert.ok(!(await recordsFor(owner,false)).some(r=>r.id===id));
    const hidden=await db.transaction(tx=>currentArticle(tx,owner,id));
    assert.equal(hidden.data.summary,'Workspace edit');
    assert.equal(hidden.data.retainedContent.length,1);
    assert.ok(hidden.data.retainedContent[0].bodyHash);
    await assert.rejects(writeRecord(owner,updated),e=>e.status===409);
    await assert.rejects(writeRecord(owner,{...fixture,id:other,url:`${fixture.url}?utm_source=rss`}),e=>e.status===409);
    await writeRecord(owner,{...fixture,id:other,url:`https://another-outlet.org/${id}`});
    await restoreArticleState(owner,id); await restoreArticleState(owner,id);
    assert.equal(await eventCount('restoration'),1);
    assert.equal(await eventCount('deletion'),1);
    await dismissArticle(owner,id,deletion);
    assert.ok((await recordsFor(owner,false)).some(r=>r.id===id),'old dismissal retry cannot hide a restored article');
    const events=await db.select().from(tripwireRecords).where(and(eq(tripwireRecords.owner,owner),eq(tripwireRecords.kind,'feedback')));
    assert.ok(events.every(e=>e.data.actor===(e.data.action==='system-correction'?'System':'Workspace analyst')));
    assert.ok(events.every(e=>!e.data.snapshot.fullText));
    assert.ok(events.find(e=>e.data.action==='correction').data.before.automatic.policyVersion);
    await t.test('concurrent decisions with the same revision have exactly one winner', async()=>{
      const concurrentId=randomUUID();
      await writeRecord(owner,{...fixture,id:concurrentId,url:`https://example.org/${concurrentId}`});
      const results=await Promise.allSettled([
        correctArticle(owner,concurrentId,{field:'impact',mode:'manual',value:'low',reason:'Overrated',requestId:randomUUID(),expectedRevision:0}),
        correctArticle(owner,concurrentId,{field:'topic',mode:'manual',value:'Politics',reason:'Wrong topic',requestId:randomUUID(),expectedRevision:0}),
      ]);
      assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
      assert.equal(results.find(r=>r.status==='rejected').reason.status,409);
    });
    await t.test('dismissing a public article preserves isolated workspace edits and public source references',async()=>{
      const [shared]=await db.select().from(tripwireRecords).where(and(eq(tripwireRecords.owner,'public'),eq(tripwireRecords.kind,'article'))).limit(1);
      assert.ok(shared);
      const edit=await writeRecord(owner,{...shared.data,id:shared.id,summary:'Isolated analyst summary',saved:true});
      await dismissArticle(owner,shared.id,{reason:'Duplicate item',duplicateOf:other,requestId:randomUUID()});
      const retained=await db.transaction(tx=>currentArticle(tx,owner,shared.id));
      assert.equal(retained.data.summary,'Isolated analyst summary');
      assert.equal(retained.data.saved,true);
      assert.equal(retained.data.fullTextHash,edit.fullTextHash);
      const [unchanged]=await db.select().from(tripwireRecords).where(eq(tripwireRecords.id,shared.id));
      assert.deepEqual(unchanged.data,shared.data);
    });
  } finally {
    await db.delete(tripwireRecords).where(eq(tripwireRecords.owner,owner));
    await pool.end();
  }
});
