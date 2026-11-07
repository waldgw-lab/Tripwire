import { pool } from "@workspace/db";
import { randomUUID } from "node:crypto";
import { WORKSPACE_OWNER as W } from "./tripwire-access";
import { ProvenanceError } from "./reporting-provenance";
import { DIRECTIONS } from "./live-claim-rules";

export async function correctDirection(input: {claimObservationId:string;subject:string;direction:string;rationale:string;supersedesId?:string|null}) {
 const client=await pool.connect();
 try {
  await client.query("begin");
  await client.query("select pg_advisory_xact_lock(hashtext($1))",[`articles:${W}`]);
  if(!DIRECTIONS.includes(input.direction as typeof DIRECTIONS[number]) || !input.subject.trim() || input.rationale.trim().length<5)
   throw new ProvenanceError(400,"A subject, valid direction and correction explanation are required");
  const claim=(await client.query("select article_id from tripwire_attributed_claims where workspace=$1 and id=$2",[W,input.claimObservationId])).rows[0];
  if(!claim)throw new ProvenanceError(404,"Claim attribution is unavailable");
  const article=(await client.query(`select data from tripwire_records where kind='article' and owner in ('public',$1)
   and (id=$2 or data->>'baseId'=$2) order by (owner=$1) desc limit 1`,[W,claim.article_id])).rows[0]?.data;
  if(!article || article.hidden)throw new ProvenanceError(404,"Article is unavailable");
  const previous=(await client.query(`select id from tripwire_claim_direction_corrections where workspace=$1 and claim_id=$2
   order by created_at desc,id desc limit 1`,[W,input.claimObservationId])).rows[0];
  if((previous?.id??null)!==(input.supersedesId??null))throw new ProvenanceError(409,"Direction changed; refresh before correcting it");
  const id=randomUUID();
  await client.query(`insert into tripwire_claim_direction_corrections(workspace,id,claim_id,subject,direction,rationale,supersedes_id)
   values($1,$2,$3,$4,$5,$6,$7)`,[W,id,input.claimObservationId,input.subject.trim(),input.direction,input.rationale.trim(),previous?.id??null]);
  await client.query("commit");return{id};
 }catch(error){await client.query("rollback");throw error;}finally{client.release();}
}
