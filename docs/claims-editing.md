# Claims editing

## Choose the scope

- **Correct focus** beside an article, or **Article focus · Edit** in Feed:
  moves that article to one primary home. Search existing groups or enter a
  readable label and primary category. **Return to automatic** removes only
  this article's override.
- **Edit group** beneath a Claims focus heading: changes a shared group's
  readable label/category, including future articles assigned to that group.
  The preview lists up to 50 affected articles and the full count. Confirm the
  scope and provide a reason. **Remove shared correction** restores underlying
  labels/categories without clearing article-only choices.
- **Edit selected articles** in that editor: check individual articles or the
  current page, choose a focus category/label together or return the checked
  articles to automatic placement, enter a reason, confirm, and save once.
  Selection persists across pages of 50, with a maximum of 100 articles per save.
  This changes only checked articles, never the shared label or future articles.
  The entire selection commits atomically or not at all; stale group membership
  requires reopening the preview. Exact retries cannot duplicate corrections.
- **Edit claim wording and notes** in claim details: edits the shared claim's
  analyst wording, tag, notes and legacy manual observations. The claim tag is
  not an article placement control. A correction reason is required.
- **Correct claim association** on a retained passage: reassigns that exact
  article passage to another existing claim, or excludes it from active claim
  coverage. Original quotations, captures, offsets and associations are retained.
  Choosing the original claim again restores its active association.

Direction and sourcing reviews remain separate analyst assessments. Reviews
preceding an association correction remain historical and do not automatically
establish independent support for a new claim.
Claim-scoped coverage totals exclude reassigned/excluded passages and their
historical source context. Historical quotations and associations remain visible,
separately labelled, including intermediate reassignment history. Article-scoped
source inventories remain article-wide.

## Safety and freshness

Focus details repeat the preview's article/claim counts and reporting dates
using the same filtered scope. Individual claim details show their own reporting
scope rather than borrowing a whole group's totals. Secondary topic tags and
related subjects are collapsed below Developments.

Claims' header-to-search area is reserved for recent reporting prompts.
These use precise publication timestamps within the last 12 hours, not
ingestion/edit times, date-only values, or future timestamps. Existing Feed
headline-development indicators or effective High/Critical prominence qualify
coverage; these are reading signals, not verified outcomes or independence
judgments. Older reporting cannot supply a fresh alert's signal or count.
Each prompt retains its source headline and exact Feed article navigation,
with focus links only where the current coverage summary supplies them.
The area disappears when no coverage qualifies and ages out on a minute tick.
Operational claim extraction counts, retained-version history, and failure
retries live in Dashboard Operations under Claims processing.

Concurrent edits require a fresh revision or group-membership preview. Cancel
does not save. Background publisher/enrichment updates cannot clear an analyst
article placement. Shared group corrections are overlays, not source edits.
Metadata corrections, group history and association history are durable.

No control retrieves the publisher, calls a model, changes monitoring
authorization, or merges claim identities. If link data cannot load, Feed shows
articles without applying claim filters and displays recovery controls; stale
known links are explicitly identified as stale.

## Focus lookup

Focus searches return at most 25 distinct groups per page. Deterministic
automatic-placement metadata is populated in batches of at most 100 only when
the local focus policy changes or metadata is missing. Normal searches use
metadata, not complete retained article bodies. Any change to automatic focus
rules must also change the focus policy version so stored projections refresh.

Database writes inside the workspace article lock reuse the transaction
connection, including catalog reads. The regression suite exercises a pool
limited to two connections. Test reporting lives in private schemas or
browser-scoped responses, never in the shared news feed.
