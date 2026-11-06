# Entity automation release checklist

## Verified in development

- Additive registry migration keeps legacy IDs, aliases, disabled watches and
  original records; repeated migration does not overwrite analyst decisions.
- Exact passages link to immutable text/raw versions in PostgreSQL; missing or
  fabricated quotations fail closed. Original capture/byline attribution stays.
- Former and acting tenures, disputed relationships, corrections, reversible
  identity redirects, unresolved issues and analyst pins retain history.
- SQL leases, owner/expiry fencing, renewal, recovery, transactional completion,
  candidate idempotency and reserved daily budgets have executable fixtures.
- Unknown lineage, partial captures, nominations, source journalists and
  anonymous descriptions never satisfy automatic promotion gates.
- Model-suggested identifiers remain pending identity hints. An incidental
  quoted value matching an established entity cannot attach assertions to it;
  analyst identity resolution is required before reuse.
- Repeated origin observations group without creating repeated Immediate
  alerts; distinct material changes use separate development keys.
- Source outages and service failures do not reduce relevance.
- Structured output has no tools and cannot change server policy. Quotation,
  identifier, temporal, type, predicate and size validation happen locally.
- Fetch tests cover redirects to private addresses, mixed DNS, DNS pinning,
  IPv4/IPv6 special-use and embedded addresses, decompression and content type
  limits. Browser-origin tests reject foreign mutations and non-JSON actions.
- Existing intake/content/import/classification/publication/attribution/media/
  feed filter/format/signal regressions and canonical typechecks were run.

Commands (run from repository root):

```sh
pnpm run typecheck
scripts/node_modules/.bin/tsx --test scripts/tripwire-*.test.mjs
pnpm --filter @workspace/db run push
```

The database command manages existing tables as before, then applies journaled
entity migrations under a database advisory lock. Re-running it does not
recreate the graph or erase monitoring judgments. Do not edit applied SQL;
generate additive entity migrations using `lib/db/drizzle.entities.config.ts`.

## Required before autonomous production decisions — NOT VERIFIED

1. Publish privately only after explicit user approval. Signed-out tests must
   demonstrate that UI, API, evidence, originals, upload/download and controls
   are inaccessible, including supported proxy/direct-origin routes. Record the
   actual URLs, test time and outcomes securely. An app flag or shared identity
   is not evidence of authentication.
2. Configure a supported managed provider server-side, with the operator's
   approval for third-party content processing and billed usage. No provider
   was provisioned or called during implementation. Set a supported extraction
   model and a conservative worst-case per-call cost cap, plus daily limits.
   Existing intake/manual analysis continue without a provider.
3. Keep observe-only for a reviewed sample of authorized reporting. Check exact
   identity matches, attribution, lineage, consequences and event/claim novelty.
   Explicitly count false merges, unsupported promotions, lost attribution and
   duplicate Immediate alerts; all must be zero in high-risk fixtures. Model
   performance has not been measured against live reporting.
4. Calibrate the five relevance weights/cutoff against that sample. Publish a
   new policy version; observe-only is restored when the policy changes.
5. Verify always-on hosting and multi-worker recovery. A persisted queue does
   not run while the hosting process is asleep.
6. Record evidence references (not booleans) in the operator-maintained
   `docs/entity-automation-release.json`: `privateAccessVerification`,
   `qualityCalibration`, `alwaysOnVerification`, `activationApproval`. Each
   must describe the actual verification. That file is an operator attestation,
   not a substitute for performing the checks or for private publishing.
   Browser controls cannot edit it. Do not include private content/secrets.
   Include `policyVersion` matching the current version; changing policy
   invalidates the prior calibration approval.
7. Authorize approved captures and explicitly activate; use small limits first.
   Private paste/upload material remains excluded unless separately opted in.

## Rollback and emergency pause

Pause in Watchlist → Automation. The epoch fences leases, aborts local provider
requests and stops new calls/decisions without deleting evidence. Stop the API
worker if needed. Restore the prior interface/compatibility projection from a
checkpoint; leave entity/capture/evidence/assertion/decision/job tables intact.
The Organizations compatibility view uses the untouched legacy records.
Restart in observe-only, inspect deferred/dead jobs, repair the cause and retry
explicitly. Never treat a failed source or provider as evidence of inactivity.
