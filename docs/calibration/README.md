# Feed calibration and retained feedback

## Supplied evaluation inventory

`sample-inventory.json` contains every supplied sample row, not a deduplicated
story list: 158 LOW, 202 HIGH and 222 CRITICAL. PDF rows retain page references,
visible truncated headlines, full matched headlines, stable article IDs,
publisher URLs, bylines, publication dates and immutable text hashes when
available. No headline ending was invented.

577 rows have unambiguous retained identities. Five remain explicit: two
same-headline Israel-aid rows, two same-headline South-election rows, and one
unmatched Moscow-detention row. Their candidate lists remain in the inventory.
423 rows need further analyst review because relevance is uncertain or retained
text is limited; this is not a claim that all 423 are unimportant. Proposals
were evaluated against available retained text, not outside publisher access or
inferred sourcing.

Planning visually inspected all PDF pages. Execution rendered HIGH page 1 to
confirm the red circles around LeBron James, Photos of the Week, and An Absolute
Beauty. These three retained articles are LOW and dismissed through explicitly
imported annotation events, not fabricated analyst deletion reasons. They can
be viewed and restored from Dashboard feedback. No other article was
automatically suppressed.

`results.json` gives the dated before/after sample distributions, unresolved
rows, archive batch totals and unique changed-article counts. Counts of physical
public records and workspace shadows differ from unique article counts.

## Policy boundaries

Automatic impact measures documented consequence, substantive subject
involvement and available-text confidence. Names, generic positions, stored
entity tags, originality labels, completeness and Immediate/Review/Collection
triage cannot independently establish HIGH or CRITICAL. Reaction-led coverage
is not automatically CRITICAL merely for repeating leadership-removal calls.
Sourcing judgments, sentiment, credits and publication provenance are preserved.

Contextual topic inference excludes artificial-intelligence/agency ambiguity,
basketball operations, labor strikes, figurative strikes, photo credits and
recommendation tails. Unsupported topics are Unclassified, not Politics.
The policy uses the monitoring system's exact-evidence primitive for
source-labeled quotation offsets; it does not rebuild entity monitoring or
activate a model provider.

Sports/lifestyle material with real institutional context is not globally
blocked: LIV Golf remains collection-level coverage. NBC and WSJ's Qeshm
observations remain distinct reporting records and both receive
consequence-based elevated impact. Allegations remain attributed, not verified
by their rating.

## Running the audit and reassessment

Run from the repository root:

```sh
scripts/node_modules/.bin/tsx scripts/src/tripwire-calibration-audit.ts
scripts/node_modules/.bin/tsx scripts/src/tripwire-reassess.ts
scripts/node_modules/.bin/tsx scripts/src/tripwire-calibration-results.ts
```

The audit is read-only. Reassessment uses bounded transactions and a durable
policy-version cursor; startup resumes it without blocking the web server.
Text stays in immutable PostgreSQL blobs, not in the feed payload or copied
into every feedback event. Manual topic and impact overrides remain independent.
Potentially manual legacy edits are preserved with unknown origin rather than
given fabricated attribution.

`tripwire-apply-reviewed-negatives.ts` is an explicit, retry-safe runner for the
three supplied circled annotations only. It requires the matched URL and text
hash still to agree with the audited item. It is not an automatic exclusion
rule or a startup purge.

## Feedback safety and verification

Article dismissal, correction and restoration preserve article metadata and
source manifests and append history atomically. Quick corrections use a
focused field patch, revision comparison and retry key. Generic article saves
preserve overrides, cannot revive dismissed canonical URLs, and cannot bypass
classification reasons. Deleted records never become article-content access
tokens: retained access resolves a workspace-scoped feedback event and article.

Feedback shares the existing record store under an API-inaccessible event
kind; ordinary record list/read/save/delete paths do not expose mutable event
records. No database replacement or new logging service is involved.

The regression suite covers classification, intake, content retention,
publication, paste/import, media, filters and retrieval prioritization. Database
feedback tests use an isolated owner and never seed synthetic shared feed rows.
Browser verification uses browser-local fixtures, while live Dashboard rendering
and retained endpoints are checked separately.
