-- Retained excerpts can add reporting even when a longer primary body is preserved.
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
    AND (TG_OP='INSERT' OR (body_hash IS DISTINCT FROM old_data->>'fullTextHash'
     AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(
       CASE WHEN jsonb_typeof(old_data->'retainedContent')='array' THEN old_data->'retainedContent' ELSE '[]'::jsonb END) previous
       WHERE previous->>'bodyHash'=body_hash))) THEN
    INSERT INTO tripwire_claim_jobs(workspace,article_id,hash,policy)
     VALUES('workspace',coalesce(NEW.data->>'baseId',NEW.id),body_hash,'local-reporting-v1') ON CONFLICT DO NOTHING;
   END IF;
  END LOOP;
 END IF;
 RETURN NEW;
END $$;
