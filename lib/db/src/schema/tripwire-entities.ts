import { sql } from "drizzle-orm";
import { pgTable, text, integer, boolean, jsonb, timestamp, unique, uniqueIndex, primaryKey, foreignKey, index, check } from "drizzle-orm/pg-core";
import { tripwireContent } from "./tripwire-content";

const time = (name: string) => timestamp(name, { withTimezone: true });
const scope = () => text("workspace").notNull();
export const entityRegistry = pgTable("tripwire_entities", {
  id: text("id").notNull(), workspace: scope(), name: text("name").notNull(),
  type: text("type").notNull(), facets: text("facets").array().notNull().default(sql`'{}'`),
  aliases: text("aliases").array().notNull().default(sql`'{}'`),
  organizationId: text("organization_id"), redirectId: text("redirect_id"),
  classification: text("classification").notNull().default("contextual"),
  state: text("state").notNull().default("Discovered"), priority: integer("priority").notNull().default(2),
  rationale: text("rationale").notNull(), pinned: boolean("pinned").notNull().default(false),
  unresolved: boolean("unresolved").notNull().default(false),
  lastDevelopment: time("last_development"), nextReview: time("next_review"),
  createdAt: time("created_at").notNull().defaultNow(),
}, t => [
  primaryKey({ columns: [t.workspace, t.id] }), uniqueIndex("entity_global_id").on(t.id),
  foreignKey({ name: "entity_org_fk", columns: [t.workspace, t.organizationId], foreignColumns: [t.workspace, t.id] }),
  foreignKey({ name: "entity_redirect_fk", columns: [t.workspace, t.redirectId], foreignColumns: [t.workspace, t.id] }),
  index("entity_registry_search").on(t.workspace, t.state, t.type),
  check("entity_type", sql`${t.type} in ('person','position','organization','company','capability','issue','event')`),
  check("entity_state", sql`${t.state} in ('Discovered','Active','Watch','Archived')`),
  check("entity_class", sql`${t.classification} in ('structural','strategic','contextual')`),
  check("entity_priority", sql`${t.priority} between 1 and 3`),
  check("entity_anchor", sql`${t.classification} <> 'structural' or ${t.type} in ('organization','position')`),
]);

export const entityCaptures = pgTable("tripwire_entity_captures", {
  id: text("id").notNull(), workspace: scope(), articleId: text("article_id").notNull(),
  captureId: text("capture_id").notNull(), hash: text("hash").notNull().references(() => tripwireContent.hash),
  source: text("source").notNull(), url: text("url"), publishedAt: time("published_at"),
  capturedAt: time("captured_at").notNull(), complete: boolean("complete").notNull(),
  authorized: boolean("authorized").notNull().default(false),
  byline: text("byline"), publisher: text("publisher"),
}, t => [primaryKey({ columns: [t.workspace, t.id] }), uniqueIndex("capture_global_id").on(t.id),
  unique("capture_version").on(t.workspace, t.articleId, t.captureId, t.hash)]);

export const entityEvidence = pgTable("tripwire_entity_evidence", {
  id: text("id").notNull(), workspace: scope(), captureId: text("capture_id").notNull(),
  excerpt: text("excerpt").notNull(), start: integer("start").notNull(), end: integer("end").notNull(),
  attribution: text("attribution").notNull(), certainty: text("certainty").notNull(),
  scope: text("scope").notNull(), extractorVersion: text("extractor_version").notNull(),
  policyVersion: text("policy_version").notNull(), recordedAt: time("recorded_at").notNull().defaultNow(),
}, t => [primaryKey({ columns: [t.workspace, t.id] }), uniqueIndex("evidence_global_id").on(t.id),
  foreignKey({ name: "evidence_capture_fk", columns: [t.workspace, t.captureId], foreignColumns: [entityCaptures.workspace, entityCaptures.id] }),
  check("evidence_offsets", sql`${t.start} >= 0 and ${t.end} > ${t.start}`),
  check("evidence_certainty", sql`${t.certainty} in ('asserted','attributed','alleged','disputed','inferred','confirmed')`)]);

export const entityAssertions = pgTable("tripwire_entity_assertions", {
  id: text("id").notNull(), workspace: scope(), subjectId: text("subject_id").notNull(),
  predicate: text("predicate").notNull(), objectId: text("object_id"), value: text("value"),
  evidenceId: text("evidence_id").notNull(), eventId: text("event_id"),
  certainty: text("certainty").notNull(), status: text("status").notNull().default("candidate"),
  validFrom: time("valid_from"), validTo: time("valid_to"), tenure: text("tenure"),
  supersedesId: text("supersedes_id"), disputesId: text("disputes_id"),
  recordedAt: time("recorded_at").notNull().defaultNow(),
}, t => [primaryKey({ columns: [t.workspace, t.id] }), uniqueIndex("assertion_global_id").on(t.id),
  foreignKey({ name: "assert_subject_fk", columns: [t.workspace, t.subjectId], foreignColumns: [entityRegistry.workspace, entityRegistry.id] }),
  foreignKey({ name: "assert_object_fk", columns: [t.workspace, t.objectId], foreignColumns: [entityRegistry.workspace, entityRegistry.id] }),
  foreignKey({ name: "assert_event_fk", columns: [t.workspace, t.eventId], foreignColumns: [entityRegistry.workspace, entityRegistry.id] }),
  foreignKey({ name: "assert_evidence_fk", columns: [t.workspace, t.evidenceId], foreignColumns: [entityEvidence.workspace, entityEvidence.id] }),
  foreignKey({ name: "assert_supersedes_fk", columns: [t.workspace, t.supersedesId], foreignColumns: [t.workspace, t.id] }),
  foreignKey({ name: "assert_disputes_fk", columns: [t.workspace, t.disputesId], foreignColumns: [t.workspace, t.id] }),
  check("assertion_time", sql`${t.validFrom} is null or ${t.validTo} is null or ${t.validTo} >= ${t.validFrom}`),
]);
export const entityIdentifiers = pgTable("tripwire_entity_identifiers", {
  id: text("id").primaryKey(), workspace: scope(), entityId: text("entity_id").notNull(),
  namespace: text("namespace").notNull(), value: text("value").notNull(), evidenceId: text("evidence_id").notNull(),
}, t => [unique("entity_identifier_unique").on(t.workspace, t.namespace, t.value),
  foreignKey({ name: "identifier_entity_fk", columns: [t.workspace, t.entityId], foreignColumns: [entityRegistry.workspace, entityRegistry.id] }),
  foreignKey({ name: "identifier_evidence_fk", columns: [t.workspace, t.evidenceId], foreignColumns: [entityEvidence.workspace, entityEvidence.id] })]);

export const entityLineage = pgTable("tripwire_entity_lineage", {
  id: text("id").primaryKey(), workspace: scope(), evidenceId: text("evidence_id").notNull(),
  originKey: text("origin_key"), relation: text("relation").notNull().default("unknown"),
  independentlyReported: boolean("independently_reported").notNull().default(false),
  rationale: text("rationale").notNull(), assessedBy: text("assessed_by").notNull(),
}, t => [foreignKey({ name: "lineage_evidence_fk", columns: [t.workspace, t.evidenceId], foreignColumns: [entityEvidence.workspace, entityEvidence.id] }),
  unique("lineage_evidence").on(t.workspace, t.evidenceId)]);

export const entityDecisions = pgTable("tripwire_entity_decisions", {
  id: text("id").primaryKey(), workspace: scope(), entityId: text("entity_id").notNull(),
  origin: text("origin").notNull(), action: text("action").notNull(), rationale: text("rationale").notNull(),
  previous: jsonb("previous").$type<Record<string, unknown>>().notNull(),
  result: jsonb("result").$type<Record<string, unknown>>().notNull(),
  dimensions: jsonb("dimensions").$type<Record<string, number>>().notNull(),
  evidenceIds: text("evidence_ids").array().notNull(), policyVersion: text("policy_version").notNull(),
  createdAt: time("created_at").notNull().defaultNow(),
}, t => [foreignKey({ name: "decision_entity_fk", columns: [t.workspace, t.entityId], foreignColumns: [entityRegistry.workspace, entityRegistry.id] }),
  index("entity_decisions_history").on(t.workspace, t.entityId, t.createdAt)]);

export const entityLegacy = pgTable("tripwire_entity_legacy", {
  id: text("id").primaryKey(), workspace: scope(), watchId: text("watch_id").notNull(),
  entityId: text("entity_id").notNull(), original: jsonb("original").notNull(),
}, t => [unique("legacy_watch").on(t.workspace, t.watchId),
  foreignKey({ name: "legacy_entity_fk", columns: [t.workspace, t.entityId], foreignColumns: [entityRegistry.workspace, entityRegistry.id] })]);

export const entityCandidates = pgTable("tripwire_entity_candidates", {
  id: text("id").primaryKey(), workspace: scope(), entityId: text("entity_id").notNull(),
  matchId: text("match_id"), evidenceId: text("evidence_id"),
  reason: text("reason").notNull(), resolution: text("resolution").notNull().default("pending"),
  identityConfidence: text("identity_confidence").notNull().default("unresolved"),
  createdAt: time("created_at").notNull().defaultNow(),
}, t => [
  foreignKey({ name: "candidate_entity_fk", columns: [t.workspace, t.entityId], foreignColumns: [entityRegistry.workspace, entityRegistry.id] }),
  foreignKey({ name: "candidate_match_fk", columns: [t.workspace, t.matchId], foreignColumns: [entityRegistry.workspace, entityRegistry.id] }),
  foreignKey({ name: "candidate_evidence_fk", columns: [t.workspace, t.evidenceId], foreignColumns: [entityEvidence.workspace, entityEvidence.id] }),
]);

export const entityDevelopments = pgTable("tripwire_entity_developments", {
  id: text("id").notNull(), workspace: scope(), eventKey: text("event_key").notNull(),
  claimKey: text("claim_key").notNull(), title: text("title").notNull(), explanation: text("explanation").notNull(),
  disposition: text("disposition").notNull(), status: text("status").notNull().default("open"),
  entityIds: text("entity_ids").array().notNull(), policyVersion: text("policy_version").notNull(),
  createdAt: time("created_at").notNull().defaultNow(),
}, t => [primaryKey({ columns: [t.workspace, t.id] }), uniqueIndex("development_global_id").on(t.id),
  unique("development_material_change").on(t.workspace, t.eventKey, t.claimKey)]);
export const entityObservations = pgTable("tripwire_entity_observations", {
  id: text("id").primaryKey(), workspace: scope(), developmentId: text("development_id").notNull(),
  evidenceId: text("evidence_id").notNull(), novelty: text("novelty").notNull(),
}, t => [
  foreignKey({ name: "observation_development_fk", columns: [t.workspace, t.developmentId], foreignColumns: [entityDevelopments.workspace, entityDevelopments.id] }),
  foreignKey({ name: "observation_evidence_fk", columns: [t.workspace, t.evidenceId], foreignColumns: [entityEvidence.workspace, entityEvidence.id] }),
  unique("development_observation").on(t.workspace, t.developmentId, t.evidenceId),
]);
export const entityAutomation = pgTable("tripwire_entity_automation", {
  workspace: text("workspace").primaryKey(), mode: text("mode").notNull().default("observe"),
  epoch: integer("epoch").notNull().default(0), authorized: boolean("authorized").notNull().default(false),
  privateMaterial: boolean("private_material").notNull().default(false),
  policyVersion: text("policy_version").notNull().default("evidence-v1"),
  policy: jsonb("policy").$type<Record<string, number>>().notNull().default(sql`'{}'::jsonb`),
  // Ten conservative 74,192-token reservations fit under the initial $1/day
  // pilot with a separately configured $0.10 worst-case call reservation.
  dailyTokens: integer("daily_tokens").notNull().default(750000),
  dailyMicros: integer("daily_micros").notNull().default(1000000),
  budgetDay: text("budget_day"), usedTokens: integer("used_tokens").notNull().default(0),
  usedMicros: integer("used_micros").notNull().default(0),
  lastSuccess: time("last_success"), failures: integer("failures").notNull().default(0),
  captureCursor: text("capture_cursor"),
});
export const entityJobs = pgTable("tripwire_entity_jobs", {
  id: text("id").primaryKey(), workspace: scope(), captureId: text("capture_id").notNull(),
  policyVersion: text("policy_version").notNull(), status: text("status").notNull().default("queued"),
  leaseOwner: text("lease_owner"), leaseUntil: time("lease_until"), epoch: integer("epoch"),
  attempts: integer("attempts").notNull().default(0), nextRun: time("next_run").notNull().defaultNow(),
  checkpoint: text("checkpoint"), tokens: integer("tokens").notNull().default(0),
  costMicros: integer("cost_micros").notNull().default(0), error: text("error"),
  createdAt: time("created_at").notNull().defaultNow(), completedAt: time("completed_at"),
}, t => [unique("job_capture_policy").on(t.workspace, t.captureId, t.policyVersion),
  foreignKey({ name: "job_capture_fk", columns: [t.workspace, t.captureId], foreignColumns: [entityCaptures.workspace, entityCaptures.id] }),
  index("entity_jobs_due").on(t.workspace, t.status, t.nextRun)]);
export const entityControlLog = pgTable("tripwire_entity_control_log", {
  id: text("id").primaryKey(), workspace: scope(), origin: text("origin").notNull(),
  action: text("action").notNull(), previous: jsonb("previous").notNull(), result: jsonb("result").notNull(),
  createdAt: time("created_at").notNull().defaultNow(),
});
