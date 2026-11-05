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

Tracks the requested eleven outlets, an entity/account watchlist, article and X-post intake, journalist associations, and claim observations across origin, sourcing, independent additions, and republications.

## User preferences

- Keep the interface focused: no unnecessary UI, explainer copy, unrelated warnings, or out-of-scope tags.
- Black-and-white UI with restrained semantic color; use an Agency FB–like condensed heading font with complementary readable UI typography.

## Gotchas

- X automation requires an authorized workspace X integration; X intake and account tracking are currently manual.
- Reuters has no default feed; use manual intake or configure a licensed feed. Other feed failures are reported per outlet.
- Public feeds refresh every ten minutes while the API process runs.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
