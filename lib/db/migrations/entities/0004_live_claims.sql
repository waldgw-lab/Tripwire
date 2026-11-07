CREATE TABLE tripwire_claim_jobs (
 workspace text NOT NULL, article_id text NOT NULL, hash text NOT NULL, policy text NOT NULL,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','complete','no-claims','failed','superseded')),
 attempts integer NOT NULL DEFAULT 0, error text, result_count integer NOT NULL DEFAULT 0,
 cursor integer NOT NULL DEFAULT 0 CHECK(cursor>=0),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(workspace,article_id,hash,policy)
);
CREATE INDEX claim_jobs_pending ON tripwire_claim_jobs(workspace,status,created_at);
--> statement-breakpoint
CREATE TABLE tripwire_claim_capture_links (
 workspace text NOT NULL, claim_id text NOT NULL, capture_id text NOT NULL, evidence_id text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(workspace,claim_id,capture_id),
 FOREIGN KEY(workspace,claim_id) REFERENCES tripwire_attributed_claims(workspace,id),
 FOREIGN KEY(workspace,capture_id) REFERENCES tripwire_entity_captures(workspace,id),
 FOREIGN KEY(workspace,evidence_id) REFERENCES tripwire_entity_evidence(workspace,id)
);
--> statement-breakpoint
CREATE TABLE tripwire_claim_direction_corrections (
 workspace text NOT NULL, id text NOT NULL, claim_id text NOT NULL,
 subject text NOT NULL CHECK(length(trim(subject)) BETWEEN 1 AND 200),
 direction text NOT NULL CHECK(direction IN ('positive','negative','neutral','mixed','unassessed')),
 rationale text NOT NULL CHECK(length(trim(rationale)) BETWEEN 5 AND 2000),
 supersedes_id text, created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(workspace,id), UNIQUE(workspace,supersedes_id),
 FOREIGN KEY(workspace,claim_id) REFERENCES tripwire_attributed_claims(workspace,id),
 FOREIGN KEY(workspace,supersedes_id) REFERENCES tripwire_claim_direction_corrections(workspace,id)
);
--> statement-breakpoint
CREATE FUNCTION tripwire_enqueue_claim_content() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.kind='article' AND NEW.owner IN ('public','workspace')
  AND coalesce(NEW.data->>'hidden','false')<>'true'
  AND NOT (NEW.data ? 'sourceSearch')
  AND length(coalesce(NEW.data->>'fullTextHash',''))=64 THEN
  IF TG_OP='INSERT' OR OLD.data->>'fullTextHash' IS DISTINCT FROM NEW.data->>'fullTextHash' THEN
   INSERT INTO tripwire_claim_jobs(workspace,article_id,hash,policy)
    VALUES('workspace',coalesce(NEW.data->>'baseId',NEW.id),NEW.data->>'fullTextHash','local-reporting-v1')
    ON CONFLICT DO NOTHING;
  END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER tripwire_claim_content AFTER INSERT OR UPDATE ON tripwire_records
 FOR EACH ROW EXECUTE FUNCTION tripwire_enqueue_claim_content();
