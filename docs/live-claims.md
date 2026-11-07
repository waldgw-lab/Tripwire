# Claims for new retained content

## What runs

New public/workspace article text and newly retained capture hashes are queued
transactionally by the article-write trigger. Metadata-only items wait for
actual text. Flags, title edits and unchanged text do not enqueue duplicate work.
The normal API startup runs the local claim worker every 15 seconds, with at most
five bounded chunks per tick. It has no provider, network, publisher-retrieval
or paid-model calls and does not change entity automation permissions.

This is a conservative local extractor, **not comprehensive semantic analysis**.
It recognizes explicit declarative reporting sentences, preserves allegations,
denials and conditional wording, and stores exact UTF-16 passage references.
Positive/negative assessments concern the literal subject of explicit evaluative
wording; they are not article sentiment, truth judgments or independence
decisions. Ambiguous/negated/conditional claims remain unassessed. Neutral and
other directional interpretations can be corrected explicitly by the analyst.

Only one unambiguous, normalized exact proposition match joins an existing
family. Paraphrases, related topics and ambiguous matches do not get silently
merged. Source descriptions remain article/capture-specific; an unattributed
narrative is marked Article, not invented as a human source. This pipeline
never creates independently reviewed paths or identifies anonymous humans.

The historic Source Search corpus is not automatically swept or reinterpreted.
In the ordinary reader, **Process retained text into claims** explicitly queues
an existing article, including an archive article. It only reads retained text.
It does not fetch the publisher, activate monitoring or replace article content.

## Persistence and corrections

- Jobs are unique by workspace/article/content hash/policy. Primary and newly
  retained shorter versions both count as eligible new content.
- Sentences are processed in resumable 32,000-character/20-claim chunks; passage
  offsets refer to the full retained body. The cursor and writes commit together.
  A sentence larger than the window becomes an explicit failed job, not silently
  clipped evidence.
- Matching article/proposition attributions are reused across captures, with
  separate immutable evidence-version links. Reruns do not inflate article
  attribution totals.
- Original evidence, supplied analysis and analyst edits are preserved.
  Directional corrections append superseding records with an explanation;
  stale corrections are rejected. Automatic processing cannot overwrite them.
- Job failures roll back that chunk, retain prior committed work, and expose an
  error. Up to three automatic attempts are allowed, then Retry remains available.
- Dismissed workspace overrides take precedence over public refreshes.

## Existing screens

Claims shows processing status even with an empty claim list. Recent activity
and errors remain in a closed disclosure, with explicit Retry for failed work.
The screen polls progress every ten seconds and refreshes claim lists, coverage
totals and evidence when job state changes. New results also survive reloads
and become visible to other sessions.

Attributions show a muted directional badge with its subject where supported.
The reason, local-rule/analyst origin and optional correction form are collapsed.
No routine verification action is required for ordinary published attributions.
Multiple retained evidence versions remain accessible under Record identifiers.

`complete` means this local policy processed the retained text, not that every
possible proposition was understood. `no-claims` means no eligible explicit
statements were extracted; it does not assert that the article has no claims.
Publication dates remain separate from ingestion and processing timestamps.

## Verification

`scripts/live-claims.test.mjs` exercises actual triggers, worker and API service
functions in a disposable PostgreSQL schema. It covers metadata-to-text intake,
public/workspace dismissal precedence, exact offsets including Unicode, positive/
negative/mixed and uncertain wording, longer-than-one-chunk articles, repeats
across outlets, changed primary bodies and shorter retained captures, stable
attribution counts, preserved analyst corrections, stale correction rejection,
missing content retries, mid-write interruption and concurrent workers.
No fictional news is inserted into the shared feed.
