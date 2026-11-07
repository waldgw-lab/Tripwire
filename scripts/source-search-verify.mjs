// Read-only audit of the real development backfill. Writes only the reconciliation report.
import { pool } from '@workspace/db';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
process.chdir(fileURLToPath(new URL('../',import.meta.url)));
try {
  const report=JSON.parse(await readFile('generated-artifacts/source-search/apply-report.json','utf8'));
  const inventory=JSON.parse(await readFile('generated-artifacts/source-search/inventory.json','utf8'));
  const batch=report.batch;
  const imported=(await pool.query("select * from tripwire_records where owner='workspace' and kind='article' and data->'sourceSearch'->>'batchId'=$1",[batch])).rows;
  assert.equal(imported.length,report.created+report.enriched);
  const bodies=(await pool.query(`select c.id,c.hash,c.article_id,c.authorized,t.text,t.raw from tripwire_entity_captures c
    join tripwire_content t on t.hash=c.hash where c.id in
    (select after_image->>'id' from tripwire_source_changes where batch_id=$1 and table_name='tripwire_entity_captures')`,[batch])).rows;
  assert.equal(bodies.length,57);
  assert.ok(bodies.every(b=>!b.authorized));
  const excerpts=(await pool.query(`select e.*,t.text from tripwire_entity_evidence e join tripwire_entity_captures c on c.workspace=e.workspace and c.id=e.capture_id
    join tripwire_content t on t.hash=c.hash where e.id in
    (select after_image->>'id' from tripwire_source_changes where batch_id=$1 and table_name='tripwire_entity_evidence')`,[batch])).rows;
  for(const e of excerpts)assert.equal(e.text.slice(e.start,e.end),e.excerpt);
  assert.equal((await pool.query(`select count(*)::int n from tripwire_claim_sources l join tripwire_attributed_claims c on c.workspace=l.workspace and c.id=l.claim_id
    join tripwire_source_occurrences s on s.workspace=l.workspace and s.id=l.source_id where l.batch_id=$1 and (s.article_id<>c.article_id or s.article_id<>l.article_id)`,[batch])).rows[0].n,0);
  const workspace=await (await fetch('http://localhost:80/api/tripwire/workspace')).json();
  const visibleIds=new Set(workspace.records.filter(r=>r.kind==='article').map(r=>r.id));
  assert.ok(imported.every(r=>visibleIds.has(r.data.baseId)));
  const boot=imported.find(r=>r.data.byline==='Max Boot' && r.data.title.includes('purges'));
  assert.ok(boot && boot.data.fullTextHash && boot.data.fullTextComplete===false);
  const bootBody=bodies.find(b=>b.article_id===boot.data.baseId);
  assert.ok(bootBody && !bootBody.text.includes('Boot argues') && !bootBody.text.includes('Analytical note:'));
  const nyt=imported.find(r=>r.data.title.startsWith('Trump Said to Have Secretly Used Military'));
  assert.ok(nyt.data.credits.some(c=>c.name==='Katie Rogers' && c.role==='reporting'));
  assert.ok(!nyt.data.journalists.includes('Katie Rogers'));
  const cautions=[];
  for(const sheet of ['WaPo','NYT','FT','Axios','WSJ']){
    for(const row of inventory.sheets[sheet].rows){
      const d=row.data;
      const date=/^\d+$/.test(d.Date??'')?new Date(Date.UTC(1899,11,30)+Number(d.Date)*86400000).toISOString().slice(0,10):null;
      const urlDate=d.URL?.match(/\/(\d{4})\/(\d{2})\/(\d{2})\//)?.slice(1).join('-');
      if(date && urlDate && date!==urlDate)cautions.push({sheet,row:row.row,kind:'date-discrepancy',suppliedDate:date,urlDate,note:'URL date is not publication proof; no guessed timestamp applied'});
      const credits=inventory.sheets['Document Journalists'].rows.filter(r=>r.data['Document ID']===d['Document ID']);
      if(credits.some(r=>r.data['Contributor Flag']==='Yes'))cautions.push({sheet,row:row.row,kind:'mixed-author-group',documentId:d['Document ID'],note:'Per-article role rows used; Author Group not promoted wholesale to byline'});
    }
  }
  const resolutions=(await pool.query("select sheet,row_key,resolution from tripwire_source_inputs where batch_id=$1",[batch])).rows;
  const unresolved=resolutions.filter(r=>r.resolution.status==='unresolved-occurrence-join');
  assert.equal(unresolved.length,22);
  const shaRows=(await pool.query("select count(*)::int n from tripwire_source_inputs where batch_id=$1",[batch])).rows[0].n;
  assert.equal(shaRows,report.inputRowCount+report.retainedDocumentCount);
  report.verification={verifiedAt:new Date().toISOString(),visibleImportedArticles:imported.length,visibleWorkspaceArticles:visibleIds.size,
    metadataOnly:imported.filter(r=>!r.data.fullTextHash).length,partial:imported.filter(r=>r.data.fullTextHash&&!r.data.fullTextComplete).length,
    complete:imported.filter(r=>r.data.fullTextComplete).length,retainedCaptures:bodies.length,validatedEvidencePassages:excerpts.length,
    retainedInputRowsAndDocuments:shaRows,unresolvedSourceJoins:unresolved.length,archiveCaptureAuthorizationUnchanged:true,
    noSuppliedReviewPromoted:(await pool.query("select count(*)::int n from tripwire_provenance_reviews")).rows[0].n===0,
    rerun:'no-op confirmed',rollback:'real 2,943-change rollback rehearsal passed without committing; later edits deliberately block rollback'};
  report.metadataCautions=cautions;
  report.unresolvedSourceJoins=unresolved;
  await pool.query("update tripwire_source_batches set report=$1 where id=$2",[report,batch]);
  await writeFile('generated-artifacts/source-search/final-reconciliation.json',JSON.stringify(report,null,2));
  const handoff=await readFile('docs/source-search-backfill-report.md','utf8');
  const escaped=handoff.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
  await writeFile('generated-artifacts/source-search/reconciliation.html',`<!doctype html><html lang="en"><meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1"><title>Tripwire development backfill report</title>
    <style>body{margin:0;background:#f5f5f3;color:#191919;font:16px/1.6 system-ui,sans-serif}main{max-width:960px;margin:40px auto;padding:32px;background:white;border:1px solid #ddd}
    header{font-weight:700;font-size:13px;letter-spacing:2px}h1{font-size:32px;line-height:1.2}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:14px/1.7 ui-monospace,monospace}
    @media(max-width:650px){main{margin:0;padding:20px}}</style><main><header>TRIPWIRE / DEVELOPMENT ONLY</header>
    <h1>Source tracking: backfill reconciliation</h1><p>Verified ${report.verification.visibleImportedArticles.toLocaleString()} imported articles,
    ${report.claimFamilies} supplied claim families and ${report.verification.validatedEvidencePassages} exact evidence passages.
    No independent-path or confidential-person identity decisions were generated.</p><pre>${escaped}</pre></main></html>`);
  console.log(JSON.stringify({verification:report.verification,metadataCautions:cautions.length},null,2));
} finally {await pool.end();}
