CREATE TABLE tripwire_development_claim_links (
 workspace text NOT NULL, development_id text NOT NULL, claim_id text NOT NULL, evidence_id text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(workspace,development_id,claim_id,evidence_id),
 FOREIGN KEY(workspace,claim_id) REFERENCES tripwire_attributed_claims(workspace,id),
 FOREIGN KEY(workspace,evidence_id) REFERENCES tripwire_entity_evidence(workspace,id),
 FOREIGN KEY(workspace,development_id,evidence_id)
  REFERENCES tripwire_entity_observations(workspace,development_id,evidence_id)
);
