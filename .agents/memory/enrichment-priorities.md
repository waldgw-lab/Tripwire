---
name: Enrichment priorities
description: User-directed retrieval priorities and the meaning of the Dashboard's recent Critical queue.
---

Prioritize extra publisher-page retrieval for Critical items before High items. Low items should keep content supplied at ingestion, without recurring extra page-enrichment requests. An explicit per-item user request can still fetch a Low item.

**Why:** The user asked to prioritize Critical content and omit Low enrichment unless the content is easy to obtain at ingestion.

**How to apply:** Keep scheduler prominence aligned with the rating shown in the feed, including manual overrides. Preserve RSS text regardless of rating, and retain publisher backoff and access rules.

Default the feed's Impact selections to Critical and High, leaving Low unchecked but manually selectable.

**Why:** The user explicitly asked to filter out Low items by default without removing the ability to show them.

**How to apply:** Reset should restore that default. This is a visibility preference, not permission to delete Low items or stop retaining their available source content.

The recent Critical queue is based on ingestion/discovery within the last 12 hours, not publication time or the time an article's metadata was edited.

**Why:** The user asked for “items ingested in the last 12 hours.” An older story can be newly ingested, while creating an editable copy must not make an older intake appear new.

**How to apply:** Prefer the original discovery time when available, otherwise original record creation. RSS summaries alone do not count as article-body enrichment.

Quick pastes must be retained durably before acknowledging a queued save, and use the same analyzer and credit handling as normal imports.

**Why:** The user wants to submit multiple articles without waiting for each analysis/save, with collapsed editors rather than a blocking form.

**How to apply:** Keep failures recoverable, preserve original source text, and do not infer confirmed completeness merely because a paste was accepted.
