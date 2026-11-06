# Tripwire entity automation: security and activation reference

## Scope and trust boundaries

The attachment defines research scope, not verified appointments or reporting.
Private publishing is the only access boundary. The fixed `workspace` scope is
not authentication. Everyone admitted has equal analyst permissions. No new
login, identity headers, roles, external alerts or publication are introduced.

Flows: authorized publisher/RSS captures → immutable PostgreSQL content →
workspace capture references → leased extraction jobs → validated proposals →
deterministic policy → append-only decisions and development observations →
registry and feed. Private paste/file captures are excluded by default.
Public intake must never receive workspace profiles, evidence or decisions.
Binary originals continue in private App Storage; text/raw versions stay in SQL.

Fetched documents and model output are hostile data. Fetching validates and pins
DNS addresses on every hop, applies one total deadline, rejects private/special
addresses, and bounds compressed and decompressed bytes. Parsers reject XML
entities. Extraction has no tools, browsing, SQL, shell or policy-writing
capability. Only the approved excerpt is sent; never notes, registry or secrets.
Quoted passages must exactly match retained text, including offsets. A capture
hash identifies a version, not authenticity. Database audit records are not
cryptographically tamper-proof.

## Staged policy

Default: observe-only, provider unconfigured, external processing unauthorized.
Pause increments a fencing epoch; stale workers cannot commit. Observe-only
creates candidates and proposed triage, never automatic activation or Immediate
alerts. An analyst can make reversible decisions with a required reason.

Five dimensions (authority, relationship, involvement, significance, continuing
relevance) range 0–4. Scores measure relevance, not truth. Model-proposed values
do not satisfy evidence gates or establish source independence. Initial weights
are equal; configurable weights/cutoffs are versioned and require calibration.

Promotion routes require exact passage evidence plus analyst-assessed sourcing:
confirmed assumption of an approved anchor position; a consequential substantive
single report; or independently reported additions with distinct evidenced
origins. Nominations and rumor do not establish occupancy. Missing identity,
lineage, sourcing or incomplete text routes to review, not automatic promotion.
Journalists remain News Media credits; unnamed sources retain descriptions only.

Structural anchors can only be organizations/positions, never their occupants.
Strategic/contextual entities review initially at 30 days, then 90 days.
Unresolved issues, current authority, structural anchors and manual pins prevent
automatic inactivity archival. Collection failure never establishes inactivity.
Corrections supersede decisions/assertions visibly; history is not rewritten.
Merges are explicit reversible redirects, not destructive rewrites.

Development deduplication uses event + specific material claim, not headlines,
mention count or sentiment. Distinct material changes in one event stay distinct.
Unknown originality/conflict → Review; amplification/syndication → Collection.
Immediate requires analyst-assessed material novelty and sourcing; membership
alone never grants alert eligibility. Allegations remain allegations.

## Release gates (unmet until independently recorded)

- [ ] Verify actual published private access with a signed-out browser, UI,
  API, evidence, upload/download and mutation routes, proxy and direct origins.
  A flag, CORS response or fixed identity is not proof. No production deployment
  has been verified as part of this implementation.
- [ ] Review labeled real reporting and all acceptance fixtures: zero false
  identity merges, unsupported promotions, attribution losses or duplicate
  Immediate alerts in high-risk cases. Calibrate relevance weights/cutoffs.
- [ ] Explicit analyst activation approval and approved content/provider budget.
- [ ] Always-on service/worker hosting verified. Process intervals stop during
  sleep; persisted leases/queue enable recovery, not scheduling while asleep.

Activation must remain blocked until all gates are documented by an operator;
the browser cannot self-attest deployment security. Never deploy automatically.
Provider setup is a separate explicit operator action; missing configuration
leaves ordinary intake and manual registry work operational.

## Operations and rollback

Entity schema changes use generated, versioned SQL in `lib/db/migrations/entities`
and `migrate-entities.mjs`, invoked by the normal database push command. Do not
run introspection-based push over these tables: the installed migration tool
cross-joins composite foreign-key columns and can propose dropping valid
referenced constraints. Generate the next entity migration using
`drizzle.entities.config.ts`; never edit an already applied migration.

Inspect job health, partial/excluded captures, last success, deferred budgets,
dead letters and source collection health separately. Failures do not lower
entity relevance. Workers poll SQL, reclaim expired leases, bound attempts,
reserve worst-case costs/tokens before calls and never refund uncertain charges.
Retry dead letters explicitly after fixing their cause.

Emergency rollback: pause automation first (fences in-flight decisions), stop
the worker, restore the prior UI/compatibility projection from a checkpoint.
Keep all entity/evidence/capture/decision tables and legacy mappings. Migration
is additive/idempotent and does not edit watches or original bylines; disabling
the registry restores the original watch view without deleting history.
