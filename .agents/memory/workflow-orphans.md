---
name: Stale service processes
description: Recovering managed workflows when older service processes still occupy their ports.
---
A failed managed workflow can coexist with an older, still-serving service
process tree after workspace changes. Check process ownership before changing
ports or starting another server.

**Why:** A responding preview alone does not prove it serves the current build;
an older process can still hold the service port after a managed restart fails.

**How to apply:** Confirm the stale processes belong to the affected app service,
stop only those process trees, then restart the existing managed workflows.
Preserve artifact routing and injected ports; do not create replacement workflows
or stop unrelated services.
