# Tripwire

Reporting intelligence workspace tracking relevant outlet releases, journalists, consequential claims, and source provenance in politics and national security.

## Run & Operate

- Use managed workflows `artifacts/api-server: API Server` and `artifacts/tripwire: web`.
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm test` — regression suite; shared-workspace entity tests require a dedicated isolated schema and otherwise skip
- `pnpm --filter @workspace/scripts run test:claims-browser` — isolated Claims/Feed browser regression; needs the Tripwire frontend workflow, not the API (see `scripts/browser/README.md`)
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `node lib/db/migrate-entities.mjs` — apply additive journaled entity/reporting migrations; do not schema-push over graph constraints
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

- Public RSS metadata is separate from private analysis. Everyone admitted through private publishing shares one workspace; there is no in-app login or user-specific ownership.
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
- Everyone granted app access has the same permissions; do not introduce separate administrator roles or account-level permission variations.
- Do not add an in-app login in development or production. The user will publish privately and relies on Replit's access boundary; everyone admitted shares the workspace and permissions.
- Keep the article's paste/URL/file enrichment control near the top of its detail pane, directly below the headline.
- Content genre and format are separate from sourcing originality and sentiment. Use publisher labels, structured metadata and exact URL sections; retain evidence and leave unsupported genres unclassified.
- Suppress News and default text-format labels in feed metadata. Show other identified genres/formats there, and all classifications in the detail pane.
- Retain all available article text and source captures in durable database storage, not source-code files. Do not treat a fetched page or long excerpt as confirmation of complete article text.
- Use simple directional chevrons for all collapse/expand controls: left/right for horizontal panels and up/down for vertical sections.
- News Media should provide an All hierarchy of outlets and their journalists, alongside separate outlet and journalist views.
- Keep journalists within News Media, not a separate sidebar destination. Expand outlets into journalists and journalists into coverage.
- Display full names as credited on bylines, including middle names, initials and suffixes; default to last-name A–Z sorting, with newest-coverage and item-count options.
- Feed rows use borderless rounded-square outlet marks. Metadata: DD MMM (year only when not current) · HHMM in ET · OUTLET · full single byline or comma-separated surnames · colored impact word · tags without hashtags · content dot.
- Clicking a feed item opens a right-hand detail pane; keep full byline names and per-article credit roles in that view.
- Feed cards must keep a normalized height. All feed headlines share one font size for the current feed-pane width; never size individual headlines by their length. Adjust the shared size when panes resize, and clamp overflow within the card; the full title remains available in the tooltip and reader.
- Use a visible grayscale-wave background with light translucent feed-item surfaces and prominent outlet logos; retain high text contrast and the black sidebar.
- Feed filters belong in one Filters control with per-category multi-select checkboxes, category clearing and a global reset. Empty selections mean all; omit “: all” labels.
- Feed impact categories are CRITICAL, HIGH, LOW; keep prioritization separate from sourcing verification. Content dots indicate complete retained text, partial content, or minimal metadata.

## Gotchas

- X Feeds uses bounded public-page samples at the user's request, not guaranteed complete timelines. Optional paid API collection remains separately gated. See `docs/x-feeds.md`; agent-only X callbacks are not runtime access.
- Reuters has no default feed; use manual intake or configure a licensed feed. Other feed failures are reported per outlet.
- Public feeds refresh every ten minutes while the API process runs.
- Entity automation starts observe-only and without a configured provider. See `docs/entity-automation-security.md` for trust boundaries, activation gates and rollback; live decisions remain blocked until actual private-access verification and reviewed quality calibration are recorded.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
