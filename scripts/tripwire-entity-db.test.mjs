import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { db, pool, entityControlLog, entityIdentifiers, tripwireContent, tripwireRecords } from '@workspace/db';
import { entities, captures, evidence, assertions, candidates, decisions, lineage, developments, observations, jobs, automation, legacy,
  W, uid, key, settings, requireEntity, migrateWatches, profile } from '../artifacts/api-server/src/lib/entity-db.ts';
import { storeContent } from '../artifacts/api-server/src/lib/tripwire-content-storage.ts';
import { leaseJob, commitExtraction, renewLease } from '../artifacts/api-server/src/lib/entity-worker.ts';
import { control, activationBlockers } from '../artifacts/api-server/src/lib/entity-operations.ts';
import { addEvidence, decide, recordDevelopment } from '../artifacts/api-server/src/lib/entity-actions.ts';
import { AddEntityEvidenceBody } from '@workspace/api-zod';

test('durable entity provenance, decisions, worker concurrency and recovery (no provider/network)', async t => {
  const run=`fixture-${randomUUID()}`;
  const original=await settings();
  const created={entities:[],captures:[],jobs:[],hashes:[],watches:[]};
  const makeEntity=async (suffix,type='person')=>{
    const id=`${run}-${suffix}`;created.entities.push(id);
    await db.insert(entities).values({id,workspace:W,name:`Fixture ${suffix}`,type,rationale:'Fictional test fixture, not actual reporting'});
    return id;
  };
  const makeCapture=async (text,complete=true)=>{
    const hash=await storeContent(text);created.hashes.push(hash);
    const id=`${run}-${uid()}`;created.captures.push(id);
    await db.insert(captures).values({id,workspace:W,articleId:`${run}-article`,captureId:uid(),hash,source:'rss:fixture',
      complete,authorized:true,capturedAt:new Date(),byline:'Fixture Reporter'});
    return id;
  };
  const makeJob=async captureId=>{
    const id=`${run}-${uid()}`;created.jobs.push(id);
    await db.insert(jobs).values({id,workspace:W,captureId,policyVersion:uid()});
    return id;
  };
  const actor=(name,text)=>({name,type:'person',category:'military',sourceOnly:false,externalNamespace:null,externalValue:null,
    excerpt:text,start:0,end:text.length,attribution:'An unnamed adviser said',certainty:'alleged',predicate:'reportedly-discussed',objectIndex:null,
    tenure:null,validFrom:null,validTo:null,rationale:'Reported consequential involvement remains an allegation',
    eventKey:run,claimKey:'allegation',novelty:'unknown',consequence:3,
    factors:{authority:1,relationship:1,involvement:3,significance:3,continuing:2}});
  const evidenceInput=(entityId,captureId,text,more={})=>AddEntityEvidenceBody.parse({entityId,captureId,excerpt:text,start:0,end:text.length,
    attribution:'Fixture official statement',certainty:'confirmed',scope:'Fictional appointment evidence',predicate:'involved-in',...more});
  try {
    await db.update(automation).set({mode:'observe',authorized:true,privateMaterial:false,epoch:original.epoch+1,failures:0,
      dailyTokens:1000000,dailyMicros:100000000,usedTokens:0,usedMicros:0,budgetDay:new Date().toISOString().slice(0,10)}).where(eq(automation.workspace,W));
    const p1=await makeEntity('Outgoing');
    const p2=await makeEntity('Acting');
    const pos=await makeEntity('Position','position');
    const text='Fixture Outgoing held the position through June. Fixture Acting assumed the position in an acting capacity on July 1.';
    const captureId=await makeCapture(text);
    await t.test('sourced succession retains former officeholder, acting role, dates, exact immutable capture and disputed assertion',async()=>{
      const first=await addEvidence(evidenceInput(p1,captureId,text,{predicate:'occupies',objectId:pos,tenure:'former',validFrom:'2025-01-01',validTo:'2026-06-30'}));
      const second=await addEvidence(evidenceInput(p2,captureId,text,{predicate:'occupies',objectId:pos,tenure:'acting',validFrom:'2026-07-01',relation:'authoritative-appointment'}));
      const history=await profile(pos);
      assert.equal(history.assertions.length,2);
      assert.ok(history.assertions.some(a=>a.subjectId===p1 && a.tenure==='former'));
      assert.ok(history.assertions.some(a=>a.subjectId===p2 && a.tenure==='acting'));
      assert.equal(history.evidence.find(e=>e.id===first.id).capture.hash,(await db.select().from(captures).where(eq(captures.id,captureId)))[0].hash);
      await assert.rejects(addEvidence(evidenceInput(p2,captureId,text,{predicate:'occupies',objectId:pos,tenure:'nominated'})),/nomination/);
      await addEvidence(evidenceInput(p2,captureId,text,{predicate:'advises',objectId:p1,certainty:'disputed',scope:'Disputed adviser relationship'}));
      assert.ok((await profile(p2)).assertions.some(a=>a.certainty==='disputed'));
      await assert.rejects(addEvidence(evidenceInput(p2,captureId,'This fabricated quotation is not in the capture.')),/quotation/);
      await assert.rejects(addEvidence(evidenceInput(p2,captureId,text,{objectId:'outside-workspace-id'})),/not found/);
      await decide(p2,{action:'monitor',rationale:'Acting role monitoring with assessed evidence',state:'Active',classification:'strategic',priority:1,evidenceIds:[second.id]});
      await decide(p2,{action:'pin',rationale:'Manual override must survive re-extraction'});
      await assert.rejects(decide(p2,{action:'monitor',rationale:'Do not make people structural anchors',classification:'structural',evidenceIds:[second.id]}),/permanent structural/);
    });
    await t.test('correction supersedes assertion and preserves earlier passage; retraction logs prior state',async()=>{
      const old=(await profile(p1)).assertions.find(a=>a.subjectId===p1);
      await addEvidence(evidenceInput(p1,captureId,text,{predicate:'occupies',objectId:pos,tenure:'former',supersedesId:old.id,certainty:'disputed',scope:'Correction to prior tenure'}));
      const detail=await profile(p1);
      assert.equal(detail.assertions.filter(a=>a.subjectId===p1).length,2);
      assert.ok(detail.assertions.some(a=>a.supersedesId===old.id));
      await decide(p1,{action:'correct',assertionId:old.id,rationale:'Source corrected this appointment assertion'});
      assert.equal((await profile(p1)).assertions.find(a=>a.id===old.id).status,'retracted');
      assert.ok((await profile(p1)).decisions.some(d=>d.action==='retract-assertion'));
    });
    await t.test('reversible identity redirect never rewrites historical article/claim references',async()=>{
      const name=await makeEntity('Namesake');
      const ref=(await profile(p2)).evidence[0].id;
      await decide(p2,{action:'merge',targetId:name,evidenceIds:[ref],rationale:'Analyst confirmed identity using retained evidence'});
      assert.equal((await requireEntity(p2)).redirectId,name);
      assert.ok((await profile(p2)).assertions.every(a=>a.subjectId===p2));
      await decide(p2,{action:'unmerge',rationale:'Identity collision resolved as two distinct people'});
      assert.equal((await requireEntity(p2)).redirectId,null);
    });
    await t.test('twenty repetitions group once and separate material changes within same event remain visible',async()=>{
      const ref=(await profile(p2)).evidence[0].id;
      for(let i=0;i<20;i++) await db.transaction(tx=>recordDevelopment(tx,{entityId:p2,evidenceId:ref,eventKey:run,claimKey:'same-origin-allegation',
        title:'Fictional disputed allegation',novelty:'repetition',consequence:4,certainty:'alleged',relation:'syndication',assessed:false,complete:true,mode:'observe',policyVersion:'test'}));
      await db.transaction(tx=>recordDevelopment(tx,{entityId:p2,evidenceId:ref,eventKey:run,claimKey:'distinct-material-change',
        title:'Another independently assessed material change',novelty:'material',consequence:4,certainty:'attributed',relation:'unknown',assessed:false,complete:true,mode:'observe',policyVersion:'test'}));
      const rows=await db.select().from(developments).where(eq(developments.eventKey,run));
      assert.equal(rows.length,2);assert.equal(rows.filter(d=>d.disposition==='Immediate').length,0);
    });
    const extractText='Fixture Worker was reportedly discussed by an unnamed adviser regarding a consequential institutional inquiry.';
    const jobCapture=await makeCapture(extractText);
    const jobId=await makeJob(jobCapture);
    await t.test('concurrent workers cannot lease or charge the same job twice; expired lease resumes after restart',async()=>{
      const leases=await Promise.all([leaseJob('worker-a',{cost:100},jobId),leaseJob('worker-b',{cost:100},jobId)]);
      assert.equal(leases.filter(Boolean).length,1);
      const owner=leases.find(Boolean).job.leaseOwner;
      assert.equal(await renewLease(jobId,'wrong-worker'),false);
      assert.equal(await renewLease(jobId,owner),true);
      await db.update(jobs).set({leaseUntil:new Date(Date.now()-1000)}).where(eq(jobs.id,jobId));
      assert.equal(await commitExtraction(jobId,{actors:[actor('Fixture Worker',extractText)]},owner),false);
      const resumed=await leaseJob('replacement-worker',{cost:100},jobId);
      assert.equal(resumed.job.attempts,2);
      assert.equal(await commitExtraction(jobId,{actors:[actor('Fixture Worker',extractText)]},owner),false);
      assert.equal(await commitExtraction(jobId,{actors:[actor('Fixture Worker',extractText)]},'replacement-worker'),true);
      assert.equal(await commitExtraction(jobId,{actors:[actor('Fixture Worker',extractText)]},'replacement-worker'),false);
      const discovered=await db.select().from(evidence).where(eq(evidence.captureId,jobCapture));
      assert.equal(discovered.length,1);
      const [link]=await db.select().from(assertions).where(eq(assertions.evidenceId,discovered[0].id));
      created.entities.push(link.subjectId);
      assert.equal((await requireEntity(link.subjectId)).state,'Discovered');
    });
    await t.test('manual pin/priority survives re-extraction; rejected candidate stays rejected',async()=>{
      const [ref]=await db.select().from(evidence).where(eq(evidence.captureId,jobCapture));
      const [link]=await db.select().from(assertions).where(eq(assertions.evidenceId,ref.id));
      await decide(link.subjectId,{action:'pin',rationale:'Preserve shared analyst monitoring judgment'});
      const [candidate]=await db.select().from(candidates).where(eq(candidates.entityId,link.subjectId));
      await decide(link.subjectId,{action:'reject',candidateId:candidate.id,rationale:'Rejected speculative identity suggestion'});
      const again=await makeJob(jobCapture);
      await leaseJob('reprocess',{cost:100},again);
      await commitExtraction(again,{actors:[actor('Fixture Worker',extractText)]},'reprocess');
      assert.equal((await requireEntity(link.subjectId)).pinned,true);
      assert.equal((await db.select().from(candidates).where(eq(candidates.id,candidate.id)))[0].resolution,'rejected');
    });
    await t.test('journalist/anonymous descriptions do not become subject identities; unsupported outputs cannot commit',async()=>{
      const text='Fixture Reporter and an unnamed adviser supplied this account of a disputed negotiation.';
      const cap=await makeCapture(text,false),id=await makeJob(cap);
      await leaseJob('sources',{cost:100},id);
      await commitExtraction(id,{actors:[actor('Fixture Reporter',text),{...actor('an unnamed adviser',text),sourceOnly:true}]},'sources');
      assert.equal((await db.select().from(evidence).where(eq(evidence.captureId,cap))).length,0);
      const bad=await makeJob(cap);await leaseJob('bad',{cost:100},bad);
      await assert.rejects(commitExtraction(bad,{actors:[{...actor('Fixture Reporter',text),excerpt:'A fabricated quotation that does not exist'}]},'bad'),/quotation/);
    });
    await t.test('an unrelated quoted value matching another entity identifier cannot attach assertions to that identity',async()=>{
      const established=await makeEntity('Established Identity');
      const oldText='Fixture Established Identity has registry identifier 1234567 in this fictional analyst-assessed source.';
      const oldCapture=await makeCapture(oldText);
      await addEvidence(evidenceInput(established,oldCapture,oldText,{predicate:'identifier',value:'fixture-registry:1234567'}));
      const before=(await profile(established)).assertions.map(a=>a.id);
      const quote='Fixture Unrelated Subject discussed 1234567 records in an inquiry, not an identity registry.';
      const cap=await makeCapture(quote),job=await makeJob(cap);
      await leaseJob('identifier-collision',{cost:100},job);
      await commitExtraction(job,{actors:[{...actor('Fixture Unrelated Subject',quote),externalNamespace:'fixture-registry',externalValue:'1234567'}]},'identifier-collision');
      const [ref]=await db.select().from(evidence).where(eq(evidence.captureId,cap));
      const [proposal]=await db.select().from(assertions).where(eq(assertions.evidenceId,ref.id));
      assert.notEqual(proposal.subjectId,established);
      assert.deepEqual((await profile(established)).assertions.map(a=>a.id),before);
      const [candidate]=await db.select().from(candidates).where(eq(candidates.entityId,proposal.subjectId));
      assert.equal(candidate.matchId,established);
      assert.equal(candidate.resolution,'pending');
      assert.equal(candidate.identityConfidence,'unresolved');
      assert.equal((await requireEntity(proposal.subjectId)).state,'Discovered');
    });
    await t.test('pause fences stale workers, budgets defer without fake success, missing provider does not consume an attempt',async()=>{
      const cap=await makeCapture(extractText),id=await makeJob(cap);
      await leaseJob('stale',{cost:100},id);
      await control({action:'pause'});
      assert.equal(await commitExtraction(id,{actors:[actor('Fixture Worker',extractText)]},'stale'),false);
      assert.equal(await leaseJob('paused',{cost:100},id),null);
      await control({action:'observe'});
      await db.update(automation).set({dailyTokens:0}).where(eq(automation.workspace,W));
      assert.equal(await leaseJob('budget',{cost:100},id),null);
      assert.equal((await db.select().from(jobs).where(eq(jobs.id,id)))[0].status,'deferred');
      const missing=await makeJob(cap);
      const before=(await db.select().from(jobs).where(eq(jobs.id,missing)))[0].attempts;
      assert.equal(await leaseJob('missing',null,missing),null);
      const after=(await db.select().from(jobs).where(eq(jobs.id,missing)))[0];
      assert.equal(after.status,'unconfigured');assert.equal(after.attempts,before);
      assert.ok((await activationBlockers()).length>0);
      await assert.rejects(control({action:'activate'}),/private-access verification/);
    });
    await t.test('legacy migration repeatable and reversible without modifying watches, aliases, disabled states or original bylines',async()=>{
      const id=`${run}-watch`;created.watches.push(id);
      const originalData={kind:'watch',title:`${run} ambiguous legacy role`,watchType:'position',position:'Fictional office',individual:'Fictional Legacy Holder',
        enabled:false,tier:2,aliases:['Legacy alternate name'],summary:'Analyst context only'};
      await db.insert(tripwireRecords).values({id:`${W}:${id}`,owner:W,kind:'watch',data:{...originalData,baseId:id}});
      await migrateWatches();
      const entityId=key(W,'legacy',id);created.entities.push(entityId,key(W,'legacy-holder',id));
      const first=await requireEntity(entityId);
      await migrateWatches();
      assert.deepEqual(await requireEntity(entityId),first);
      assert.equal(first.state,'Archived');assert.equal(first.priority,2);
      assert.deepEqual(first.aliases,['Legacy alternate name']);
      assert.equal((await requireEntity(key(W,'legacy-holder',id))).state,'Discovered');
      assert.equal((await db.select().from(assertions).where(eq(assertions.subjectId,key(W,'legacy-holder',id)))).length,0);
      const [watch]=await db.select().from(tripwireRecords).where(eq(tripwireRecords.id,`${W}:${id}`));
      assert.deepEqual(watch.data,{...originalData,baseId:id});
    });
    await t.test('cross-workspace relational references fail closed',async()=>{
      await assert.rejects(db.insert(assertions).values({id:uid(),workspace:'not-workspace',subjectId:p1,predicate:'advises',
        evidenceId:(await profile(p1)).evidence[0].id,certainty:'alleged'}));
    });
  } finally {
    // Remove only this run's fictional fixture rows. Real content/history is retained.
    const evidenceRows=created.captures.length?await db.select().from(evidence).where(inArray(evidence.captureId,created.captures)):[];
    const evidenceIds=evidenceRows.map(e=>e.id);
    const links=evidenceIds.length?await db.select().from(assertions).where(inArray(assertions.evidenceId,evidenceIds)):[];
    const entityIds=[...new Set([...created.entities,...links.map(a=>a.subjectId)])];
    const devs=entityIds.length?await db.select().from(developments).where(sql`${developments.entityIds} && ARRAY[${sql.join(entityIds.map(id=>sql`${id}`),sql`, `)}]::text[]`):[];
    if(devs.length) {await db.delete(observations).where(inArray(observations.developmentId,devs.map(d=>d.id)));await db.delete(developments).where(inArray(developments.id,devs.map(d=>d.id)));}
    if(entityIds.length) {
      await db.delete(candidates).where(inArray(candidates.entityId,entityIds));
      await db.delete(decisions).where(inArray(decisions.entityId,entityIds));
      await db.update(assertions).set({supersedesId:null,disputesId:null}).where(inArray(assertions.subjectId,entityIds));
      await db.delete(assertions).where(inArray(assertions.subjectId,entityIds));
      await db.delete(legacy).where(inArray(legacy.entityId,entityIds));
      await db.delete(entityIdentifiers).where(inArray(entityIdentifiers.entityId,entityIds));
      await db.update(entities).set({redirectId:null,organizationId:null}).where(inArray(entities.id,entityIds));
      await db.delete(entities).where(inArray(entities.id,entityIds));
    }
    if(evidenceIds.length) {await db.delete(lineage).where(inArray(lineage.evidenceId,evidenceIds));await db.delete(evidence).where(inArray(evidence.id,evidenceIds));}
    if(created.jobs.length) await db.delete(jobs).where(inArray(jobs.id,created.jobs));
    if(created.captures.length) await db.delete(captures).where(inArray(captures.id,created.captures));
    if(created.watches.length) await db.delete(tripwireRecords).where(inArray(tripwireRecords.id,created.watches.map(id=>`${W}:${id}`)));
    if(created.hashes.length) await db.delete(tripwireContent).where(and(inArray(tripwireContent.hash,created.hashes),
      sql`not exists(select 1 from tripwire_entity_captures c where c.hash=${tripwireContent.hash})`));
    const {workspace,...restore}=original;
    await db.update(automation).set(restore).where(eq(automation.workspace,W));
    await pool.end();
  }
});
