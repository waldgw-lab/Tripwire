import { pool, type PoolClient } from "@workspace/db";
import { randomUUID } from "node:crypto";
import { CLAIM_POLICY, propositionKey } from "./live-claim-rules";
import { retainedClaimChunk } from "./live-claim-extraction-cache";
import { sourceKey } from "./source-search-rules";
import { WORKSPACE_OWNER as W } from "./tripwire-access";
import { logger } from "./logger";
import { xClaimSkipReason } from "./x-claim-policy";

type Row = Record<string, any>;
export class LiveClaimInputError extends Error {}
async function visibleArticle(client: PoolClient, articleId: string) {
 return (await client.query(`select id,data from tripwire_records where kind='article' and owner in ('public',$1)
  and (id=$2 or data->>'baseId'=$2) order by (owner=$1) desc limit 1`,[W,articleId])).rows[0] as Row|undefined;
}

/** Explicit retained-text request. Never retrieves a publisher or provisions a model. */
export async function queueArticleClaims(articleId: string) {
 const client=await pool.connect();
 try {
  const article=await visibleArticle(client,articleId);
  if(!article || article.data.hidden)throw new LiveClaimInputError("Article is unavailable");
  const hash=article.data.fullTextHash;
  if(typeof hash!=="string" || hash.length!==64)throw new LiveClaimInputError("Add retained article text before processing claims");
  const retained = (await client.query("select text from tripwire_content where hash=$1", [hash])).rows[0];
  const skipReason = xClaimSkipReason(article.data, retained?.text ?? "");
  if (skipReason) throw new LiveClaimInputError(skipReason);
  const result=await client.query(`insert into tripwire_claim_jobs(workspace,article_id,hash,policy) values($1,$2,$3,$4)
   on conflict(workspace,article_id,hash,policy) do update set status='pending',attempts=0,cursor=0,result_count=0,error=null,updated_at=now()
   where tripwire_claim_jobs.status in ('failed','superseded') returning article_id`,
   [W,article.data.baseId??article.id,hash,CLAIM_POLICY]);
  return {queued:!!result.rowCount};
 } finally {client.release();}
}

async function applyJob(client: PoolClient, job: Row) {
 const article=await visibleArticle(client,job.article_id);
 if(!article || article.data.hidden || (article.data.fullTextHash!==job.hash &&
   !article.data.retainedContent?.some((c:Row)=>c.bodyHash===job.hash))) {
  await client.query("update tripwire_claim_jobs set status='superseded',updated_at=now() where workspace=$1 and article_id=$2 and hash=$3 and policy=$4",
   [W,job.article_id,job.hash,job.policy]);return;
 }
 const data=article.data;
 const retained=(await client.query("select text from tripwire_content where hash=$1",[job.hash])).rows[0];
 if(!retained)throw new Error("Retained body is unavailable; original article is unchanged");
 const skipReason=xClaimSkipReason(data,retained.text);
 if(skipReason) {
  await client.query(`update tripwire_claim_jobs set status='no-claims',result_count=0,error=$5,updated_at=now()
   where workspace=$1 and article_id=$2 and hash=$3 and policy=$4`,[W,job.article_id,job.hash,job.policy,skipReason]);
  return;
 }
 const postAttribution=data.xPost ? `@${data.xPost.handle}` : null;
 const {claims,nextCursor}=await retainedClaimChunk(client,job.hash,retained.text,job.cursor,job.policy);
 const captures:Row[]=data.retainedContent?.filter((c:Row)=>c.bodyHash===job.hash)??[];
 if(!captures.length)captures.push({});
 const families=(await client.query(`select f.*,r.id record_id,r.data from tripwire_claim_families f left join tripwire_records r
  on r.kind='claim' and r.owner=$1 and (r.id=f.claim_id or r.data->>'baseId'=f.claim_id)
  where f.workspace=$1`,[W])).rows;
 let added=0, count=0;
 for(const capture of captures) {
 const originalCaptureId=capture?.id ?? `body:${job.hash}`;
 const captureId=sourceKey(W,job.article_id,originalCaptureId,job.hash);
 const date=typeof data.publishedAt==="string" && /T.*(?:Z|[+-]\d{2}:\d{2})$/.test(data.publishedAt)
  && Number.isFinite(Date.parse(data.publishedAt)) ? data.publishedAt : null;
 await client.query(`insert into tripwire_entity_captures(workspace,id,article_id,capture_id,hash,source,url,published_at,captured_at,complete,authorized,byline,publisher)
  values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,false,$11,$12) on conflict do nothing`,
  [W,captureId,job.article_id,originalCaptureId,job.hash,capture?.source ?? "retained article",data.url??null,date,
   capture?.capturedAt ?? job.created_at,job.hash===data.fullTextHash && !!data.fullTextComplete,postAttribution??data.byline??null,data.outlet??null]);
 for(const c of claims) {
  if(retained.text.slice(c.start,c.end)!==c.excerpt)throw new Error("Passage offsets do not match retained text");
  const candidates=families.filter(f=>propositionKey(f.proposition)===propositionKey(c.proposition));
  if(candidates.some(f=>!f.record_id || f.data?.hidden))continue; // A removed claim is not permission to recreate it.
  let family=candidates.length===1 ? candidates[0] : null;
  if(!family) {
   const id=sourceKey(W,"live-family",job.article_id,job.hash,propositionKey(c.proposition)),claimId=randomUUID();
   await client.query(`insert into tripwire_records(id,owner,kind,data) values($1,$2,'claim',$3)`,
    [`${W}:${claimId}`,W,{baseId:claimId,kind:"claim",title:c.proposition,summary:postAttribution ? "X-post reporting" : "Article-backed reporting",observations:[]}]);
   await client.query(`insert into tripwire_claim_families(workspace,id,claim_id,proposition,supplied) values($1,$2,$3,$4,false)`,
    [W,id,claimId,c.proposition]);
   family={id,claim_id:claimId,proposition:c.proposition,record_id:`${W}:${claimId}`};families.push(family);
  }
  const evidenceId=sourceKey(W,"live-evidence",captureId,c.start,c.end);
  await client.query(`insert into tripwire_entity_evidence(workspace,id,capture_id,excerpt,start,"end",attribution,certainty,scope,extractor_version,policy_version)
   values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10) on conflict do nothing`,
   [W,evidenceId,captureId,c.excerpt,c.start,c.end,c.descriptor??postAttribution??"Article narrative",c.stance==="reported"?"attributed":c.stance==="disputed"?"disputed":"alleged",
    postAttribution ? "X-post reporting, not a truth or independence decision" : "Article-attributed reporting, not a truth or independence decision",CLAIM_POLICY]);
  const existing=(await client.query("select id from tripwire_attributed_claims where workspace=$1 and family_id=$2 and article_id=$3 limit 2",
   [W,family.id,job.article_id])).rows;
  if(existing.length>1)throw new Error("Multiple existing attributions for this article/proposition; exact linkage needs attention");
  const claimId=existing[0]?.id ?? sourceKey(W,"live-attribution",job.article_id,family.id);
  const assessment={direction:c.direction,subject:c.subject,reason:c.reason,method:"local-rules",policy:CLAIM_POLICY,stance:c.stance};
  const inserted=await client.query(`insert into tripwire_attributed_claims(workspace,id,family_id,article_id,evidence_id,proposition,supplied,data)
   values($1,$2,$3,$4,$5,$6,false,$7) on conflict do nothing returning id`,
   [W,claimId,family.id,job.article_id,evidenceId,c.proposition,{assessment}]);
  if(inserted.rowCount)added++;
  if(!inserted.rowCount)await client.query(`update tripwire_attributed_claims set data=data || $3::jsonb,evidence_id=coalesce(evidence_id,$4)
    where workspace=$1 and id=$2 and not(data ? 'assessment')`,[W,claimId,{assessment},evidenceId]);
  const linked=await client.query(`insert into tripwire_claim_capture_links(workspace,claim_id,capture_id,evidence_id) values($1,$2,$3,$4) on conflict do nothing returning claim_id`,
   [W,claimId,captureId,evidenceId]);
  if(linked.rowCount)await client.query(`update tripwire_records set updated_at=now()
   where owner=$1 and kind='claim' and (id=$2 or data->>'baseId'=$2)`,[W,family.claim_id]);
  const descriptor=c.descriptor??postAttribution??"Article narrative", sourceId=sourceKey(W,"live-source",captureId,descriptor,c.start);
  // Explicit source descriptions remain article/capture-specific. Narrative is not an anonymous human.
  await client.query(`insert into tripwire_source_occurrences(workspace,id,article_id,capture_id,evidence_id,descriptor,source_type,anonymity,supplied,data)
   values($1,$2,$3,$4,$5,$6,$7,'Unknown',false,$8) on conflict do nothing`,
   [W,sourceId,job.article_id,captureId,evidenceId,descriptor,c.descriptor?"Attributed description":postAttribution?"X post":"Article",
    {method:CLAIM_POLICY,sourceWording:c.descriptor,minimumUnknown:true}]);
  await client.query(`insert into tripwire_claim_sources(workspace,claim_id,source_id,article_id) values($1,$2,$3,$4) on conflict do nothing`,
   [W,claimId,sourceId,job.article_id]);
 }
 // Multiple captures of this same body are evidence versions, not additional claims.
 count=Math.max(count,(await client.query("select count(*)::int n from tripwire_claim_capture_links where workspace=$1 and capture_id=$2",[W,captureId])).rows[0].n);
 }
 await client.query(`update tripwire_claim_jobs set status=$5,result_count=$6,cursor=$7,error=null,updated_at=now()
  where workspace=$1 and article_id=$2 and hash=$3 and policy=$4`,
  [W,job.article_id,job.hash,job.policy,nextCursor<retained.text.length?"pending":count?"complete":"no-claims",count,nextCursor]);
 return added;
}

/** One atomic job; a crash rolls back its claims AND checkpoint. Safe across multiple processes. */
export async function runClaimTick() {
 const client=await pool.connect();
 let job:Row|undefined;
 try {
  await client.query("begin");
  await client.query("select pg_advisory_xact_lock(hashtext($1))",[`articles:${W}`]);
  job=(await client.query(`select * from tripwire_claim_jobs where workspace=$1 and policy=$2 and
   (status='pending' or status='failed' and attempts<3 and updated_at<now()-interval '30 seconds')
   order by(status='pending') desc,created_at for update skip locked limit 1`,[W,CLAIM_POLICY])).rows[0];
  if(!job){await client.query("commit");return false;}
  await client.query("savepoint claim_content");
  try {
   await applyJob(client,job);
  } catch(error) {
   await client.query("rollback to savepoint claim_content");
   await client.query(`update tripwire_claim_jobs set status='failed',attempts=attempts+1,error=$5,updated_at=now()
    where workspace=$1 and article_id=$2 and hash=$3 and policy=$4`,
    [W,job.article_id,job.hash,job.policy,error instanceof Error?error.message.slice(0,500):"Local processing failed"]);
  }
  await client.query("commit");return true;
 } catch(error) {await client.query("rollback");throw error;}
 finally {client.release();}
}

export async function claimProcessing() {
 // One database snapshot for counters AND rows; current means the selected
 // body, not whichever historical capture happened to finish most recently.
 const result=(await pool.query(`with article_view as materialized(
  select distinct on(coalesce(data->>'baseId',id)) coalesce(data->>'baseId',id) article_id,data,updated_at
  from tripwire_records where kind='article' and owner in('public',$1)
  order by coalesce(data->>'baseId',id),(owner=$1) desc),
 visible_jobs as materialized(
  select j.*,a.data->>'title' title,a.data->>'fullTextHash' current_hash,a.updated_at article_updated_at
  from tripwire_claim_jobs j join article_view a on a.article_id=j.article_id
  where coalesce(a.data->>'hidden','false')<>'true' and j.workspace=$1 and j.policy=$2),
 recent_articles as(
  select article_id from visible_jobs group by article_id
  order by bool_or(status='failed') desc,max(updated_at) desc,article_id limit 12)
 select (select count(*)::int from visible_jobs where status='pending') pending,
 (select count(*)::int from visible_jobs where status='failed') failed,
 coalesce((select jsonb_agg(to_jsonb(v)||jsonb_build_object('body_characters',length(c.text))
  order by v.updated_at desc,v.article_id,v.hash) from visible_jobs v
  join recent_articles r using(article_id) left join tripwire_content c on c.hash=v.hash),'[]'::jsonb) jobs`,
  [W,CLAIM_POLICY])).rows[0];
 const byArticle=new Map<string,Row[]>();
 for(const j of result.jobs as Row[]) {
  const rows=byArticle.get(j.article_id)??[]; rows.push(j); byArticle.set(j.article_id,rows);
 }
 const run=(j:Row)=>({jobId:sourceKey(W,j.article_id,j.hash,j.policy),articleId:j.article_id,
  status:j.status,claims:j.result_count,error:j.error??null,updatedAt:new Date(j.updated_at).toISOString(),
  bodyCharacters:j.body_characters??null,current:j.hash===j.current_hash});
 const recent=[...byArticle.values()].map(rows=>{
  const selected=rows.find(j=>j.hash===j.current_hash);
  const primary=selected?run(selected):{
   jobId:sourceKey(W,rows[0].article_id,rows[0].current_hash,"not-processed"),
   articleId:rows[0].article_id,status:"not-processed",claims:0,error:null,
   updatedAt:new Date(rows[0].article_updated_at).toISOString(),bodyCharacters:null,current:true};
  return {...primary,title:rows[0].title??"Retained article",history:rows.filter(j=>j!==selected).map(run)};
 });
 return {policy:CLAIM_POLICY,pending:result.pending,failed:result.failed,recent};
}

export function startClaimWorker() {
 let running=false;
 const tick=async()=>{if(running)return;running=true;try{for(let n=0;n<5;n++)if(!await runClaimTick())break;}
  catch(error){logger.error({err:error instanceof Error?error.message:"Local processing failed"},"Claim worker unavailable");}finally{running=false;}};
 void tick();const timer=setInterval(()=>void tick(),15000);timer.unref();
}
