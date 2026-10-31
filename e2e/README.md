# End-to-end tests

Real-browser tests for the frontend, run against the **production build**
(`vite build` + `vite preview`) with the HTTP API **stubbed**. They exist
because every unit test in this repository mocks the API client, so nothing
before this loaded the real app in a real browser.

This is a separate package on purpose: it has its own `package.json`,
TypeScript config and Playwright runner, and does not touch `frontend/`'s
Vitest setup.

## What is covered

| Spec | Flow | Asserts |
| --- | --- | --- |
| `tests/smoke.spec.ts` | App boots and the timeline renders | The heading, the `N events, M arcs` count, and each stubbed event's rendered SVG mark (`g[data-timeline-mark="event"]`) with its description in the accessible label |
| `tests/create-event.spec.ts` | Create an event through the real UI | The modal opens, the typed payload is POSTed, the modal closes, the event list refetches, and the new mark appears on the timeline |
| `tests/ingestion.spec.ts` | Open the Req 19 ingestion wizard and reach the review table | The wizard opens from the toolbar, `POST /api/ingest/url` is sent, the editable review table renders the extraction, and approving imports the selection (`POST /api/ingest/jobs/:id/approve`) |
| `tests/offline.spec.ts` | Go offline | The `offline-indicator` appears with `data-online="false"` while the browser is offline and disappears on reconnect |
| `tests/visual.spec.ts` | Visual regression (`@visual`) | `toHaveScreenshot` for two views only: the timeline SVG and the ingestion review dialog |

## Stubbed endpoints

All requests under `/api/**` are intercepted in `tests/support/api.ts`; no
backend and no external network are required. The stub is stateful, so a write
followed by a refetch observes the write.

- `GET /api/events` (list), `POST /api/events` (create),
  `GET|PUT|DELETE /api/events/:id`, `GET /api/events/search`
- `GET /api/arcs`, `POST /api/arcs`, `PUT|DELETE /api/arcs/:id`
- `GET /api/graphs` (the header's graph selector fetches this on every page),
  `GET /api/graphs/:id`
- `POST /api/ingest/url`, `POST /api/ingest/wikidata`, `POST /api/ingest/text`
- `POST /api/ingest/jobs/:id/approve`, `DELETE /api/ingest/jobs/:id`

Any other request is answered `404` and recorded in `state.unhandled`; the
functional specs assert that list is empty, so an unimplemented call fails the
test instead of silently drifting.

The app is built with `VITE_API_BASE_URL=/api` by `playwright.config.ts`, so
the calls are same-origin and the stub needs no CORS/preflight handling. The
app-shell service worker is blocked (`serviceWorkers: 'block'`) so it cannot
serve a cached response around the route interception.

## Prerequisites and commands

Requires Node 24 (matches the rest of the repo) and an installed chromium.

```bash
cd e2e
npm ci
npx playwright install chromium        # add --with-deps only if system libs are missing
npx playwright test                    # everything, including @visual
npx playwright test --grep-invert @visual   # functional only (no screenshot baselines)
npx playwright test --update-snapshots      # regenerate visual baselines
```

`webServer` rebuilds the frontend on every run, so there is no stale-`dist`
trap; `reuseExistingServer` is `false`.

## Visual regression: read this before trusting it

**The baselines are platform-specific and are not portable.** A screenshot
baseline is a picture of one browser build rendering with one OS font stack.
Playwright embeds the platform in the filename
(`*-chromium-linux.png`), and the config selects one project (chromium), so
the committed baselines only mean anything for chromium on Linux. On
Windows/macOS, a newer chromium build, or a CI image with a different font
stack, a comparison can fail with no code change. That is a property of
screenshot testing, not an app bug.

What was done about it:

- The covered views are deliberately few: the timeline SVG and the review step
  of the ingestion wizard.
- The CI e2e job runs with `--grep-invert @visual`, so visual checks never
  gate a portable job; they are a local, advisory signal.
- To refresh a baseline: run the tests, review the diff, then
  `npx playwright test --update-snapshots`. Never update a baseline to make a
  red run green without understanding the change.
- `maxDiffPixelRatio` is `0.0003`. A sparse image makes a large ratio useless
  (1% of the timeline is ~3200 px, enough to hide a marker), so the threshold
  is set just above the deterministic same-machine noise (zero) and below the
  ~143 pixels Playwright's comparator counts when a marker is deliberately
  moved ~200 px.

**Coverage limit:** two views is not visual coverage of the app. It locks
layout for those two screens at one viewport on one platform; every other
screen can still regress visually.

## What this suite does not do

- It does not test the backend. It proves the frontend's real HTTP boundary
  works against a contract, not that the real backend implements that contract.
- It does not exercise the causal-graph or actor-perspective views, graph
  management, import/export, filters, drag/resize, or the offline mutation
  queue's replay path.
- Visual baselines are not portable (above).

## CI

`.github/workflows/ci.yml` has an `e2e` job that installs both packages'
dependencies, installs chromium, and runs
`npx playwright test --grep-invert @visual`. It is a separate job and does not
gate the backend or frontend jobs.

The job runs on GitHub Actions on every push to `main` and every pull request.
Its preview server is started with `--host 127.0.0.1`, the address `baseURL`
names: GitHub's Ubuntu runners resolve `localhost` to `::1` first, so a server
left on the default host listens on IPv6 while Playwright waits on IPv4, and
the job times out in `config.webServer` before any test runs.
