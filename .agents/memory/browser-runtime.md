---
name: Browser runtime
description: Choosing a compatible browser for repeatable local regression checks on Replit.
---
Prefer the environment-provided Chromium for browser checks on Replit; do not
assume downloading Playwright's Chromium also supplies a usable Linux runtime.

**Why:** Browser binaries and their host libraries are separate dependencies;
download success does not establish compatibility with the workspace runtime.

**How to apply:** Prefer the workspace browser when available, preserving an
explicit executable override and the standard browser fallback for other environments.
