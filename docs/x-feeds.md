# Outlet X feeds

## Active mode: free public-page collection

The user replaced the paid-access setup request with “just scrape the account.”
`X_COLLECTION_MODE=public-page` selects direct HTTPS reads of the approved public
profiles. With `X_COLLECTION_APPROVED=true`, the collector checks the 28 reporter
accounts every 30 minutes while this server runs; the ten outlet accounts remain
outside the active scope. Existing pauses and removals still apply. A cycle reads
at most five accounts, so a new activation takes several minutes to check all
accounts. Daily limits are 1,500 profile requests and 10,000 post samples;
operators can lower but not exceed these public-mode caps.

No X API credential, subscription or provider billing configuration is needed.
The public adapter never calls X API endpoints, sends authentication/cookies,
executes page scripts, follows login redirects, uses scraping proxies, or fetches
linked articles. It decodes JSON data already present in the public HTML, retaining
available text, status IDs, provider dates, author relationships and profile-photo
URLs. Old pinned posts and posts attributable only to another account are excluded.

**Best effort, not guaranteed complete tracking:** X currently serves only a small
sample (up to 20 retained posts per account per check; often fewer). Posts can be
omitted, delayed or out of order. There is no public-page pagination/backfill.
Blocked, login-required and changed-format pages are explicit failures, not empty
successful feeds. They preserve retained data; HTTP 429 uses durable backoff.
An empty result counts as success only when an identifiable public profile and
recognized empty timeline structure are both present.

Public samples use `x-public-page` provenance and do not advance official API
checkpoints. Every visible sample is checked for deduplication, including IDs older
than the previously newest sample, to retain later-visible posts. Manual edits,
dismissals, true author attribution and existing Claims safeguards are preserved.
Public request/sample counters and backoff are separate from the unused paid
trial. Nothing starts its seven-day clock or spends its allowance in public mode.
Hosting resources remain separate; no publishing or always-on hosting was enabled.

The optional paid API configuration below remains disabled and is **not required
for the active public-page mode**. Switching to paid API collection would still
require its credential and billing approvals.

## Optional paid API: approved seven-day reporter trial

The user approved **$25 maximum for seven days**, not ongoing collection or a
deployment. Startup prepares the trial idempotently: only the 28 reporter
accounts are eligible; outlet accounts are paused once, and removed watches
and existing reporter pauses remain respected. The clock starts with the first
authorized API request. Restarts and UTC day changes never reset its lifetime
allowance or deadline; there is no automatic renewal.

Before activation, create a dedicated app at https://console.x.com, set its
**$25 billing-cycle spending limit**, leave **auto-recharge off**, and supply
`X_API_BEARER_TOKEN` through Replit Secrets. Never paste the token into chat.
Set `X_PROVIDER_LIMIT_CONFIRMED=true` only after the user confirms those billing
settings. Both the token and confirmation are required before any trial API use.

Prepared runtime settings: `X_COLLECTION_APPROVED=false` until secure setup is complete,
`X_PROVIDER_LIMIT_CONFIRMED=false`, `X_POLL_INTERVAL_MINUTES=30`,
`X_DAILY_REQUEST_LIMIT=1500`, `X_DAILY_POST_LIMIT=10000`.
The interval is configurable but cannot go below 30 minutes in this trial.
Enable `X_COLLECTION_APPROVED` only after the token and billing confirmation are
in place and the trial-enabled code is the running version. The user's bounded
approval is recorded; the operational activation switch remains off for safety.
The first sample remains at most 20 recent posts per reporter. The seven-day
deadline is enforced before every API request, including manual checks and lookups.

The app reserves worst-case resources, then reconciles successful responses
against returned posts/users including expansions. Estimates use $0.005/post
and $0.01/user without assuming deduplication or free credits. Successful empty
checks release unused reservations; failed, interrupted or malformed responses
retain theirs. The UI separates returned resources, estimated returned cost,
committed allowance and unreconciled requests. These are not an invoice:
provider billing is authoritative, prices can change, and the provider spending
limit is required. Hosting is separate and collection runs only while the
server runs. The historical/general controls below also remain applicable;
trial-specific scope, interval and lifetime allowance take precedence.

News Media → **X Feeds** (`/outlets?tab=x-feeds`) groups the ten original outlet
accounts and the user-approved full shortlist of 28 reporters under ten existing
outlets, including NBC and ABC. X polling and account switches are separate
from RSS. Existing manual X imports remain supported; a status ID identifies a
post across `twitter.com`, `x.com`, renamed handles and `/i/web/status/` links.
Linked articles are never fetched or merged with their posts.

## Safe default / authorization

In **API mode**, collection is **disabled, setup required** unless all of the following exist:

- `X_API_BEARER_TOKEN`: an official X API v2 application bearer credential with
  public user lookup and user timeline read access. Store it server-side in
  Replit Secrets; never use a `VITE_` variable or paste a credential in chat.
- `X_COLLECTION_APPROVED=true`: an operator records this only after the user
  separately approves the runtime access arrangement, any paid setup, and limits.
- `X_DAILY_REQUEST_LIMIT`: approved positive integer, shared across all accounts,
  user lookup, scheduled checks and manual refreshes.
- `X_DAILY_POST_LIMIT`: approved integer of at least 80 post-read units.

No values are set by this change, no X plan is purchased and no paid calls are
made to verify setup. Do not assume archived credentials remain available.
The managed read-only agent X callback described in Replit's external API
reference is not a callable application integration. The integration catalog's
workspace X API connection currently requires workspace-managed configuration;
this implementation instead supports the explicit official bearer-credential path.
Do not copy agent proxy credentials into runtime code.

Before activation, ask the user to approve a specific request/day and post-unit/day
cap using their X access pricing, including lookup and expanded references.
These are usage limits, not a guaranteed dollar cap or permission to purchase a
subscription. Configure any monetary cap available at X as well. Then add the
secret, set approved non-secret limits and restart the API workflow. If access or
approval is absent, retain the disabled setup-required state.

## Collection behavior

- First check: up to **20 recent posts per account**, not a historical backfill.
- Subsequent checks: incremental `since_id`, one page per due account per cycle,
  at most five account pages plus one batched unresolved-user lookup per cycle.
- Each account is due at most once every ten minutes. The server checks due
  work every minute, oldest checked first. Manual **Check now** uses exactly the
  same due gates, daily reservation counters, backoff and database lock.
- A page reserves **80 post-read units** before the call: up to twenty timeline
  posts plus up to three expanded relationship posts each. Reservations are
  deliberately conservative, including failures and empty results; these are not
  provider billing totals. User reads are bounded by request count and 38 seeded
  accounts. Adding reporter watches does not increase approved usage caps.
  Limits reset at midnight UTC, and lowering limits never resets usage.
- Provider IDs are cached durably. Replies, reposts and quotes retain reference
  IDs and available original authors/text separately from the watched author's
  post. Expanded content is not independent sourcing or verified reporting.
- All available returned text and raw capture provenance are retained. Text
  completeness is **not** asserted, even when an expanded `note_tweet` exists.
- Checkpoints and pagination tokens are server-only. Each page and checkpoint
  commit atomically; a failed request/page leaves the prior checkpoint intact.
  A partially completed page chain resumes after restart using its pinned
  `since_id` and next-page token, not an advanced high-water mark.
- After 100 continuation pages, catch-up stops visibly for operator review
  without advancing past unprocessed results. Expired/invalid tokens similarly
  fail visibly; no automatic skip or scraping fallback.
- Pausing/removing a watch is durable; routine startup never resurrects it.
  Existing matching legacy X watches are reconciled and their pause/delete state
  is respected. Removal through the dedicated API retains existing coverage.
- Polling runs **only while the API server is running**. Downtime can exceed X's
  timeline retention and cannot guarantee recovery of every intervening post.
  Nothing here deploys the app or changes entity-automation authorization.

## Health and testing

### Reporter, feed and Claims alignment

Journalist profiles unify an X account with existing article coverage using exact
names and an explicit roster-alias list, never fuzzy matches. Original article
bylines remain unchanged. Each profile has separate Articles and X Posts
sections; article counts and article-based sorting exclude social posts. Nested
outlet coverage uses each item's actual recorded outlet, not the reporter's most
common publisher. Outlet accounts do not become journalist profiles.

Account rows link to journalist profiles. Newly collected posts retain the
monitored account name/type; the reader links back to that profile, and Feed
search includes that name and handle. Account affiliation is not an official
institutional statement. Manual X imports can align through exact status URLs
without adding fabricated article credits.

The existing retained-content database trigger already queues local Claims
processing; no new paid model or retrieval service is activated. Original post
statements follow that pipeline with exact retained passages and `@handle`
capture attribution. Exact proposition families may link reporting across
articles/posts; this never certifies truth or independent sourcing. Reposts and
visibly truncated X bodies instead finish as no-claims with an explanatory
message, and explicit retries cannot bypass these guards. Expanded quoted post
text remains relationship context, not part of the watched account's body.
Existing historical claims are not deleted or silently rewritten.

Each collector cycle selects at most five due watches before resolving IDs.
Partial user-lookup results preserve valid accounts; an unavailable handle gets
its own status/backoff and does not block cached IDs or other valid accounts.
Account-local timeline errors also leave other due accounts eligible. Shared
credential, rate-limit and usage-limit failures still defer collection globally.

Reporter rows show their full names, X handles and portrait icons. The curated
roster is in `tripwire-x-reporters.ts`; its nine initial portraits are explicitly
matched publisher-bio images, not generic images from recent stories. These
public HTTPS image URLs are rendered directly with no-referrer and lazy loading;
image bytes are not stored in PostgreSQL or Git. Failed/missing photos fall back
to name initials, while outlet accounts retain outlet branding. A user may
supply the remaining portraits with filenames matching names or handles.

Authorized user lookup requests `profile_image_url` along with the existing
batched ID lookup, without an extra API request. Only HTTPS `pbs.twimg.com`
profile-image paths are accepted. Returned photos are retained with account
metadata. Photo display and reporter configuration do not enable paid polling.

The API distinguishes setup-required, paused, not-checked, ok, empty, catch-up,
catch-up-limited, rate-limited, budget-limited, account-unavailable, access-denied
and unavailable/invalid-response. Last check, last success and next due times are
separate. Sanitized messages never include provider bodies or credentials.

`pnpm test` includes mocked API cases and a child-process persistence test using
a newly created, dedicated PostgreSQL schema with **no public search-path
fallback**. The child owns all fake credentials, approval controls and posts;
the running server cannot observe them. The schema is dropped afterward.
Browser verification must use browser-scoped responses rather than shared-feed
fixtures; never activate live billing just to test UI.
