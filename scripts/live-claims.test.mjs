import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {pool} from '@workspace/db';
import {extractLocalClaims,extractClaimChunk,claimDirection} from '../artifacts/api-server/src/lib/live-claim-rules.ts';
import {queueArticleClaims,runClaimTick,claimProcessing} from '../artifacts/api-server/src/lib/live-claims.ts';
import {reportingProvenance} from '../artifacts/api-server/src/lib/reporting-provenance.ts';
import {claimCoverageSummaries} from '../artifacts/api-server/src/lib/reporting-summary.ts';
import {correctDirection} from '../artifacts/api-server/src/lib/claim-direction.ts';
import {recordsFor,writeRecord} from '../artifacts/api-server/src/lib/tripwire-store.ts';
import {storeContent,readContent} from '../artifacts/api-server/src/lib/tripwire-content-storage.ts';
import {CLAIM_POLICY} from '../artifacts/api-server/src/lib/live-claim-rules.ts';

const text='Officials said the regional commanders strengthened air defenses after the attack.\nThe commanders failed to protect the northern supply route during the attack.';
const hash=s=>createHash('sha256').update(JSON.stringify([s,s])).digest('hex');

test('local claim extraction preserves precise passages, subject direction, denial and uncertainty',()=>{
 const claims=extractLocalClaims('😀 '+text);
 assert.equal(claims.length,2);
 assert.equal(claims[0].direction,'positive');
 assert.equal(claims[0].subject,'the regional commanders');
 assert.equal(claims[1].direction,'negative');
 for(const c of claims)assert.equal(('😀 '+text).slice(c.start,c.end),c.excerpt);
 assert.equal(claimDirection('Commanders may have strengthened defenses after the attack.').direction,'unassessed');
 assert.equal(claimDirection('Commanders did not endanger their troops during the attack.').direction,'unassessed');
 assert.equal(claimDirection('The new defenses improved protection but weakened the reserve force.').direction,'mixed');
 assert.equal(extractLocalClaims('Officials denied that the regional commanders endangered troops during the attack.')[0].direction,'unassessed');
 assert.equal(extractLocalClaims('According to two officials, regional commanders strengthened air defenses after the attack.')[0].descriptor,'two officials');
 assert.equal(extractLocalClaims('Subscribe to our newsletter for the latest articles and daily news.').length,0);
});

test('local processing resumes beyond one chunk without lost offsets or a silent twenty-claim cutoff',()=>{
 const body=Array.from({length:100},(_,i)=>`Unit ${i} strengthened defensive positions along the northern border after the attack.`).join('\n');
 let cursor=0,all=[];
 while(cursor<body.length){const c=extractClaimChunk(body,cursor);assert.ok(c.nextCursor>cursor);cursor=c.nextCursor;all.push(...c.claims);}
 assert.equal(all.length,100);
 assert.equal(new Set(all.map(c=>c.excerpt)).size,100);
 for(const c of all)assert.equal(body.slice(c.start,c.end),c.excerpt);
 const long=Array(6).fill(body).join('\n');cursor=0;all=[];
 while(cursor<long.length){const c=extractClaimChunk(long,cursor);assert.ok(c.nextCursor>cursor);cursor=c.nextCursor;all.push(...c.claims);}
 assert.equal(all.length,600);
 for(const c of all)assert.equal(long.slice(c.start,c.end),c.excerpt);
});

test('real intake trigger, worker, versions, corrections, retries and summaries in an isolated schema',async()=>{
 const schema=`claims_test_${randomUUID().replaceAll('-','')}`;
 const admin=await pool.connect();
 let setPath;
 try {
  await admin.query(`create schema "${schema}"`);
  await admin.query(`set search_path to "${schema}"`);
  await admin.query('create table tripwire_records (like public.tripwire_records including all)');
  await admin.query('create table tripwire_content (like public.tripwire_content including all)');
  for(const file of ['0000_evidence_entities','0002_reporting_provenance','0003_development_claim_links','0004_live_claims','0005_claim_capture_intake','0006_claim_extraction_reuse','0007_retained_content_immutable']){
   const sql=await readFile(new URL(`../lib/db/migrations/entities/${file}.sql`,import.meta.url),'utf8');
   for(const part of sql.split('--> statement-breakpoint').filter(p=>p.trim()))await admin.query(part.replaceAll('"public".',`"${schema}".`));
  }
  setPath=client=>{void client.query(`set search_path to "${schema}"`);};pool.on('connect',setPath);
  for(const c of pool._clients)if(c!==admin)await c.query(`set search_path to "${schema}"`);
  const content=async body=>{
   const h=hash(body);
   await admin.query("insert into tripwire_content(hash,text,raw) values($1,$2,$2) on conflict do nothing",[h,body]);
   return h;
  };
  const put=async(id,body,extra={})=>{
   const h=body===null?undefined:await content(body);
   await admin.query(`insert into tripwire_records(id,owner,kind,data) values($1,'public','article',$2)
    on conflict(id) do update set data=excluded.data,updated_at=now()`,
    [id,{kind:'article',title:'Isolated live-claims fixture',url:`https://example.org/${id}`,outlet:'Fixture News',publishedAt:'2026-11-07T12:00:00Z',fullTextHash:h,...extra}]);
   return h;
  };
  await put('metadata',null);
  assert.equal((await claimProcessing()).pending,0);
  await assert.rejects(queueArticleClaims('metadata'),/retained article text/);
  await put('archive',text,{sourceSearch:{batchId:'isolated'}});
  assert.equal((await claimProcessing()).pending,0,'archives are not silently swept');
  const h=await put('first',text);
  assert.equal((await claimProcessing()).pending,1);
  assert.equal(await runClaimTick(),true);
  let p=await reportingProvenance({articleId:'first'});
  assert.equal(p.claims.length,2);
  assert.equal(p.counts.independentPaths,null);
  assert.equal(p.counts.minimumAnonymousHumans,null);
  const positive=p.claims.find(c=>c.direction==='positive');
  assert.ok(positive.evidenceId);
  const e=(await admin.query('select * from tripwire_entity_evidence where id=$1',[positive.evidenceId])).rows[0];
  assert.equal(text.slice(e.start,e.end),e.excerpt);
  assert.equal((await admin.query('select authorized from tripwire_entity_captures limit 1')).rows[0].authorized,false);
  const correction=await correctDirection({claimObservationId:positive.id,subject:'Regional commanders',direction:'neutral',rationale:'Analyst correction in isolated fixture'});
  await assert.rejects(correctDirection({claimObservationId:positive.id,subject:'Regional commanders',direction:'negative',rationale:'Stale correction fixture'}),/Direction changed/);
  await queueArticleClaims('first');await runClaimTick();
  p=await reportingProvenance({articleId:'first'});
  assert.equal(p.claims.length,2);
  assert.equal(p.claims.find(c=>c.id===positive.id).direction,'neutral');
  assert.equal(p.claims.find(c=>c.id===positive.id).directionOrigin,'analyst');
  assert.equal((await admin.query('select count(*)::int n from tripwire_provenance_reviews')).rows[0].n,0);
  await put('first',text,{saved:true});
  assert.equal((await claimProcessing()).pending,0,'metadata/flags do not requeue identical text');
  await put('second',text,{outlet:'Second Fixture News',publishedAt:'2026-11-08T12:00:00Z'});
  await runClaimTick();
  assert.equal((await admin.query('select count(*)::int n from tripwire_claim_families')).rows[0].n,2);
  const summary=(await claimCoverageSummaries()).find(c=>c.claimId===positive.claimId);
  assert.equal(summary.attributions,2);assert.equal(summary.lastDate,'2026-11-08');
  const changed=text+'\nThe northern unit improved communications between its defensive positions after the attack.';
  await put('first',changed);await Promise.all([runClaimTick(),runClaimTick()]);
  p=await reportingProvenance({articleId:'first'});
  assert.equal(p.claims.length,3);
  assert.equal(p.claims.find(c=>c.id===positive.id).evidenceVersions.length,2);
  assert.equal(p.claims.find(c=>c.id===positive.id).evidenceScope,'selected');
  const latestVersion=p.claims.find(c=>c.id===positive.id).evidenceVersions.at(-1);
  assert.equal((await reportingProvenance({evidenceId:latestVersion.evidenceId})).claims.some(c=>c.id===positive.id),true);
  assert.equal(p.claims.find(c=>c.id===positive.id).directionCorrectionId,correction.id);
  assert.equal((await admin.query('select count(*)::int n from tripwire_claim_direction_corrections')).rows[0].n,1);
  assert.equal((await admin.query('select count(*)::int n from tripwire_claim_jobs where hash=$1',[h])).rows[0].n,2);
  await put('hidden',text,{hidden:true});assert.equal((await claimProcessing()).pending,0);
  // A missing blob leaves a durable, visible error; explicit retry processes it after restoration.
  const missingBody='The coastal unit strengthened its defensive positions after the northern border attack.';
  await admin.query("insert into tripwire_records(id,owner,kind,data) values('missing','public','article',$1)",[{title:'Missing fixture',fullTextHash:hash(missingBody)}]);
  await runClaimTick();
  assert.equal((await claimProcessing()).failed,1);
  await content(missingBody);await queueArticleClaims('missing');await runClaimTick();
  assert.equal((await claimProcessing()).failed,0);
  // Force a mid-job database failure, after the claim/evidence writes have begun.
  await admin.query(`create function stop_claim_test() returns trigger language plpgsql as $$ begin raise exception 'isolated interruption'; end $$`);
  await admin.query('create trigger stop_claim_test before insert on tripwire_attributed_claims for each row execute function stop_claim_test()');
  const before=(await admin.query('select count(*)::int n from tripwire_records')).rows[0].n;
  const chunksBefore=(await admin.query('select count(*)::int n from tripwire_claim_extraction_chunks')).rows[0].n;
  await put('interrupted','The eastern unit strengthened defensive positions along the coastal border after the attack.');
  await runClaimTick();
  assert.equal((await admin.query('select count(*)::int n from tripwire_records')).rows[0].n,before+1,'no partial claim records survive');
  assert.equal((await admin.query('select count(*)::int n from tripwire_claim_extraction_chunks')).rows[0].n,chunksBefore,'extraction output rolls back with failed evidence writes');
  await admin.query('drop trigger stop_claim_test on tripwire_attributed_claims');
  await queueArticleClaims('interrupted');await runClaimTick();
  assert.equal((await reportingProvenance({articleId:'interrupted'})).claims.length,1);
  // Superseding the body before processing the queued hash must not attach stale text as current coverage.
  await put('supersede','The western unit strengthened defensive positions along the northern border after the attack.');
  await put('supersede','The western unit failed to protect its supply route during the attack.');
  await runClaimTick();await runClaimTick();
  assert.equal((await reportingProvenance({articleId:'supersede'})).claims.length,1);
  assert.equal((await admin.query("select count(*)::int n from tripwire_claim_jobs where article_id='supersede' and status='superseded'")).rows[0].n,1);
  // New short captures are processed even when the best primary body remains unchanged.
  const short='The eastern defenses failed to protect supply routes during the northern border attack.';
  const shortHash=await content(short);
  await put('first',changed,{retainedContent:[{id:'short-capture',bodyHash:shortHash,source:'provided excerpt',capturedAt:new Date().toISOString()}]});
  assert.equal((await claimProcessing()).pending,1);
  await runClaimTick();
  p=await reportingProvenance({articleId:'first'});
  assert.equal(p.claims.length,4);
  const excerpts=await reportingProvenance({articleId:'first',evidenceScope:'retained-excerpt'});
  assert.equal(excerpts.total,1);
  assert.equal(excerpts.claims[0].excerpt,short);
  assert.equal((await reportingProvenance({articleId:'first',evidenceScope:'selected'})).total,3);
  assert.equal((await reportingProvenance({articleId:'first',evidenceScope:'selected',offset:3})).claims.length,0);
  assert.equal((await admin.query("select data->>'fullTextHash' h from tripwire_records where id='first'")).rows[0].h,hash(changed));
  // Explicit metadata-only intake becomes eligible when body text arrives.
  await put('metadata',text);await runClaimTick();
  assert.equal((await reportingProvenance({articleId:'metadata'})).claims.length,2);
  // A workspace dismissal takes precedence over a later public refresh.
  await admin.query("insert into tripwire_records(id,owner,kind,data) values('workspace:blocked','workspace','article',$1)",[{baseId:'blocked',title:'Dismissed fixture',hidden:true}]);
  await put('blocked',text);await runClaimTick();
  assert.equal((await reportingProvenance({articleId:'blocked'})).claims.length,0);
  const family=(await admin.query("select claim_id,proposition from tripwire_claim_families where claim_id=$1",[positive.claimId])).rows[0];
  await admin.query("delete from tripwire_records where data->>'baseId'=$1",[family.claim_id]);
  await put('after-deletion',text);await runClaimTick();
  assert.equal((await admin.query('select count(*)::int n from tripwire_claim_families where proposition=$1',[family.proposition])).rows[0].n,1);
  assert.equal((await admin.query("select count(*)::int n from tripwire_records where data->>'baseId'=$1",[family.claim_id])).rows[0].n,0);
  // A feed snapshot read before an import must not restore its historical body.
  const cleaned='The mountain unit strengthened air defenses after the attack.';
  const unclean=cleaned+'\nThe stale sidebar claimed the ministers failed to protect the supply route.';
  const oldHash=await content(unclean),cleanHash=await content(cleaned);
  await put('snapshot',unclean,{fullTextComplete:true,retainedContent:[{id:'original-copy',source:'paste',bodyHash:oldHash}]});
  const stale=(await recordsFor('workspace')).find(r=>r.id==='snapshot');
  await writeRecord('workspace',{...stale,fullText:cleaned,fullTextHash:cleanHash,fullTextLength:cleaned.length,fullTextComplete:true,
   retainedContent:[...stale.retainedContent,{id:'clean-copy',source:'paste:cleaned',bodyHash:cleanHash}]});
  await writeRecord('workspace',stale,true);
  await writeRecord('workspace',stale,false,true);
  const restored=(await recordsFor('workspace')).find(r=>r.id==='snapshot');
  assert.equal(restored.fullText,cleaned);
  assert.equal(restored.fullTextHash,cleanHash);
  assert.ok(restored.retainedContent.some(c=>c.bodyHash===oldHash),'history remains available');
  for(let n=0;n<20;n++)if(!await runClaimTick())break;
  const snapshot=await reportingProvenance({articleId:'snapshot'});
  const historical=await reportingProvenance({articleId:'snapshot',evidenceScope:'superseded'});
  assert.equal(snapshot.total,2);
  assert.equal(historical.total,1);
  assert.equal(historical.claims[0].excerpt,'The stale sidebar claimed the ministers failed to protect the supply route.');
  assert.equal(snapshot.claims.find(c=>c.evidenceScope==='selected').evidenceVersions.every(v=>v.scope==='selected'),true);
  assert.equal((await claimCoverageSummaries()).filter(c=>snapshot.claims.some(o=>o.claimId===c.claimId)).length,2,'historical families remain in summaries');
  // Equal timestamps across different versions used to collide in React keys.
  await admin.query("update tripwire_claim_jobs set updated_at=now() where article_id='snapshot'");
  const status=await claimProcessing(),row=status.recent.find(r=>r.articleId==='snapshot');
  assert.equal(new Set(status.recent.map(r=>r.articleId)).size,status.recent.length);
  assert.equal(row.bodyCharacters,cleaned.length);
  assert.equal(row.current,true);
  assert.equal(row.status,'complete');
  assert.equal(row.claims,1);
  assert.ok(row.history.some(h=>h.bodyCharacters===unclean.length && h.claims===2 && !h.current));
  assert.equal(new Set([row.jobId,...row.history.map(h=>h.jobId)]).size,1+row.history.length);
  assert.equal((await queueArticleClaims('snapshot')).queued,false,'completed text does not silently rerun');
  assert.equal((await claimProcessing()).pending,0);
  // Different originals with byte-identical text share extraction, never provenance.
  // More than twenty claims also exercises persisted chunk cursors and restart/resume.
  const shared=Array.from({length:45},(_,i)=>`Sector ${i} strengthened defensive positions along the southern frontier after the incident.`).join('\n');
  const rawA=`<article class="original">${shared}</article>`,rawB=`<html><nav>New wrapper</nav><article>${shared}</article></html>`;
  const ha=await storeContent(shared,rawA),hb=await storeContent(shared,rawB);
  assert.notEqual(ha,hb);
  const textHash=createHash('sha256').update(shared).digest('hex');
  // An older policy's result cannot suppress extraction under the current rules.
  await admin.query(`insert into tripwire_claim_extraction_chunks(text_hash,policy,cursor,content_hash,claims,next_cursor)
   values($1,'old-test-policy',0,$2,'[]',0)`,[textHash,ha]);
  const captureA={id:'original-a',bodyHash:ha,source:'publisher html',capturedAt:'2026-11-01T14:01:00Z'};
  const captureB={id:'original-b',bodyHash:hb,source:'provided html',capturedAt:'2026-11-02T15:02:00Z'};
  await put('reuse-a',null,{fullTextHash:ha,byline:'First Reporter',outlet:'First Outlet',retainedContent:[captureA]});
  await put('reuse-b',null,{fullTextHash:hb,byline:'Second Reporter',outlet:'Second Outlet',publishedAt:'2026-11-02T14:00:00Z',retainedContent:[captureB]});
  await Promise.all([runClaimTick(),runClaimTick()]);
  const progress=(await admin.query("select article_id,cursor,status from tripwire_claim_jobs where article_id in ('reuse-a','reuse-b')")).rows;
  assert.ok(progress.some(j=>j.cursor>0 && j.status==='pending'),'chunk checkpoints are durable before completion');
  for(let n=0;n<12;n++)if(!await runClaimTick())break;
  const cached=(await admin.query('select *,xmin::text revision from tripwire_claim_extraction_chunks where text_hash=$1 and policy=$2 order by cursor',[textHash,CLAIM_POLICY])).rows;
  assert.equal(cached.length,3,'identical text across concurrent jobs extracts each chunk once');
  assert.equal(cached[0].cursor,0);
  assert.equal(cached.at(-1).next_cursor,shared.length);
  assert.equal(cached.reduce((n,c)=>n+c.claims.length,0),45,'older-policy cache was ignored');
  for(const c of cached)for(const claim of c.claims)assert.equal(shared.slice(claim.start,claim.end),claim.excerpt);
  const capRows=(await admin.query("select * from tripwire_entity_captures where article_id in ('reuse-a','reuse-b') order by article_id")).rows;
  assert.equal(capRows.length,2);
  assert.notEqual(capRows[0].id,capRows[1].id);
  assert.equal(capRows[0].hash,ha);assert.equal(capRows[1].hash,hb);
  assert.equal(capRows[0].source,captureA.source);assert.equal(capRows[1].source,captureB.source);
  assert.equal(capRows[0].captured_at.toISOString(),new Date(captureA.capturedAt).toISOString());
  assert.equal(capRows[1].captured_at.toISOString(),new Date(captureB.capturedAt).toISOString());
  assert.equal(capRows[1].published_at.toISOString(),'2026-11-02T14:00:00.000Z');
  assert.equal(capRows[0].byline,'First Reporter');assert.equal(capRows[1].byline,'Second Reporter');
  assert.equal(capRows[0].publisher,'First Outlet');assert.equal(capRows[1].publisher,'Second Outlet');
  assert.ok(capRows.every(c=>c.authorized===false));
  assert.equal((await readContent(ha)).raw,rawA);assert.equal((await readContent(hb)).raw,rawB);
  for(const id of ['reuse-a','reuse-b']) {
   const report=await reportingProvenance({articleId:id});
   assert.equal(report.claims.length,30,'provenance is paginated');
   assert.equal((await admin.query("select count(*)::int n from tripwire_attributed_claims where article_id=$1",[id])).rows[0].n,45);
   assert.equal(report.counts.independentPaths,null);
   assert.equal(report.counts.minimumAnonymousHumans,null);
  }
  const sources=(await admin.query("select * from tripwire_source_occurrences where article_id in ('reuse-a','reuse-b')")).rows;
  assert.equal(sources.length,90);assert.equal(new Set(sources.map(s=>s.id)).size,90);
  assert.ok(sources.every(s=>s.anonymity==='Unknown'));
  // Replaying linkage for an additional capture of the SAME raw hash also reuses all chunks.
  const captureC={...captureA,id:'original-c',capturedAt:'2026-11-03T16:03:00Z'};
  await put('reuse-a',null,{fullTextHash:ha,byline:'First Reporter',retainedContent:[captureA,captureC]});
  for(let n=0;n<6;n++)if(!await runClaimTick())break;
  assert.equal((await admin.query("select count(*)::int n from tripwire_entity_captures where article_id='reuse-a'")).rows[0].n,2,'fallback metadata was not substituted for real captures');
  const captureLinks=(await admin.query(`select c.capture_id,count(*)::int n from tripwire_claim_capture_links l
   join tripwire_entity_captures c on c.workspace=l.workspace and c.id=l.capture_id
   where c.article_id='reuse-a' group by c.capture_id`)).rows;
  assert.equal(captureLinks.length,2);
  assert.ok(captureLinks.filter(c=>['original-a','original-c'].includes(c.capture_id)).every(c=>c.n===45));
  assert.deepEqual((await admin.query('select *,xmin::text revision from tripwire_claim_extraction_chunks where text_hash=$1 and policy=$2 order by cursor',[textHash,CLAIM_POLICY])).rows,cached,'replaying capture linkage does not rewrite extraction history');
  assert.equal((await admin.query("select result_count from tripwire_claim_jobs where article_id='reuse-a'")).rows[0].result_count,45,'extra captures do not multiply claim counts');
  // Distinct raw HTML versions within one article still get their own links.
  await put('reuse-a',null,{fullTextHash:ha,retainedContent:[captureA,captureC,{...captureB,id:'original-d'}]});
  for(let n=0;n<6;n++)if(!await runClaimTick())break;
  assert.equal((await admin.query(`select count(*)::int n from tripwire_claim_capture_links l
   join tripwire_entity_captures c on c.workspace=l.workspace and c.id=l.capture_id where c.article_id='reuse-a'`)).rows[0].n,135);
  assert.equal((await admin.query("select count(*)::int n from tripwire_attributed_claims where article_id='reuse-a'")).rows[0].n,45);
  assert.deepEqual((await admin.query('select *,xmin::text revision from tripwire_claim_extraction_chunks where text_hash=$1 and policy=$2 order by cursor',[textHash,CLAIM_POLICY])).rows,cached);
  // One byte of whitespace changes offsets: no normalized-text or proposition reuse.
  const shifted='\n'+shared;
  const shiftedHash=await storeContent(shifted,`<article>${shifted}</article>`);
  await put('reuse-shifted',null,{fullTextHash:shiftedHash});
  for(let n=0;n<6;n++)if(!await runClaimTick())break;
  const shiftedEvidence=(await admin.query(`select e.* from tripwire_entity_evidence e
   join tripwire_entity_captures c on c.workspace=e.workspace and c.id=e.capture_id where c.article_id='reuse-shifted' order by e.start`)).rows;
  assert.equal(shiftedEvidence.length,45);
  assert.equal(shiftedEvidence[0].start,cached[0].claims[0].start+1);
  for(const e of shiftedEvidence)assert.equal(shifted.slice(e.start,e.end),e.excerpt);
  assert.equal((await admin.query('select count(*)::int n from tripwire_claim_extraction_chunks where text_hash=$1 and policy=$2',
   [createHash('sha256').update(shifted).digest('hex'),CLAIM_POLICY])).rows[0].n,3);
  assert.equal((await admin.query('select count(*)::int n from tripwire_provenance_reviews')).rows[0].n,0);
  // Empty results are cached too; whitespace is preserved, not normalized.
  const empty='No qualifying passage.';
  const emptyA=await storeContent(empty,'<p>No qualifying passage.</p>'),emptyB=await storeContent(empty,'<div>No qualifying passage.</div>');
  await put('empty-a',null,{fullTextHash:emptyA});await put('empty-b',null,{fullTextHash:emptyB});
  await Promise.all([runClaimTick(),runClaimTick()]);
  assert.equal((await admin.query("select count(*)::int n from tripwire_claim_jobs where article_id in ('empty-a','empty-b') and status='no-claims'")).rows[0].n,2);
  assert.equal((await admin.query('select count(*)::int n from tripwire_claim_extraction_chunks where text_hash=$1',[createHash('sha256').update(empty).digest('hex')])).rows[0].n,1);
 } finally {
  if(setPath)pool.off('connect',setPath);
  await admin.query('set search_path to public');
  for(const c of pool._clients)if(c!==admin)await c.query('set search_path to public');
  await admin.query(`drop schema if exists "${schema}" cascade`);
  admin.release();await pool.end();
 }
});
