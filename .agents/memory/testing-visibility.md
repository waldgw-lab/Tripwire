---
name: Testing visibility
description: Avoid exposing synthetic article fixtures as real reporting during verification.
---

Do not seed synthetic article fixtures into the user's shared feed for routine browser verification. Use isolated test data or browser-scoped fixtures where possible, without modifying real articles.

**Why:** Temporary queue-testing records appeared as Critical Axios items with unknown publication dates in the user's feed before cleanup, causing understandable concern about ingestion quality.

**How to apply:** Plan fixture isolation before testing. When a persistent integration test is genuinely necessary, use an isolated workspace/data boundary; cleanup alone does not prevent a fixture from appearing while the test runs. Verify absence from the feed and enrichment queue after cleanup.

Tests that change monitoring authorization or budget controls require a separate
database or schema with no fallback to shared tables, not merely a different
article owner.

**Why:** Live background workers can observe temporary permission changes before
a test restores them. Cleanup cannot undo actions taken during that interval.

**How to apply:** Skip control-state integration tests when isolation is absent;
exercise routine article persistence in isolated owners and UI saves with
browser-scoped responses instead of modifying shared reporting.

Full collector tests require an isolated schema, not a test owner argument.

**Why:** Refresh uses the shared collector regardless of its legacy caller
argument; passing a fictional owner does not keep fixtures out of shared intake.

**How to apply:** Isolate every database connection without a public-schema
fallback, replace the source reader with offline fixtures, and exercise the real
admission and cooldown rules rather than weakening them for tests.
