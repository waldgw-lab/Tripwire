# Source Search backfill and handoff

## Result

Applied to the development database only. No deployment, provider provisioning,
publishing-access change, new role, or live entity-monitoring authorization.
The existing Feed, reader, News Media, Claims and Coverage remain the entry points.

| Measure | Result |
| --- | ---: |
| Physical article rows before / immediately after | 1,042 / 2,488 |
| Unique new articles | 1,446 |
| Existing articles enriched by exact URL | 0 |
| Existing legacy Claims at execution | 0 |
| Supplied attributed claim rows / claim families | 235 / 207 |
| Article-specific source occurrences | 254 |
| Supplied source-environment comparisons linked / unresolved | 33 / 22 |
| Archive captures retained | 57 |
| Complete archive articles / partial archive segments | 2 / 55 |
| Validated excerpt row references / unique evidence passages | 244 / 234 |
| Workbook rows / retained narrative documents | 3,057 / 8 |
| Duplicate article-sheet rows | 201 |
| Invalid article metadata rows quarantined | 5 |
| Other metadata cautions retained | 118 |
| Journaled batch changes | 2,943 |

The 1,441 master rows are not unique-article counts. Journalist sheets contribute
211 more article rows; after invalid rows and URL deduplication the corpus
contains 1,446 candidates. All were new relative to this development snapshot.
Exact-URL enrichment of public rows and workspace overrides was exercised in an
isolated database schema, not fabricated as an actual matching result.

All 1,446 imported identities were verified in the existing workspace response.
The visible feed contained 2,221 total articles at verification; this differs
from physical row totals because public/shadow pairs and dismissed items are
not counted twice or made visible.

## Content and exceptions

- The NYT archive contains **55 distinct URL-bounded entries**, not 55 verified
  complete publisher bodies. One entry's title conflicts with the workbook
  (`trump-iran-negotiations.html`); its text remains retained as an unresolved
  archive segment rather than attached to a potentially wrong story.
- Two WaPo full article copies were structurally inspected and marked complete.
  Their overlapping package/archive copies are retained as document context,
  not duplicate articles. Original extracted source and cleaned body are both
  retained in immutable content storage.
- Max Boot has only the four supplied publisher-style excerpt paragraphs in
  the reader, explicitly partial. Third-person synthesis and the analytical note
  remain package context, never complete publisher text.
- WaPo rows **314, 478, 768, 781 and 954** failed URL/title/outlet consistency.
  Their original rows and dispositions remain retained.
- **22 source-match joins** could not identify exactly one occurrence at both
  ends. No guessed match or confidential-person identity was created.
- All 254 source rows and 235 claim rows received article links. Quote validation
  is literal and position-specific; unsupported, repeated/ambiguous or absent
  quotations remain unvalidated. An exact excerpt validates the text reference,
  **not the truth of a claim or the independence of its source**.
- The 118 metadata cautions include workbook-date versus URL-date differences
  and mixed author/contributor groups. Neither a URL date nor a yearless archive
  header supplies a missing timezone or publication instant. Claim coverage can
  show explicitly labelled supplied calendar dates without pretending they are
  precise publisher timestamps.
- Normalized Document Journalists roles take precedence over Author Group.
  For example, the NYT aircraft-ruse story has Haberman, Schmitt and
  Kanno-Youngs as authors; Rogers, Green and Mills retain contributed-reporting
  credits. No employment or source ownership is inferred.

The pre-existing page-retrieval worker briefly processed some imported
metadata rows after the first normal API restart. Those separately labelled
page captures are retained, not silently removed or attributed to this package.
An archive-specific scheduling guard now prevents automatic retrieval of
backfilled rows unless an analyst explicitly requests an individual retrieval.
This did not enable any provider or change entity automation authorization.
The machine report distinguishes original archive captures from the later
current-content snapshot.

## Worked example

1. Open **Close Trump aides — but no Cabinet officials — made secret catering
   truck move** in the Feed or under Dan Lamothe / The Washington Post in News Media.
2. Its retained source occurrence is the exact phrase
   **“a U.S. official familiar with the operation”**. The external key
   `WAPO-USG-ANON-0001` remains an external key; the occurrence is specific to
   this article/capture.
3. The supplied claim that Scavino, Harp and Nauta accompanied Trump in the
   catering truck is linked to that occurrence. `QUOTE-0169` matches retained
   text and has an immutable evidence reference. The normalized proposition
   itself is not falsely represented as a verbatim quotation.
4. In Source lineage, review the source wording and retained quote before
   attaching the quote to the claim. The event link opens related coverage;
   same-proposition families remain distinct from merely related propositions.
5. An analyst can record new reporting, added evidence, derivative repetition,
   opinion propagation, dispute or unknown lineage, with a rationale. Only an
   explicitly assessed evidence path receives a path key. Corrections append
   a superseding review rather than erase earlier decisions.

This example is **still supplied, unreviewed analysis**, not a seeded analyst
endorsement. Its supplied anonymous minimum and provisional-record count are
both one; reviewed minimum and independent paths remain unknown. The source
family is an information-environment hypothesis, not a person's identity.

Entity evidence and developments can connect to the very same Claims
observation and evidence ID through their existing panels. Development links
require that the development already references that exact evidence; they do
not create a second verification flag or promote legacy entity assessments.

## Reproduce and inspect

From the workspace root:

```sh
python scripts/source-search-inventory.py
node lib/db/migrate-entities.mjs
pnpm --filter @workspace/scripts run source-search:backfill --development-only
pnpm --filter @workspace/scripts run source-search:backfill --development-only --apply
pnpm --filter @workspace/scripts exec tsx source-search-verify.mjs
```

The first command verifies the supplied package's manifest checksums and
extracts every workbook table without executing formulas. Dry-run uses a
transaction that is rolled back and does not store content. Apply uses exact
URL identities, the normal article content/credit services, a workspace edit
lock and a bounded article-table write lock. It does not start an API,
interactive import, provider, scraper or automation job.

The applied input hash is
`dfcb87af1c838798784a70b379e6609bb9e3168a9d8ef9678128600cb32c67d0`.
The batch is `source-search-dfcb87af1c838798784a`. Running the same input again
was confirmed **no-op**.

Authoritative row/segment accounting is persisted in:

- `tripwire_source_batches`: manifest, input hash and final reconciliation.
- `tripwire_source_inputs`: every original workbook row / narrative document,
  its hash and explicit resolution.
- `tripwire_source_changes`: ordered before/after images for only this batch.

The local readable export is
`generated-artifacts/source-search/final-reconciliation.json`.
Generated reports and extracted corpus files are excluded from Git/deployment;
the database remains the durable reconciliation record. Narrative reports,
framing, access profiling, journalist backgrounds and unsupported interpretations
remain retained package context, not current verified facts.

## Rollback

Rehearse without committing:

```sh
pnpm --filter @workspace/scripts run source-search:backfill --development-only \
  --rollback-check source-search-dfcb87af1c838798784a
```

Commit only after checking the output and the effect on subsequent work:

```sh
pnpm --filter @workspace/scripts run source-search:backfill --development-only \
  --rollback source-search-dfcb87af1c838798784a
```

A real 2,943-change rollback rehearsal succeeded immediately after application
and was **not committed**. Isolated fixtures also exercised committed rollback,
interruption, concurrent editing and guarded refusals.

Rollback compares current rows with their batch post-images in a transaction.
Later edits, new evidence dependencies or newly attached entity developments
block the whole rollback rather than delete subsequent work. After normal
background reassessment/retrieval or analyst edits, such a refusal is expected;
inspect and resolve those named conflicts before attempting any selective
removal. Do not force-delete new references or restore a whole database backup.
Immutable content is deliberately retained because other records may reuse it.

## Verification

- Full workspace typecheck.
- 54 focused checks across the new isolated-schema suite and existing
  content, identity, publication, credits, WaPo cleanup and retrieval-priority
  tests; no fictional news was inserted into the shared feed.
- All 234 unique seeded excerpt offsets checked against retained capture text.
- Real workspace visibility, article reader content, role-specific credits,
  Boot partial-content treatment, batch no-op and noncommitting rollback.
- Existing Claims/reader/News Media workflow inspected in the running app;
  browser form-write requests are intercepted rather than persisting test
  analyst judgments on real reporting.

No independently reviewed evidence paths or source-identity decisions were
created by the backfill. Monitoring authorization and private-content
authorization remain unchanged.
