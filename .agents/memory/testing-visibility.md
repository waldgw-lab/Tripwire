---
name: Testing visibility
description: Avoid exposing synthetic article fixtures as real reporting during verification.
---

Do not seed synthetic article fixtures into the user's shared feed for routine browser verification. Use isolated test data or browser-scoped fixtures where possible, without modifying real articles.

**Why:** Temporary queue-testing records appeared as Critical Axios items with unknown publication dates in the user's feed before cleanup, causing understandable concern about ingestion quality.

**How to apply:** Plan fixture isolation before testing. When a persistent integration test is genuinely necessary, use an isolated workspace/data boundary; cleanup alone does not prevent a fixture from appearing while the test runs. Verify absence from the feed and enrichment queue after cleanup.
