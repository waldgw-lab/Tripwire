-- Raw content hashes intentionally include the original response. Reuse only
-- local rule output for exact text; all evidence/attributions remain per capture.
CREATE TABLE tripwire_claim_extraction_chunks (
 text_hash text NOT NULL CHECK(length(text_hash)=64),
 policy text NOT NULL,
 cursor integer NOT NULL CHECK(cursor>=0),
 content_hash text NOT NULL REFERENCES tripwire_content(hash),
 claims jsonb NOT NULL CHECK(jsonb_typeof(claims)='array'),
 next_cursor integer NOT NULL CHECK(next_cursor>=cursor),
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(text_hash,policy,cursor)
);
--> statement-breakpoint
-- A new capture can reference an existing raw content hash. Replay its linkage
-- idempotently, using cached chunks rather than skipping the additional capture.
CREATE OR REPLACE FUNCTION tripwire_enqueue_claim_content() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE old_data jsonb := '{}'; body_hash text;
BEGIN
 IF TG_OP='UPDATE' THEN old_data:=OLD.data; END IF;
 IF NEW.kind='article' AND NEW.owner IN ('public','workspace')
  AND coalesce(NEW.data->>'hidden','false')<>'true' AND NOT (NEW.data ? 'sourceSearch') THEN
  FOR body_hash IN
   SELECT NEW.data->>'fullTextHash'
   UNION SELECT item->>'bodyHash' FROM jsonb_array_elements(
     CASE WHEN jsonb_typeof(NEW.data->'retainedContent')='array' THEN NEW.data->'retainedContent' ELSE '[]'::jsonb END) item
  LOOP
   IF length(coalesce(body_hash,''))=64
    AND (TG_OP='INSERT' OR body_hash IS DISTINCT FROM old_data->>'fullTextHash'
     AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(
       CASE WHEN jsonb_typeof(old_data->'retainedContent')='array' THEN old_data->'retainedContent' ELSE '[]'::jsonb END) previous
       WHERE previous->>'bodyHash'=body_hash)
     OR EXISTS(SELECT 1 FROM jsonb_array_elements(
       CASE WHEN jsonb_typeof(NEW.data->'retainedContent')='array' THEN NEW.data->'retainedContent' ELSE '[]'::jsonb END) item
       WHERE item->>'bodyHash'=body_hash AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(
         CASE WHEN jsonb_typeof(old_data->'retainedContent')='array' THEN old_data->'retainedContent' ELSE '[]'::jsonb END) previous
         WHERE previous->>'bodyHash'=body_hash AND previous->>'id'=item->>'id'))) THEN
    INSERT INTO tripwire_claim_jobs(workspace,article_id,hash,policy)
     VALUES('workspace',coalesce(NEW.data->>'baseId',NEW.id),body_hash,'local-reporting-v1')
     ON CONFLICT(workspace,article_id,hash,policy) DO UPDATE
      SET status='pending',cursor=0,result_count=0,attempts=0,error=null,updated_at=now();
   END IF;
  END LOOP;
 END IF;
 RETURN NEW;
END $$;
