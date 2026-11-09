# Claims browser regression

Start the existing `artifacts/tripwire: web` managed workflow, then run from the
repository root:

```sh
pnpm --filter @workspace/scripts exec playwright install chromium
pnpm --filter @workspace/scripts run test:claims-browser
```

On Replit the suite automatically uses the provided Nix-compatible Chromium, so
the install step is unnecessary. Elsewhere it uses Playwright's installed browser.
`CLAIMS_BROWSER_CHROMIUM` can explicitly select a compatible Chromium executable.

The default target is the workspace proxy (`http://localhost:80`).
`CLAIMS_BROWSER_BASE_URL` can point at another **development** frontend.
There is no in-app login. The API server, database, credentials, publisher
retrieval, and model access are not needed.

All API responses are scoped to the test browser. The navigation/recovery
fixture blocks every write; the editor fixture accepts only explicitly mocked
correction writes into browser-local memory. No writes reach the real API.
unknown API reads fail the test, and external HTTP requests are blocked.
Synthetic records never enter the shared Feed, processing queue, or storage.
Do not replace interception with shared-database seeding.

The fixture deliberately gives one shared claim a representative staffing home
and a second, article-local policy home. The suite exercises the real Claims and
Feed React pages, covering article/claim expansion, article-local counts and
links, category/topic filters, all three sort choices, breadcrumb selection,
reload, browser history, Feed claim filters, and the return link to the article.
Feed category/topic filters currently live in component state; the reload
assertions cover persisted Claims URL selections and the Feed article URL, not
unsupported Feed filter persistence.

Failures retain traces and screenshots under
`generated-artifacts/claims-browser` (excluded from Git and publishing).
The pure companion checks remain in `scripts/article-focus.test.mjs`; run them
with `pnpm --filter @workspace/scripts exec tsx --test article-focus.test.mjs`.

Editing coverage exercises article placement search/reset, explicit shared-group
scope confirmation and reset, claim metadata correction with preserved input on
a stale-save error, and passage association exclusion/restoration. Recovery
coverage includes unavailable/stale/unknown link data and missing claim/article
navigation. Database preservation and concurrency checks use a separate schema
in `scripts/claims-editing.test.mjs`; they do not use shared reporting fixtures.
