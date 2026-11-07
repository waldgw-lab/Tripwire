#!/bin/bash
set -e
pnpm install --frozen-lockfile
node lib/db/migrate-entities.mjs
pnpm --filter @workspace/api-spec run codegen
