import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pool } from '@workspace/db';
import { corpusPlan } from '../artifacts/api-server/src/lib/source-search-corpus.ts';
import { sourceUrl, exactPassage, grammaticalMinimum, conservativeMinimum } from '../artifacts/api-server/src/lib/source-search-rules.ts';
import { runBackfill, rollbackBatch, BatchWriter } from '../artifacts/api-server/src/lib/source-search-backfill.ts';
import { reportingProvenance, connectPassage, reviewLineage } from '../artifacts/api-server/src/lib/reporting-provenance.ts';
import { summariseClaimCoverage } from '../artifacts/api-server/src/lib/reporting-summary.ts';

test('claim previews count all article attributions and real date ranges without legacy double counting', () => {
  const records = [
    {id:'claim',data:{kind:'claim',observations:[{articleId:'a',observedAt:'2026-09-01'},{articleId:'legacy',observedAt:'2026-08-01'}]}},
    {id:'empty',data:{kind:'claim',createdAt:'2026-11-01'}},
    {id:'unknown',data:{kind:'claim'}},
    {id:'a',data:{kind:'article',publishedAt:'2026-08-12T05:00:00-04:00'}},
    {id:'legacy',data:{kind:'article'}},
    {id:'workspace:b',data:{kind:'article',baseId:'b',sourceSearch:{date:'46244'}}},
    {id:'hidden',data:{kind:'article',hidden:true,publishedAt:'2026-01-01'}},
    {id:'undated',data:{kind:'article',createdAt:'2026-11-01',publishedAt:'not-a-date'}},
  ];
  const rows=[...Array.from({length:35},()=>({claim_id:'claim',article_id:'a'})),
    {claim_id:'claim',article_id:'b'},{claim_id:'claim',article_id:'hidden'},{claim_id:'claim',article_id:'missing'},
    {claim_id:'unknown',article_id:'undated'}];
  assert.deepEqual(summariseClaimCoverage(records,rows),[
    {claimId:'claim',attributions:37,firstDate:'2026-08-01',lastDate:'2026-08-12'},
    {claimId:'empty',attributions:0,firstDate:null,lastDate:null},
    {claimId:'unknown',attributions:1,firstDate:null,lastDate:null},
  ]);
});

test('source counts preserve plural, alias and overlap uncertainty; exact UTF-16 offsets', () => {
  assert.equal(grammaticalMinimum('two senior U.S. officials'), 2);
  assert.equal(grammaticalMinimum('officials briefed on the matter'), 2);
  assert.equal(grammaticalMinimum('one of the officials'), null);
  assert.equal(grammaticalMinimum('another official'), null);
  assert.equal(grammaticalMinimum('a U.S. official'), 1);
  assert.equal(conservativeMinimum([{anonymity:'Unnamed',minimum_humans:2},{anonymity:'Unnamed',minimum_humans:3}]),3);
  assert.equal(conservativeMinimum([{anonymity:'Unnamed',minimum_humans:null}]),null);
  assert.deepEqual(exactPassage('😀 Two officials said this.', 'Two officials'),{start:3,end:16,excerpt:'Two officials'});
  assert.equal(exactPassage('A quote. A quote.','A quote.'),null);
  assert.equal(sourceUrl('javascript:alert(1)'),null);
  assert.equal(sourceUrl('https://www.nytimes.com/a?utm_source=test'),'https://nytimes.com/a');
});

const url='https://www.nytimes.com/2026/08/10/us/politics/fixture-source.html';
const title='Isolated reporting provenance fixture';
const descriptor='two senior U.S. officials';
const text=`😀 The decision was made, according to ${descriptor}. One of the officials added a detail.`;
const row=(row,data)=>({row,data});
const sheet=rows=>({headers:{},rows});
const corpus=()=>({
 packageHash:'isolated-test',manifest:[],documents:{'NYT_Coverage_fixture.docx':[title,'The New York Times Fixture Reporter','Aug 10 • 02:00 PM',url,text]},
 sheets:{
  NYT:sheet([row(2,{'Document ID':'DOC-1',URL:url,Title:title,'Source Name':'The New York Times','Author Name':'Fixture Reporter',
    'Author Group':'Fixture Reporter, Fixture Contributor',Date:'46244',Time:'0.5','Minimum Unique Unnamed Human Sources':'2','Provisional Unnamed Source Records':'3'}),
    row(3,{'Document ID':'DOC-2',URL:url.replace('fixture-source','second-fixture'),Title:'A separate fixture article','Source Name':'The New York Times'})]),
  'NYT Schmitt':sheet([row(2,{'Document ID':'"DOC-1"',URL:url,Title:title,'Source Name':'The New York Times'})]),
  Sources:sheet([row(2,{'Document ID':'DOC-1','Source ID':'REUSED','Exact Source Descriptor':descriptor,'Named/Unnamed':'Unnamed','Minimum People Represented':'2'}),
    row(3,{'Document ID':'DOC-1','Source ID':'SECOND','Exact Source Descriptor':'One of the officials','Named/Unnamed':'Unnamed'}),
    row(4,{'Document ID':'MISSING','Source ID':'REUSED','Exact Source Descriptor':'not retained'}),
    row(5,{'Document ID':'DOC-2','Source ID':'REUSED','Exact Source Descriptor':'a different source occurrence','Named/Unnamed':'Unnamed'})]),
  Claims:sheet([row(2,{'Document ID':'DOC-1','Claim ID':'C1','Claim Family ID':'F1','Normalized Claim':'The decision was made','Source ID':'REUSED;SECOND','Event Group ID':'E1'}),
    row(3,{'Document ID':'DOC-1','Claim ID':'C2','Claim Family ID':'F2','Normalized Claim':'A related but different proposition','Source ID':'REUSED'})]),
  Source_Quotes:sheet([row(2,{'Document ID':'DOC-1','Source ID':'REUSED','Quote ID':'Q1','Exact Text':descriptor}),
    row(3,{'Document ID':'DOC-1','Quote ID':'Q2','Exact Text':'An unsupported quotation'})]),
  'Document Journalists':sheet([row(2,{'Document ID':'DOC-1','Journalist Name':'Fixture Reporter','Contribution Type':'Byline','Primary Byline Flag':'Yes'}),
    row(3,{'Document ID':'DOC-1','Journalist Name':'Fixture Contributor','Contribution Type':'Contributed reporting','Contributor Flag':'Yes'})]),
  Source_Matches:sheet([row(2,{'Document ID':'DOC-1','Related Document ID':'DOC-1','Source ID A':'REUSED','Source ID B':'SECOND','Match ID':'M1','Relationship Assessment':'Possible overlap','Commonalities':'Same briefing','Conflicts / Reasons Not To Merge':'Unresolved alias'})]),
  Institutional_Responses:sheet([row(2,{'Document ID':'DOC-1','Response Type':'No comment','Response Summary':'No comment'})]),
  Reporting_Evidence:sheet([row(2,{'Document ID':'DOC-1','Evidence Type':'Prior media reporting','Original/Secondary':'Secondary'})]),
  Framing:sheet([row(2,{'Document ID':'DOC-1','Framing Assessment':'Supplied interpretation only'})])
 }
});

test('corpus plan deduplicates sheets, rejects malformed rows and does not promote synthesis', () => {
  const input=corpus();
  input.sheets.NYT.rows.push(row(3,{'Document ID':'invalid',URL:'not a url',Title:'Bad','Source Name':'The New York Times'}));
  const plan=corpusPlan(input);
  assert.equal(plan.articles.length,2);
  assert.equal(plan.dispositions.filter(r=>r.status==='duplicate-url').length,1);
  assert.equal(plan.dispositions.filter(r=>r.status==='quarantined').length,1);
  assert.equal(plan.articles[0].segments[0].complete,false);
});

test('isolated database: actual apply/rerun/rollback, public overrides, exact evidence and corrections', async t=>{
 const schema=`source_test_${crypto.randomUUID().replaceAll('-','')}`;
 // Every database fixture lives in a separate PostgreSQL schema, never the shared feed.
 const admin=await pool.connect();
 try {
  await admin.query(`create schema "${schema}"`);
  await admin.query(`set search_path to "${schema}"`);
  await admin.query('create table tripwire_records (like public.tripwire_records including all)');
  await admin.query('create table tripwire_content (like public.tripwire_content including all)');
  for(const file of ['0000_evidence_entities','0002_reporting_provenance','0003_development_claim_links','0004_live_claims','0005_claim_capture_intake']){
   const sql=await readFile(new URL(`../lib/db/migrations/entities/${file}.sql`,import.meta.url),'utf8');
   for(const part of sql.split('--> statement-breakpoint').filter(p=>p.trim())) await admin.query(part.replaceAll('"public".',`"${schema}".`));
  }
  const setPath=client=>{void client.query(`set search_path to "${schema}"`);};
  pool.on('connect',setPath);
  // The idle pool connection also needs the isolated path.
  admin.release();
  const conn=await pool.connect();await conn.query(`set search_path to "${schema}"`);conn.release();
  try {
   const input=corpus();
   const legacy={kind:'claim',baseId:'legacy-claim',title:'The decision was made',observations:[{id:'old-observation',articleId:'existing',verified:true,evidence:'Legacy supplied assertion',stage:'origin',observedAt:'2026-08-10'}]};
   await pool.query("insert into tripwire_records(id,owner,kind,data) values('workspace:legacy-claim','workspace','claim',$1)",[legacy]);
   await pool.query(`insert into tripwire_records(id,owner,kind,data) values('existing','public','article',$1)`,[{kind:'article',title:'Earlier publisher headline',url,outlet:'The New York Times',publishedAt:'2026-08-10T18:30:00Z',publicationSource:'publisher'}]);
   const dry=await runBackfill(input,false);
   assert.equal(dry.enriched,1);
   assert.equal((await pool.query('select count(*)::int n from tripwire_source_batches')).rows[0].n,0);
   const realPut=BatchWriter.prototype.put;
   let writes=0;
   BatchWriter.prototype.put=async function(...args){if(++writes===2)throw new Error('Simulated interruption');return realPut.apply(this,args);};
   try {await assert.rejects(runBackfill(input,true),/Simulated interruption/);} finally {BatchWriter.prototype.put=realPut;}
   assert.equal((await pool.query('select count(*)::int n from tripwire_source_batches')).rows[0].n,0);
   assert.equal((await pool.query("select count(*)::int n from tripwire_records where owner='workspace' and kind='article'")).rows[0].n,0);
   const applied=await runBackfill(input,true);
   assert.equal(applied.created,1);assert.equal(applied.enriched,1);
   assert.equal(applied.inputRowCount,17);
   assert.equal(applied.monitoringAuthorizationUnchanged,true);
   assert.equal(applied.reconciledLegacyClaims.length,1);
   assert.deepEqual((await pool.query("select data from tripwire_records where id='workspace:legacy-claim'")).rows[0].data,legacy);
   const article=(await pool.query("select * from tripwire_records where id='workspace:existing'")).rows[0];
   assert.equal(article.data.baseId,'existing');
   assert.equal(article.data.title,'Earlier publisher headline');
   assert.equal(article.data.publishedAt,'2026-08-10T18:30:00Z');
   assert.equal(article.data.credits.find(c=>c.name==='Fixture Contributor').role,'reporting');
   assert.equal(article.data.fullTextComplete,false);
   const retained=(await pool.query('select * from tripwire_content where hash=$1',[article.data.fullTextHash])).rows[0];
   assert.equal(retained.text,text);assert.ok(retained.raw.includes('Aug 10'));
   const rerun=await runBackfill(input,true);
   assert.equal(rerun.mode,'no-op');
   const view=await reportingProvenance({articleId:'existing'});
   assert.equal(view.claims.length,2);
   assert.notEqual(view.claims[0].familyId,view.claims[1].familyId);
   assert.equal(view.counts.minimumAnonymousHumans,null);
   assert.equal(view.counts.independentPaths,null);
   assert.equal(view.counts.provisionalSourceRecords,3);
   const reused=(await pool.query("select id,article_id from tripwire_source_occurrences where external_id='REUSED'")).rows;
   assert.equal(reused.length,2);assert.notEqual(reused[0].id,reused[1].id);assert.notEqual(reused[0].article_id,reused[1].article_id);
   const joint=view.claims.find(c=>c.sourceIds.length===2);
   assert.ok(joint);
   const quote=view.context.find(c=>c.data['Quote ID']==='Q1');
   const unmatched=view.context.find(c=>c.data['Quote ID']==='Q2');
   assert.ok(quote.resolution.evidenceId);assert.equal(unmatched.resolution.evidenceId,null);
   const c=await pool.connect();
   assert.equal((await rollbackBatch(c,applied.batch,false)).committed,false);c.release();
   await pool.query("update tripwire_records set data=data || '{\"flagged\":true}' where id='workspace:existing'");
   const blocked=await pool.connect();
   await assert.rejects(rollbackBatch(blocked,applied.batch,true),/subsequent edit/);blocked.release();
   assert.equal((await pool.query('select status from tripwire_source_batches')).rows[0].status,'applied');
   // Restore this test-only edit to the journaled post-image, then test successful rollback.
   await pool.query("update tripwire_records set data=$1 where id='workspace:existing'",[article.data]);
   const rollback=await pool.connect();await rollbackBatch(rollback,applied.batch,true);rollback.release();
   assert.equal((await pool.query("select count(*)::int n from tripwire_records where kind='article'")).rows[0].n,1);
   assert.equal((await pool.query('select count(*)::int n from tripwire_attributed_claims')).rows[0].n,0);
   // A changed input gives a new explicitly versioned batch, preserving the rollback journal.
   input.packageHash='isolated-second-run';
   await runBackfill(input,true);
   const linked=await reportingProvenance({articleId:'existing'}), claim=linked.claims[0], source=linked.sources[0];
   const cap=(await pool.query('select * from tripwire_entity_captures limit 1')).rows[0];
   await assert.rejects(connectPassage({articleId:'existing',claimId:claim.claimId,captureId:cap.id,excerpt:'wrong',start:0,end:5,descriptor,proposition:'A proposition',anonymity:'Unnamed'}),/Exact passage/);
   const connected=await connectPassage({articleId:'existing',claimId:claim.claimId,captureId:cap.id,excerpt:text,start:0,end:text.length,descriptor,proposition:'The decision was made',anonymity:'Unnamed'});
   const exact=(await reportingProvenance({articleId:'existing'})).claims.find(c=>c.id===connected.id);
   assert.equal(exact.excerpt,text);
   await pool.query(`insert into tripwire_entity_developments(workspace,id,event_key,claim_key,title,explanation,disposition,entity_ids,policy_version)
     values('workspace','fixture-dev','fixture-event','legacy-key','Fixture development','Isolated fixture','Review','{}','fixture')`);
   await pool.query("insert into tripwire_entity_observations(workspace,id,development_id,evidence_id,novelty) values('workspace','fixture-obs','fixture-dev',$1,'unknown')",[exact.evidenceId]);
   const shared=await connectPassage({articleId:'existing',claimId:claim.claimId,captureId:cap.id,excerpt:text,start:0,end:text.length,descriptor,
     proposition:'The decision was made',anonymity:'Unnamed',evidenceId:exact.evidenceId,developmentId:'fixture-dev'});
   assert.equal((await pool.query("select evidence_id from tripwire_development_claim_links where claim_id=$1",[shared.id])).rows[0].evidence_id,exact.evidenceId);
   assert.equal((await reportingProvenance({articleId:'existing'})).counts.minimumAnonymousHumans,2);
   await assert.rejects(reviewLineage({claimObservationId:connected.id,relation:'same-environment',rationale:'Wrong relation'}),/appropriate/);
   const assessment=await reviewLineage({claimObservationId:connected.id,relation:'new-reporting',rationale:'Separate observable path supported by the retained passage',evidenceId:exact.evidenceId,pathKey:'fixture-path'});
   assert.equal((await reportingProvenance({articleId:'existing'})).counts.independentPaths,1);
   await assert.rejects(reviewLineage({claimObservationId:connected.id,relation:'unknown',rationale:'Stale correction'}),/Review changed/);
   await reviewLineage({claimObservationId:connected.id,relation:'opinion-propagation',rationale:'Correction: this merely repeats another report',supersedesId:assessment.id});
   const corrected=await reportingProvenance({articleId:'existing'});
   assert.equal(corrected.counts.independentPaths,null);
   assert.equal(corrected.claims.find(c=>c.id===connected.id).reviews.length,2);
   await assert.rejects(reviewLineage({claimObservationId:connected.id,relation:'derivative',rationale:'Cannot conflate related propositions',supersedesId:corrected.claims.find(c=>c.id===connected.id).reviews.at(-1).id,
    targetClaimId:linked.claims.find(c=>c.familyId!==claim.familyId).id}),/same proposition/);
   const match=linked.matches[0];
   await reviewLineage({sourceMatchId:match.id,relation:'unresolved',rationale:'Could be a shared briefing, not proof of identity'});
   assert.equal((await reportingProvenance({articleId:'existing'})).matches[0].reviews.length,1);
   const editor=await pool.connect();
   await editor.query('BEGIN');
   await editor.query("select pg_advisory_xact_lock(hashtext('articles:workspace'))");
   await editor.query("update tripwire_records set data=data || '{\"flagged\":true}' where id='workspace:existing'");
   const concurrent=runBackfill(input,true);
   await new Promise(resolve=>setTimeout(resolve,25));
   await editor.query('COMMIT');editor.release();
   assert.equal((await concurrent).mode,'no-op');
   assert.equal((await pool.query("select data->>'flagged' flagged from tripwire_records where id='workspace:existing'")).rows[0].flagged,'true');
   await pool.query("update tripwire_records set data=data || '{\"hidden\":true}' where id='workspace:existing'");
   const hidden=await runBackfill({...input,packageHash:'hidden-input'},true);
   assert.ok(hidden.quarantined.some(q=>q.reason.includes('Dismissed')));
   assert.equal((await pool.query("select data->>'hidden' hidden from tripwire_records where id='workspace:existing'")).rows[0].hidden,'true');
   assert.equal((await pool.query("select data->>'flagged' flagged from tripwire_records where owner='public'")).rows[0].flagged,null);
  } finally {
   pool.off('connect',setPath);
   await pool.query('set search_path to public');
  }
 } finally {
  // A separate connection avoids any fixture path dependency during cleanup.
  const cleanup=await pool.connect();
  await cleanup.query(`drop schema if exists "${schema}" cascade`);cleanup.release();
  await pool.end();
 }
});
