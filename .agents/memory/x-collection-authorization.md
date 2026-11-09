---
name: X collection authorization
description: Runtime X access and paid usage approval are separate from agent API capabilities.
---

Do not treat Replit's managed read-only X callback as an application runtime
integration or as permission to spend on scheduled collection. Keep collection
disabled until authorized runtime access and explicit daily usage limits are
approved in API mode; credentials alone are insufficient.

**Why:** The user authorized automatic outlet collection, not an unbounded paid
subscription or new spend. Archived X setup must not be assumed to remain valid.

**How to apply:** Check current runtime access and approval before enabling paid X
polling. Preserve the API setup-required state when either is absent; do not silently
switch collection methods or fetch linked articles as a fallback. Account chronology, reposts and repeat
coverage never establish independent sourcing.

Approval to add reporter accounts and portrait icons is not approval to activate
billable collection or increase existing caps.

**Why:** The user approved the reporter shortlist and requested profile photos,
without specifying a paid access arrangement or numerical collection limits.

**How to apply:** Add the approved watches and photos while retaining the
existing runtime-access and usage-approval gates.

The user subsequently approved the specific seven-day, $25 maximum trial:
28 reporter accounts, the ten outlet accounts paused, checks every 30 minutes,
up to 20 recent initial posts per reporter, auto-recharge off and no automatic
renewal. This is not approval for ongoing spending or a deployment.

**Why:** The user replied “do that” to that bounded recommendation.

**How to apply:** Prepare these controls now, but require runtime credentials
and confirmation of the provider's $25 billing-cycle limit and auto-recharge
being off before paid API activation. Start the seven-day clock on first authorized
API use; never reset it on a restart or silently renew it.

The user subsequently said “this seems unnecessary- just scrape the account”
instead of completing the paid X billing setup. Use free reads of the requested
public profile pages; bearer credentials and provider billing confirmation are
not prerequisites for that public-page mode. Keep paid API access disabled.

**Why:** The user explicitly requested scraping rather than paid runtime setup.

**How to apply:** Keep the reporter-only scope and bounded 30-minute checks.
Treat public pages as limited samples, not complete timelines. Do not bypass
login/protected content, execute remote scripts, use paid scraping services or
fetch linked articles. Switching back to paid API collection still requires its
separate access and billing safeguards.
