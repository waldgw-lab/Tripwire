import { createHash } from "node:crypto";
import type { PoolClient } from "@workspace/db";
import { CLAIM_POLICY, extractClaimChunk, type LocalClaim } from "./live-claim-rules";

/** Only deterministic passage extraction is shared, never article/source identities or reviews.
 * The caller owns the transaction, including evidence writes and the job checkpoint.
 */
export async function retainedClaimChunk(client: PoolClient, hash: string, text: string, cursor: number, policy: string) {
 if(policy!==CLAIM_POLICY)throw new Error("Unsupported local claim rule policy");
 const textHash=createHash("sha256").update(text,"utf8").digest("hex");
 // Serializes misses as well as hits, including callers outside the article worker lock.
 await client.query("select pg_advisory_xact_lock(hashtext($1))",[`claim-extraction:${policy}:${textHash}`]);
 const cached=(await client.query(`select e.*,c.text from tripwire_claim_extraction_chunks e
  join tripwire_content c on c.hash=e.content_hash
  where e.text_hash=$1 and e.policy=$2 and e.cursor=$3`,[textHash,policy,cursor])).rows[0];
 if(cached) {
  // A digest is only an index: exact equality, without normalization, authorizes reuse.
  if(cached.text!==text)throw new Error("Claim extraction text digest collision");
  return {claims:cached.claims as LocalClaim[],nextCursor:cached.next_cursor as number};
 }
 const result=extractClaimChunk(text,cursor);
 await client.query(`insert into tripwire_claim_extraction_chunks(text_hash,policy,cursor,content_hash,claims,next_cursor)
  values($1,$2,$3,$4,$5,$6)`,[textHash,policy,cursor,hash,JSON.stringify(result.claims),result.nextCursor]);
 return result;
}
