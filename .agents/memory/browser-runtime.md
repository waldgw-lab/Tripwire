---
name: Browser runtime
description: Choosing a compatible browser for repeatable local regression checks on Replit.
---
Prefer the environment-provided Chromium for browser checks on Replit; do not
assume downloading Playwright's Chromium also supplies a usable Linux runtime.

**Why:** A downloaded browser failed before any assertions with a missing
`libglib-2.0.so.0`, while the provided Chromium launched successfully. This was
an environment dependency issue, not a failed navigation test.

**How to apply:** Check for the provided executable before attempting OS library
installation. Keep an explicit executable override and the standard Playwright
browser fallback for other development environments.
