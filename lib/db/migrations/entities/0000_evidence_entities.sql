CREATE TABLE "tripwire_entity_assertions" (
	"id" text NOT NULL,
	"workspace" text NOT NULL,
	"subject_id" text NOT NULL,
	"predicate" text NOT NULL,
	"object_id" text,
	"value" text,
	"evidence_id" text NOT NULL,
	"event_id" text,
	"certainty" text NOT NULL,
	"status" text DEFAULT 'candidate' NOT NULL,
	"valid_from" timestamp with time zone,
	"valid_to" timestamp with time zone,
	"tenure" text,
	"supersedes_id" text,
	"disputes_id" text,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tripwire_entity_assertions_workspace_id_pk" PRIMARY KEY("workspace","id"),
	CONSTRAINT "assertion_time" CHECK ("tripwire_entity_assertions"."valid_from" is null or "tripwire_entity_assertions"."valid_to" is null or "tripwire_entity_assertions"."valid_to" >= "tripwire_entity_assertions"."valid_from")
);
--> statement-breakpoint
CREATE TABLE "tripwire_entity_automation" (
	"workspace" text PRIMARY KEY NOT NULL,
	"mode" text DEFAULT 'observe' NOT NULL,
	"epoch" integer DEFAULT 0 NOT NULL,
	"authorized" boolean DEFAULT false NOT NULL,
	"private_material" boolean DEFAULT false NOT NULL,
	"policy_version" text DEFAULT 'evidence-v1' NOT NULL,
	"policy" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"daily_tokens" integer DEFAULT 50000 NOT NULL,
	"daily_micros" integer DEFAULT 1000000 NOT NULL,
	"budget_day" text,
	"used_tokens" integer DEFAULT 0 NOT NULL,
	"used_micros" integer DEFAULT 0 NOT NULL,
	"last_success" timestamp with time zone,
	"failures" integer DEFAULT 0 NOT NULL,
	"capture_cursor" text
);
--> statement-breakpoint
CREATE TABLE "tripwire_entity_candidates" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace" text NOT NULL,
	"entity_id" text NOT NULL,
	"match_id" text,
	"evidence_id" text,
	"reason" text NOT NULL,
	"resolution" text DEFAULT 'pending' NOT NULL,
	"identity_confidence" text DEFAULT 'unresolved' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tripwire_entity_captures" (
	"id" text NOT NULL,
	"workspace" text NOT NULL,
	"article_id" text NOT NULL,
	"capture_id" text NOT NULL,
	"hash" text NOT NULL,
	"source" text NOT NULL,
	"url" text,
	"published_at" timestamp with time zone,
	"captured_at" timestamp with time zone NOT NULL,
	"complete" boolean NOT NULL,
	"authorized" boolean DEFAULT false NOT NULL,
	"byline" text,
	"publisher" text,
	CONSTRAINT "tripwire_entity_captures_workspace_id_pk" PRIMARY KEY("workspace","id"),
	CONSTRAINT "capture_version" UNIQUE("workspace","article_id","capture_id","hash")
);
--> statement-breakpoint
CREATE TABLE "tripwire_entity_control_log" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace" text NOT NULL,
	"origin" text NOT NULL,
	"action" text NOT NULL,
	"previous" jsonb NOT NULL,
	"result" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tripwire_entity_decisions" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace" text NOT NULL,
	"entity_id" text NOT NULL,
	"origin" text NOT NULL,
	"action" text NOT NULL,
	"rationale" text NOT NULL,
	"previous" jsonb NOT NULL,
	"result" jsonb NOT NULL,
	"dimensions" jsonb NOT NULL,
	"evidence_ids" text[] NOT NULL,
	"policy_version" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tripwire_entity_developments" (
	"id" text NOT NULL,
	"workspace" text NOT NULL,
	"event_key" text NOT NULL,
	"claim_key" text NOT NULL,
	"title" text NOT NULL,
	"explanation" text NOT NULL,
	"disposition" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"entity_ids" text[] NOT NULL,
	"policy_version" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tripwire_entity_developments_workspace_id_pk" PRIMARY KEY("workspace","id"),
	CONSTRAINT "development_material_change" UNIQUE("workspace","event_key","claim_key")
);
--> statement-breakpoint
CREATE TABLE "tripwire_entity_evidence" (
	"id" text NOT NULL,
	"workspace" text NOT NULL,
	"capture_id" text NOT NULL,
	"excerpt" text NOT NULL,
	"start" integer NOT NULL,
	"end" integer NOT NULL,
	"attribution" text NOT NULL,
	"certainty" text NOT NULL,
	"scope" text NOT NULL,
	"extractor_version" text NOT NULL,
	"policy_version" text NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tripwire_entity_evidence_workspace_id_pk" PRIMARY KEY("workspace","id"),
	CONSTRAINT "evidence_offsets" CHECK ("tripwire_entity_evidence"."start" >= 0 and "tripwire_entity_evidence"."end" > "tripwire_entity_evidence"."start"),
	CONSTRAINT "evidence_certainty" CHECK ("tripwire_entity_evidence"."certainty" in ('asserted','attributed','alleged','disputed','inferred','confirmed'))
);
--> statement-breakpoint
CREATE TABLE "tripwire_entity_identifiers" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace" text NOT NULL,
	"entity_id" text NOT NULL,
	"namespace" text NOT NULL,
	"value" text NOT NULL,
	"evidence_id" text NOT NULL,
	CONSTRAINT "entity_identifier_unique" UNIQUE("workspace","namespace","value")
);
--> statement-breakpoint
CREATE TABLE "tripwire_entity_jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace" text NOT NULL,
	"capture_id" text NOT NULL,
	"policy_version" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"lease_owner" text,
	"lease_until" timestamp with time zone,
	"epoch" integer,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_run" timestamp with time zone DEFAULT now() NOT NULL,
	"checkpoint" text,
	"tokens" integer DEFAULT 0 NOT NULL,
	"cost_micros" integer DEFAULT 0 NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "job_capture_policy" UNIQUE("workspace","capture_id","policy_version")
);
--> statement-breakpoint
CREATE TABLE "tripwire_entity_legacy" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace" text NOT NULL,
	"watch_id" text NOT NULL,
	"entity_id" text NOT NULL,
	"original" jsonb NOT NULL,
	CONSTRAINT "legacy_watch" UNIQUE("workspace","watch_id")
);
--> statement-breakpoint
CREATE TABLE "tripwire_entity_lineage" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace" text NOT NULL,
	"evidence_id" text NOT NULL,
	"origin_key" text,
	"relation" text DEFAULT 'unknown' NOT NULL,
	"independently_reported" boolean DEFAULT false NOT NULL,
	"rationale" text NOT NULL,
	"assessed_by" text NOT NULL,
	CONSTRAINT "lineage_evidence" UNIQUE("workspace","evidence_id")
);
--> statement-breakpoint
CREATE TABLE "tripwire_entity_observations" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace" text NOT NULL,
	"development_id" text NOT NULL,
	"evidence_id" text NOT NULL,
	"novelty" text NOT NULL,
	CONSTRAINT "development_observation" UNIQUE("workspace","development_id","evidence_id")
);
--> statement-breakpoint
CREATE TABLE "tripwire_entities" (
	"id" text NOT NULL,
	"workspace" text NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"facets" text[] DEFAULT '{}' NOT NULL,
	"aliases" text[] DEFAULT '{}' NOT NULL,
	"organization_id" text,
	"redirect_id" text,
	"classification" text DEFAULT 'contextual' NOT NULL,
	"state" text DEFAULT 'Discovered' NOT NULL,
	"priority" integer DEFAULT 2 NOT NULL,
	"rationale" text NOT NULL,
	"pinned" boolean DEFAULT false NOT NULL,
	"unresolved" boolean DEFAULT false NOT NULL,
	"last_development" timestamp with time zone,
	"next_review" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tripwire_entities_workspace_id_pk" PRIMARY KEY("workspace","id"),
	CONSTRAINT "entity_type" CHECK ("tripwire_entities"."type" in ('person','position','organization','company','capability','issue','event')),
	CONSTRAINT "entity_state" CHECK ("tripwire_entities"."state" in ('Discovered','Active','Watch','Archived')),
	CONSTRAINT "entity_class" CHECK ("tripwire_entities"."classification" in ('structural','strategic','contextual')),
	CONSTRAINT "entity_priority" CHECK ("tripwire_entities"."priority" between 1 and 3),
	CONSTRAINT "entity_anchor" CHECK ("tripwire_entities"."classification" <> 'structural' or "tripwire_entities"."type" in ('organization','position'))
);
--> statement-breakpoint
ALTER TABLE "tripwire_entity_assertions" ADD CONSTRAINT "assert_subject_fk" FOREIGN KEY ("workspace","subject_id") REFERENCES "public"."tripwire_entities"("workspace","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tripwire_entity_assertions" ADD CONSTRAINT "assert_object_fk" FOREIGN KEY ("workspace","object_id") REFERENCES "public"."tripwire_entities"("workspace","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tripwire_entity_assertions" ADD CONSTRAINT "assert_event_fk" FOREIGN KEY ("workspace","event_id") REFERENCES "public"."tripwire_entities"("workspace","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tripwire_entity_assertions" ADD CONSTRAINT "assert_evidence_fk" FOREIGN KEY ("workspace","evidence_id") REFERENCES "public"."tripwire_entity_evidence"("workspace","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tripwire_entity_assertions" ADD CONSTRAINT "assert_supersedes_fk" FOREIGN KEY ("workspace","supersedes_id") REFERENCES "public"."tripwire_entity_assertions"("workspace","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tripwire_entity_assertions" ADD CONSTRAINT "assert_disputes_fk" FOREIGN KEY ("workspace","disputes_id") REFERENCES "public"."tripwire_entity_assertions"("workspace","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tripwire_entity_candidates" ADD CONSTRAINT "candidate_entity_fk" FOREIGN KEY ("workspace","entity_id") REFERENCES "public"."tripwire_entities"("workspace","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tripwire_entity_candidates" ADD CONSTRAINT "candidate_match_fk" FOREIGN KEY ("workspace","match_id") REFERENCES "public"."tripwire_entities"("workspace","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tripwire_entity_candidates" ADD CONSTRAINT "candidate_evidence_fk" FOREIGN KEY ("workspace","evidence_id") REFERENCES "public"."tripwire_entity_evidence"("workspace","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tripwire_entity_captures" ADD CONSTRAINT "tripwire_entity_captures_hash_tripwire_content_hash_fk" FOREIGN KEY ("hash") REFERENCES "public"."tripwire_content"("hash") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tripwire_entity_decisions" ADD CONSTRAINT "decision_entity_fk" FOREIGN KEY ("workspace","entity_id") REFERENCES "public"."tripwire_entities"("workspace","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tripwire_entity_evidence" ADD CONSTRAINT "evidence_capture_fk" FOREIGN KEY ("workspace","capture_id") REFERENCES "public"."tripwire_entity_captures"("workspace","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tripwire_entity_identifiers" ADD CONSTRAINT "identifier_entity_fk" FOREIGN KEY ("workspace","entity_id") REFERENCES "public"."tripwire_entities"("workspace","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tripwire_entity_identifiers" ADD CONSTRAINT "identifier_evidence_fk" FOREIGN KEY ("workspace","evidence_id") REFERENCES "public"."tripwire_entity_evidence"("workspace","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tripwire_entity_jobs" ADD CONSTRAINT "job_capture_fk" FOREIGN KEY ("workspace","capture_id") REFERENCES "public"."tripwire_entity_captures"("workspace","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tripwire_entity_legacy" ADD CONSTRAINT "legacy_entity_fk" FOREIGN KEY ("workspace","entity_id") REFERENCES "public"."tripwire_entities"("workspace","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tripwire_entity_lineage" ADD CONSTRAINT "lineage_evidence_fk" FOREIGN KEY ("workspace","evidence_id") REFERENCES "public"."tripwire_entity_evidence"("workspace","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tripwire_entity_observations" ADD CONSTRAINT "observation_development_fk" FOREIGN KEY ("workspace","development_id") REFERENCES "public"."tripwire_entity_developments"("workspace","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tripwire_entity_observations" ADD CONSTRAINT "observation_evidence_fk" FOREIGN KEY ("workspace","evidence_id") REFERENCES "public"."tripwire_entity_evidence"("workspace","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tripwire_entities" ADD CONSTRAINT "entity_org_fk" FOREIGN KEY ("workspace","organization_id") REFERENCES "public"."tripwire_entities"("workspace","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tripwire_entities" ADD CONSTRAINT "entity_redirect_fk" FOREIGN KEY ("workspace","redirect_id") REFERENCES "public"."tripwire_entities"("workspace","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "assertion_global_id" ON "tripwire_entity_assertions" USING btree ("id");--> statement-breakpoint
CREATE UNIQUE INDEX "capture_global_id" ON "tripwire_entity_captures" USING btree ("id");--> statement-breakpoint
CREATE INDEX "entity_decisions_history" ON "tripwire_entity_decisions" USING btree ("workspace","entity_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "development_global_id" ON "tripwire_entity_developments" USING btree ("id");--> statement-breakpoint
CREATE UNIQUE INDEX "evidence_global_id" ON "tripwire_entity_evidence" USING btree ("id");--> statement-breakpoint
CREATE INDEX "entity_jobs_due" ON "tripwire_entity_jobs" USING btree ("workspace","status","next_run");--> statement-breakpoint
CREATE UNIQUE INDEX "entity_global_id" ON "tripwire_entities" USING btree ("id");--> statement-breakpoint
CREATE INDEX "entity_registry_search" ON "tripwire_entities" USING btree ("workspace","state","type");