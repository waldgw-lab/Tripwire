import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { pool } from '@workspace/db';
import { writeRecord, recordsFor } from '../artifacts/api-server/src/lib/tripwire-store.ts';
import { groupDetail, editGroup, searchFocusGroups, groupArticlesPage } from '../artifacts/api-server/src/lib/focus-catalog.ts';
import { correctGroupArticles } from '../artifacts/api-server/src/lib/focus-batch.ts';
import { correctFocus, focusState } from '../artifacts/api-server/src/lib/article-focus-feedback.ts';
import { editClaim, correctLink } from '../artifacts/api-server/src/lib/claim-corrections.ts';
import { connectPassage, reportingProvenance, reviewLineage } from '../artifacts/api-server/src/lib/reporting-provenance.ts';
import { claimCoverageSummaries } from '../artifacts/api-server/src/lib/reporting-summary.ts';

test('Claims editing preserves originals and serializes group, claim and association decisions', { timeout: 60000 }, async () => {
  const schema = `claims_edit_${randomUUID().replaceAll('-','')}`;
  pool.options.max = 2;
  pool.options.connectionTimeoutMillis = 5000;
  const admin = await pool.connect();
  const setPath = client => { void client.query(`set search_path to "${schema}"`); };
  try {
    await admin.query(`create schema "${schema}"`);
    await admin.query(`set search_path to "${schema}"`);
    await admin.query('create table tripwire_records (like public.tripwire_records including all)');
    await admin.query('create table tripwire_content (like public.tripwire_content including all)');
    for (const file of ['0000_evidence_entities','0002_reporting_provenance','0003_development_claim_links','0004_live_claims','0005_claim_capture_intake','0006_claim_extraction_reuse']) {
      const migration = await readFile(new URL(`../lib/db/migrations/entities/${file}.sql`, import.meta.url),'utf8');
      for (const part of migration.split('--> statement-breakpoint').filter(p=>p.trim()))
        await admin.query(part.replaceAll('"public".',`"${schema}".`));
    }
    pool.on('connect',setPath);
    admin.release();
    const quote = 'An adviser described the leadership discussion.';
    const a = await writeRecord('workspace',{id:'a',kind:'article',title:'Pete Hegseth faces possible removal',url:'https://example.invalid/a',fullText:quote});
    await writeRecord('workspace',{id:'b',kind:'article',title:'Pentagon leadership — Pete Hegseth',url:'https://example.invalid/b',fullText:quote});
    await writeRecord('workspace',{id:'other',kind:'article',title:'Senator supports gun control on public health grounds',url:'https://example.invalid/other'});
    const home = (await focusState('workspace','a')).effective.topicId;
    const group = await groupDetail('workspace',home);
    assert.equal(group.count,2);
    const input = {mode:'manual',categoryId:'oversight-accountability',topicTitle:'Leadership oversight',expectedToken:group.token,
      confirmed:true,reason:'Keep this reporting together',requestId:randomUUID()};
    const saved = await editGroup('workspace',home,input);
    assert.equal(saved.count,2);
    assert.equal(saved.effective.categoryId,input.categoryId);
    assert.equal((await focusState('workspace','a')).effective.topicTitle,input.topicTitle);
    assert.equal((await focusState('workspace','b')).effective.topicTitle,input.topicTitle);
    assert.notEqual((await focusState('workspace','other')).effective.topicTitle,input.topicTitle);
    assert.equal((await recordsFor('workspace',false)).find(r=>r.id==='a').sharedFocus.topicTitle,input.topicTitle);
    await assert.rejects(editGroup('workspace',home,{...input,requestId:randomUUID()}),e=>e.status===409);
    await assert.rejects(editGroup('workspace',home,{...input,confirmed:false}),e=>e.status===400);
    await editGroup('workspace',home,input);
    assert.equal((await groupDetail('workspace',home)).history.length,1);
    const privateMove = await correctFocus('workspace','a',{mode:'manual',categoryId:'courts-legal',topicTitle:'Separate court story',expectedRevision:0,requestId:randomUUID()});
    assert.equal(privateMove.focusRevision,1);
    await assert.rejects(editGroup('workspace',home,{...input,expectedToken:saved.token,requestId:randomUUID()}),e=>e.status===409);
    const remaining = await groupDetail('workspace',home);
    assert.equal(remaining.count,1);
    await editGroup('workspace',home,{mode:'auto',expectedToken:remaining.token,confirmed:true,reason:'Restore the underlying group',requestId:randomUUID()});
    assert.equal((await focusState('workspace','b')).effective.topicTitle,'Pentagon leadership — Pete Hegseth');
    assert.equal((await focusState('workspace','a')).effective.topicTitle,'Separate court story');
    const search = await searchFocusGroups('workspace','court');
    assert.equal(search.groups.length,1);
    assert.equal(search.groups[0].topicTitle,'Separate court story');
    assert.ok((await searchFocusGroups('workspace')).groups.length<=25);
    // Select across bounded pages, without modifying unchecked articles or shared labels.
    const template=(await pool.query("select data from tripwire_records where id='workspace:b'")).rows[0].data;
    await pool.query(`insert into tripwire_records(id,owner,kind,data)
      select 'workspace:batch-'||g,'workspace','article',$1::jsonb || jsonb_build_object('baseId','batch-'||g)
      from generate_series(1,52) g`,[JSON.stringify({...template,focusOverride:null,focusRevision:0})]);
    const firstPage=await groupArticlesPage('workspace',home);
    const secondPage=await groupArticlesPage('workspace',home,50);
    assert.equal(firstPage.articles.length,50); assert.equal(firstPage.hasMore,true);
    assert.equal(secondPage.hasMore,false); assert.equal(secondPage.token,firstPage.token);
    const selected=['batch-1',secondPage.articles.find(a=>a.id!=='b').id];
    const batch={articleIds:selected,mode:'manual',expectedToken:firstPage.token,categoryId:'courts-legal',
      topicTitle:'Reviewed subset',reason:'Review only the checked stories',requestId:randomUUID()};
    const changedBatch=await correctGroupArticles('workspace',home,batch);
    assert.equal(changedBatch.updated,2);
    for(const id of selected) assert.equal((await focusState('workspace',id)).effective.topicTitle,'Reviewed subset');
    assert.equal((await focusState('workspace','b')).effective.topicTitle,'Pentagon leadership — Pete Hegseth');
    assert.deepEqual(await correctGroupArticles('workspace',home,batch),changedBatch,'exact retry is idempotent');
    await assert.rejects(correctGroupArticles('workspace',home,{...batch,articleIds:['b'],requestId:randomUUID()}),e=>e.status===409);
    await assert.rejects(correctGroupArticles('workspace',home,{...batch,articleIds:['b']}),e=>e.status===409);
    const destination=await groupDetail('workspace',changedBatch.focus.topicId);
    const resetBatch={...batch,mode:'auto',expectedToken:destination.token,requestId:randomUUID()};
    await correctGroupArticles('workspace',destination.effective.topicId,resetBatch);
    assert.equal((await focusState('workspace',selected[0])).mode,'auto');
    assert.deepEqual(await correctGroupArticles('workspace',destination.effective.topicId,resetBatch),
      {updated:2,articleIds:selected,focus:null},'retry works after the source group becomes empty');
    const fresh=await groupDetail('workspace',home);
    const beforeInvalid=await focusState('workspace','b');
    await assert.rejects(correctGroupArticles('workspace',home,{...batch,expectedToken:fresh.token,articleIds:['b','other'],requestId:randomUUID()}),e=>e.status===409);
    assert.equal((await focusState('workspace','b')).revision,beforeInvalid.revision,'no partial write on an invalid member');
    await assert.rejects(correctGroupArticles('workspace',home,{...batch,articleIds:['b','b']}),e=>e.status===400);
    const batchRaces=await Promise.allSettled([['batch-1'],['batch-2']].map(articleIds=>correctGroupArticles('workspace',home,{
      ...batch,expectedToken:fresh.token,articleIds,requestId:randomUUID(),
    })));
    assert.equal(batchRaces.filter(r=>r.status==='fulfilled').length,1);
    assert.equal(batchRaces.find(r=>r.status==='rejected').reason.status,409);
    const c1=await writeRecord('workspace',{id:'c1',kind:'claim',title:'Leadership was discussed',summary:'Initial analyst note'});
    await writeRecord('workspace',{id:'c2',kind:'claim',title:'A separate proposition'});
    const decision={record:{...c1,title:'Corrected shared proposition',summary:'',topic:'Analyst tag'},expectedRevision:0,rationale:'Correct the analyst wording',requestId:randomUUID()};
    const corrected=await editClaim('workspace','c1',decision);
    assert.equal(corrected.claimRevision,1);
    assert.equal(corrected.summary,'');
    await editClaim('workspace','c1',decision);
    const races=await Promise.allSettled(['First writer','Second writer'].map(title=>editClaim('workspace','c1',{
      record:{...corrected,title},expectedRevision:1,rationale:'A competing metadata change',requestId:randomUUID(),
    })));
    assert.equal(races.filter(r=>r.status==='fulfilled').length,1);
    assert.equal(races.find(r=>r.status==='rejected').reason.status,409);
    await pool.query(`insert into tripwire_entity_captures(workspace,id,article_id,capture_id,hash,source,captured_at,complete,authorized)
      values('workspace','capture-a','a','paste-a',$1,'paste',now(),false,true)`,[a.fullTextHash]);
    const connected=await connectPassage({articleId:'a',claimId:'c1',captureId:'capture-a',excerpt:quote,start:0,end:quote.length,
      descriptor:'An adviser',proposition:'Leadership was discussed',anonymity:'Unnamed'});
    const observation=(await reportingProvenance({claimId:'c1'})).claims[0];
    assert.ok(observation);
    const original=(await pool.query("select * from tripwire_attributed_claims where id=$1",[observation.id])).rows[0];
    const evidence=(await pool.query("select * from tripwire_entity_evidence where id=$1",[observation.evidenceId])).rows[0];
    const initialReview=await reviewLineage({claimObservationId:observation.id,relation:'new-reporting',evidenceId:observation.evidenceId,
      pathKey:'reviewed-original-path',rationale:'Analyst reviewed the exact retained passage'});
    assert.equal((await reportingProvenance({claimId:'c1'})).counts.independentPaths,1);
    const link={observationId:observation.id,targetClaimId:'c2',supersedesId:null,rationale:'This passage supports the other proposition',requestId:randomUUID()};
    const moved=await correctLink(link);
    await correctLink(link);
    await assert.rejects(correctLink({...link,targetClaimId:null,requestId:randomUUID()}),e=>e.status===409);
    const old=(await reportingProvenance({claimId:'c1'})).claims[0];
    assert.equal(old.linkExcluded,true);
    assert.equal(old.originalClaimId,'c1');
    const active=(await reportingProvenance({claimId:'c2'})).claims[0];
    assert.equal(active.articleId,'a'); assert.equal(active.excerpt,quote); assert.equal(active.start,0);
    assert.equal(active.linkExcluded,false);
    const oldCoverage = await reportingProvenance({claimId:'c1'});
    assert.equal(oldCoverage.counts.articles,0);
    assert.equal(oldCoverage.counts.occurrences,0);
    assert.equal(oldCoverage.counts.minimumAnonymousHumans,null);
    assert.equal(oldCoverage.counts.historicalPassages,1);
    assert.equal(oldCoverage.claims[0].excerpt,quote);
    assert.ok(oldCoverage.sources.length > 0,'historical source context remains available without inflating totals');
    assert.equal((await reportingProvenance({claimId:'c2'})).counts.independentPaths,null,'prior review must not transfer independence to the corrected claim');
    await reviewLineage({claimObservationId:observation.id,relation:'new-reporting',evidenceId:observation.evidenceId,supersedesId:initialReview.id,
      pathKey:'reviewed-new-path',rationale:'Explicit new assessment for the corrected association'});
    assert.equal((await reportingProvenance({claimId:'c2'})).counts.independentPaths,1);
    let summaries=await claimCoverageSummaries();
    assert.deepEqual(summaries.find(s=>s.claimId==='c1').articleIds,[]);
    assert.deepEqual(summaries.find(s=>s.claimId==='c2').articleIds,['a']);
    const excluded=await correctLink({...link,targetClaimId:null,supersedesId:moved.id,requestId:randomUUID()});
    assert.equal(excluded.targetClaimId,null);
    for (const claimId of ['c1','c2']) {
      const excludedCoverage=await reportingProvenance({claimId});
      assert.equal(excludedCoverage.counts.articles,0);
      assert.equal(excludedCoverage.counts.occurrences,0);
      assert.equal(excludedCoverage.counts.historicalPassages,1);
      assert.equal(excludedCoverage.claims[0].excerpt,quote);
      assert.equal(excludedCoverage.claims[0].linkExcluded,true);
    }
    summaries=await claimCoverageSummaries();
    assert.deepEqual(summaries.find(s=>s.claimId==='c2').articleIds,[]);
    await correctLink({...link,targetClaimId:'c1',supersedesId:excluded.id,requestId:randomUUID()});
    assert.equal((await reportingProvenance({claimId:'c1'})).claims[0].linkHistory.length,3);
    assert.equal((await reportingProvenance({claimId:'c1'})).counts.independentPaths,null,'restoring an association also requires a fresh sourcing assessment');
    assert.deepEqual((await pool.query("select * from tripwire_attributed_claims where id=$1",[observation.id])).rows[0],original);
    assert.deepEqual((await pool.query("select * from tripwire_entity_evidence where id=$1",[observation.evidenceId])).rows[0],evidence);
    assert.equal((await pool.query('select text from tripwire_content where hash=$1',[a.fullTextHash])).rows[0].text,quote);
    assert.ok(connected.id);
  } finally {
    pool.off('connect',setPath);
    // Test uses a private schema, never synthetic shared reporting.
    const client=await pool.connect();
    await client.query('set search_path to public');
    await client.query(`drop schema if exists "${schema}" cascade`);
    client.release();
    await pool.end();
  }
});
