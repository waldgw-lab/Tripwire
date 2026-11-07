CREATE TABLE tripwire_source_batches (
 id text PRIMARY KEY, input_hash text NOT NULL UNIQUE,
 status text NOT NULL CHECK(status IN ('applied','rolled-back')),
 manifest jsonb NOT NULL, report jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE tripwire_source_inputs (
 batch_id text NOT NULL REFERENCES tripwire_source_batches(id),
 sheet text NOT NULL, row_key text NOT NULL, hash text NOT NULL,
 data jsonb NOT NULL, resolution jsonb NOT NULL,
 PRIMARY KEY(batch_id,sheet,row_key)
);
--> statement-breakpoint
CREATE TABLE tripwire_source_changes (
 batch_id text NOT NULL REFERENCES tripwire_source_batches(id),
 sequence integer NOT NULL, table_name text NOT NULL, row_key jsonb NOT NULL,
 before_image jsonb, after_image jsonb NOT NULL,
 PRIMARY KEY(batch_id,sequence)
);
--> statement-breakpoint
CREATE TABLE tripwire_claim_families (
 workspace text NOT NULL, id text NOT NULL, claim_id text NOT NULL,
 proposition text NOT NULL, event_id text, entity_event_id text,
 supplied boolean NOT NULL DEFAULT false, external_id text,
 batch_id text REFERENCES tripwire_source_batches(id),
 PRIMARY KEY(workspace,id), UNIQUE(workspace,claim_id),
 FOREIGN KEY(workspace,entity_event_id) REFERENCES tripwire_entities(workspace,id)
);
--> statement-breakpoint
CREATE TABLE tripwire_source_occurrences (
 workspace text NOT NULL, id text NOT NULL, article_id text NOT NULL,
 capture_id text, evidence_id text, descriptor text NOT NULL,
 source_type text NOT NULL, anonymity text NOT NULL,
 minimum_humans integer CHECK(minimum_humans IS NULL OR minimum_humans >= 0),
 supplied boolean NOT NULL DEFAULT true,
 external_id text, family_hypothesis text, data jsonb NOT NULL DEFAULT '{}',
 batch_id text REFERENCES tripwire_source_batches(id),
 PRIMARY KEY(workspace,id),
 FOREIGN KEY(workspace,capture_id) REFERENCES tripwire_entity_captures(workspace,id),
 FOREIGN KEY(workspace,evidence_id) REFERENCES tripwire_entity_evidence(workspace,id),
 UNIQUE(workspace,id,article_id)
);
--> statement-breakpoint
CREATE TABLE tripwire_attributed_claims (
 workspace text NOT NULL, id text NOT NULL, family_id text NOT NULL,
 article_id text NOT NULL, evidence_id text,
 proposition text NOT NULL, supplied boolean NOT NULL DEFAULT true,
 external_id text, data jsonb NOT NULL DEFAULT '{}',
 batch_id text REFERENCES tripwire_source_batches(id),
 PRIMARY KEY(workspace,id), UNIQUE(workspace,id,article_id),
 FOREIGN KEY(workspace,family_id) REFERENCES tripwire_claim_families(workspace,id),
 FOREIGN KEY(workspace,evidence_id) REFERENCES tripwire_entity_evidence(workspace,id)
);
--> statement-breakpoint
CREATE TABLE tripwire_claim_sources (
 workspace text NOT NULL, claim_id text NOT NULL, source_id text NOT NULL, article_id text NOT NULL,
 batch_id text REFERENCES tripwire_source_batches(id),
 PRIMARY KEY(workspace,claim_id,source_id),
 FOREIGN KEY(workspace,claim_id,article_id) REFERENCES tripwire_attributed_claims(workspace,id,article_id),
 FOREIGN KEY(workspace,source_id,article_id) REFERENCES tripwire_source_occurrences(workspace,id,article_id)
);
--> statement-breakpoint
CREATE TABLE tripwire_source_matches (
 workspace text NOT NULL, id text NOT NULL, source_a text NOT NULL, source_b text NOT NULL,
 hypothesis text NOT NULL, rationale text NOT NULL, conflicts text NOT NULL,
 supplied boolean NOT NULL DEFAULT true, external_id text,
 batch_id text REFERENCES tripwire_source_batches(id),
 PRIMARY KEY(workspace,id),
 FOREIGN KEY(workspace,source_a) REFERENCES tripwire_source_occurrences(workspace,id),
 FOREIGN KEY(workspace,source_b) REFERENCES tripwire_source_occurrences(workspace,id),
 CHECK(source_a <> source_b)
);
--> statement-breakpoint
CREATE TABLE tripwire_provenance_reviews (
 workspace text NOT NULL, id text NOT NULL, claim_id text,
 source_match_id text, target_claim_id text, supersedes_id text, relation text NOT NULL,
 evidence_id text, path_key text, rationale text NOT NULL, actor text,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(workspace,id), UNIQUE(workspace,supersedes_id),
 FOREIGN KEY(workspace,claim_id) REFERENCES tripwire_attributed_claims(workspace,id),
 FOREIGN KEY(workspace,target_claim_id) REFERENCES tripwire_attributed_claims(workspace,id),
 FOREIGN KEY(workspace,source_match_id) REFERENCES tripwire_source_matches(workspace,id),
 FOREIGN KEY(workspace,supersedes_id) REFERENCES tripwire_provenance_reviews(workspace,id),
 FOREIGN KEY(workspace,evidence_id) REFERENCES tripwire_entity_evidence(workspace,id),
 CHECK((claim_id IS NULL) <> (source_match_id IS NULL)),
 CHECK(relation IN ('new-reporting','added-evidence','derivative','opinion-propagation','disputes','unknown','same-environment','distinct-environments','unresolved')),
 CHECK(path_key IS NULL OR (claim_id IS NOT NULL AND evidence_id IS NOT NULL AND relation IN ('new-reporting','added-evidence'))),
 CHECK(length(trim(rationale)) >= 5)
);
--> statement-breakpoint
CREATE INDEX source_occurrence_article ON tripwire_source_occurrences(workspace,article_id);
--> statement-breakpoint
CREATE INDEX attributed_claim_family ON tripwire_attributed_claims(workspace,family_id);
--> statement-breakpoint
CREATE INDEX provenance_review_claim ON tripwire_provenance_reviews(workspace,claim_id,created_at);
