# Tripwire

Reporting intelligence workspace tracking relevant outlet releases, journalists, consequential claims, and source provenance in politics and national security.

## Run & Operate

- Use managed workflows `artifacts/api-server: API Server` and `artifacts/tripwire: web`.
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `artifacts/tripwire` — React interface.
- `artifacts/api-server/src/lib/tripwire-*` — configuration, private record storage, public RSS polling.
- `lib/db/src/schema/tripwire.ts` — persistence schema.
- `lib/api-spec/openapi.yaml` — source of API contract.

## Architecture decisions

- Public RSS metadata is shared; user-entered text, claims, and edits require Clerk and remain isolated by user.
- Feed discovery never establishes independent sourcing, verified origin, or sentiment. These require analyst assessment.
- No paywall bypass or externally shared full-text archive.

## Product

Tracks the requested twelve outlets (including NBC), an entity/account watchlist, article and X-post intake, an explicit journalist roster alongside discovered bylines, and claim observations across origin, sourcing, independent additions, and republications.

## User preferences

- Keep the interface focused: no unnecessary UI, explainer copy, unrelated warnings, or out-of-scope tags.
- Black-and-white UI with restrained semantic color; use an Agency FB–like condensed heading font with complementary readable UI typography.
- Use the supplied Tripwire logo pack for branding; the 1:1 open-corner monogram is the browser tab icon.
- The black navigation sidebar is collapsible; switch to the supplied 1:1 TW logo on the collapsed icon bar.
- The published app is intended to be private/invite-only. Keep sign-in promotion out of the workspace UI; this does not replace configuring publishing access restrictions.
- News Media should provide an All hierarchy of outlets and their journalists, alongside separate outlet and journalist views.
- Keep journalists within News Media, not a separate sidebar destination. Expand outlets into journalists and journalists into coverage.
- Display full names as credited on bylines, including middle names, initials and suffixes; default to last-name A–Z sorting, with newest-coverage and item-count options.
- Feed rows use borderless rounded-square outlet marks. Metadata: DD MMM (year only when not current) · HHMM in ET · OUTLET · full single byline or comma-separated surnames · colored impact word · tags without hashtags · content dot.
- Clicking a feed item opens a right-hand detail pane; keep full byline names and per-article credit roles in that view.
- Headline sizes scale with their available pane width: larger in a wide feed and smaller on narrow screens or when the reader is open.
- Use a visible grayscale-wave background with light translucent feed-item surfaces and prominent outlet logos; retain high text contrast and the black sidebar.
- Feed filters belong in one Filters control with per-category multi-select checkboxes, category clearing and a global reset. Empty selections mean all; omit “: all” labels.
- Feed impact categories are CRITICAL, HIGH, LOW; keep prioritization separate from sourcing verification. Content dots indicate complete retained text, partial content, or minimal metadata.

## Gotchas

- X automation requires an authorized workspace X integration; X intake and account tracking are currently manual.
- Reuters has no default feed; use manual intake or configure a licensed feed. Other feed failures are reported per outlet.
- Public feeds refresh every ten minutes while the API process runs.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
