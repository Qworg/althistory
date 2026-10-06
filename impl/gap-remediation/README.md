# Gap Remediation Plan

**Status:** Phase 1 in progress
**Baseline:** `main` @ `7a38aa8` — both packages typecheck and lint clean (0 errors);
frontend 1330 passed / 38 skipped, backend 1218 passed / 1 skipped.

Source: a verified gap analysis of `.kiro/specs/frontend-timeline-interface`,
`.kiro/specs/input-output-system`, and `impl/deferredplans/*`. Every finding below was re-checked
against source rather than taken from the documents' own checkbox state, which is unreliable in
**both** directions.

---

## The central finding

This is not a half-built system. It is a system where **large amounts of finished, tested, working
code is unreachable from the running app**.

| Symptom | Evidence |
|---|---|
| Filters never mounted | `SearchInterface` 0 importers, `ActiveFilters` 0, `FilterPanel`'s only "importer" pulls a *type* |
| I/O UI orphaned | `GraphSelector`, `GraphManagerModal`, `ExportPanel`, `ImportWizard`, `ApiKeyDashboard`, `VersionHistoryPanel` — **0 non-test importers each** |
| No error surface | `ErrorBoundary` / `componentDidCatch` → **0 matches** |
| Graph copy broken | Frontend calls `/graph/copy` (4 sites); backend `graphs.ts` has no copy route → 404 |
| Versioning disconnected | `commitChanges` was called only by `GraphService.merge` and `ImportService` — **never** by events/arcs routes. Now also called by `GraphWriteVersioningService` from the write routes; `GraphService.commitChanges` is a fourth caller (tests only) |
| ADR-001 drifted | `Timeline.tsx:111,203,214` still does `d3.select(svgRef.current).transition()` — D3 owns the DOM |

So the priority order is deliberately **wiring before building**: several phases below convert sunk
work into working features for a fraction of the cost of building them again.

---

## Phase 1 — Wiring and correctness (highest value per hour)

Everything here is additive, independently verifiable, and does not require the architectural work
in Phase 2.

### 1.1 Error surface (Req 14.1) — BLOCKER
`addError` is called from ~20 sites and writes `store.errors`; **nothing renders it**, and
`loadingOperations` is written and never read. API failures are silent.
- Add an `ErrorBoundary` around the routed app.
- Add a non-blocking notification surface that renders `store.errors` and clears on dismiss.
- Mount `CopyCompletionNotification` (defined, never imported).
- Verification: a forced API failure surfaces a visible message; boundary catches a thrown render error.

### 1.2 Mount the dead providers (Req 13.2, task 2.1)
`main.tsx:7` builds its own bare `QueryClient`, bypassing `providers/queryClient.ts` (retry /
no-retry-on-4xx / backoff — currently inert). `useStoreInitialization` is exported and never mounted,
so preference and session persistence never load or save.
- Mount `QueryProvider` and `useStoreInitialization` in `main.tsx` / `App.tsx`.
- Verification: retry policy observable; preferences persist across reload.

### 1.3 Mount filters and actually apply them (Req 6) — BLOCKER
`FilterPanel`, `SearchInterface`, `ActiveFilters`, `useFilters` exist and are tested but unreachable.
`ViewToolbar` toggles `uiState.filterPanelOpen` and nothing renders it; every view calls
`useEvents()` / `useArcs()` with no arguments, so `activeFilters` never reaches the data.
- Mount the filter panel and search where the toolbar expects them.
- Thread `activeFilters` through the view hooks so filtering has an effect.
- Verification: a filter narrows rendered events; the active-filter indicator reflects state.

### 1.4 Backend contract fixes — BLOCKER + MAJOR
- **`/graph/copy` 404s.** Either expose the already-DI-registered `GraphCopyService` as a route, or
  point the client at the real endpoint. Prefer exposing it: the service exists and is tested.
- `/graphs/:id/branches` is called by the client but not implemented.
- `POST /graphs/:id/rollback` body `{version}` vs backend `POST /graphs/:id/rollback/:version`.
- `switch()` writes `localStorage` only; it never calls `POST /graphs/:id/activate`, so the server's
  active graph never changes.
- Verification: each client call resolves against a real route, asserted by a request-level test.

### 1.5 Auth on graph and export routes (M3) — BLOCKER
`graphs.ts` and `export.ts` have **no** auth middleware, while `batch.ts`/`keys.ts` do. Anyone can
create, branch, merge, delete or roll back graphs, and run exports.
- Apply the same `authenticate` + `requiredPermission` pattern used by the protected routes.
- Verification: unauthenticated request → 401; insufficient permission → 403.

### 1.6 Un-skip the disabled tests — BLOCKER
- `EventInteraction.test.tsx:105` is `describe.skip` over ~30 tests (668-line file). Its skip comment
  blames stale closures, but the prescribed ref fix **already exists** in
  `CausalGraphComponent.tsx:108-110,415-416` — so this is likely stale, not blocked.
- 7 skips in `CausalRelationshipInteractions.test.tsx:312-587`, same suspicion.
- Verification: the suites run green with no `.skip`. If a test genuinely cannot pass, fix the cause
  or document precisely why with evidence — do not re-skip.

### 1.7 Filtered-copy bug (G11) — MAJOR
`GraphCopyModal.handleCreateCopy` calls `handleFilterChange()` then `createFilteredCopy()` in the same
tick; the latter reads the stale `copyState.selectedFilter`. The filter inputs update `filterConfig`
only, so a filtered copy fails validation unless the separate "Use Current Filters" button was pressed.
- Verification: choosing filters then creating a copy succeeds.

---

## Phase 2 — Architecture

### 2.1 Reconnect the versioned store (B3) — highest-leverage single fix
Two parallel stores: `GraphRepository`/`VersionRepository` write versioned JSON under `data/graphs/`;
real events/arcs/causal go to `EventRepository`/`LocalGraphStore`. `ImportService` and
`GraphService.mergeGraph` were the only writers to `commitChanges`, so a graph built through the UI
had **empty version history and an empty export**. (The claim that this bridge's `commit` was "the
only caller of `commitChanges` outside the import and merge paths" is inaccurate: the public
`GraphService.commitChanges` wrapper is a fourth caller, used only by tests today.) The bridge
increment below reconnects UI writes; that work invalidated Requirements 1.3, 2.1, 3, 4.4 and 5.

This is why the multi-graph UI cannot work even once mounted (Phase 3), so it must land before it.

**Design (investigated):**
- `GraphRepository.commitChanges(graphId, {added, modified, deleted}, operation, description, userId)`
  takes full entity data inline and writes content-addressed objects via `VersionRepository`.
  `ImportService.commitImport` is the working reference for using it.
- `ExportService` reads **exclusively** from `graphRepository.checkout()` (lines 184, 259) — never the
  live store. So it only ever sees imported data. That is the user-visible bug.
- An active-graph concept already exists: `GraphRepository.getActiveGraph()` (line 208) backed by
  `index.activeGraphId`.
- **Root cause behind B3 and M2:** `Event` and `Arc` carry **no `graphId`** — entities are global in
  the live store. So "which graph does this write belong to?" has no structural answer yet; only the
  active-graph notion can approximate it.

**Increment 1 (this phase):** commit entity changes to the active graph on normal write paths, so
version history and export stop being empty for UI-created data. This is the user-visible fix and is
bounded to the write routes plus one shared helper.

**Increment 2 (follow-on):** real graph-scoped isolation (M2) — requires `graphId` on entities or a
scoped live store, plus filtering reads in `suggest.ts`/`validate.ts`/`batch.ts`, which today use
`eventRepository.findAll()` and only check `graphId` for authorisation. Until this lands, switching
graphs still shows the same global data, so Req 1.3/2.1 are only partly satisfied.

### 2.2 Multi-graph read/write isolation (M2)
`suggest.ts` and `validate.ts` call `eventRepository.findAll()` — the global store — and use `graphId`
only for an authorisation check, not data scoping. `batch.ts` only stamps `graphId` into `metadata`.
Requirements 1.3, 4, 14.2, 15 are unenforced until writes and reads are graph-scoped.

### 2.3 ADR-001 drift
`Timeline.tsx` still hands DOM ownership to D3 (zoom, transitions), and `ActorTimeline.tsx` /
`PressureIndicators.tsx` are wholly D3-rendered. Decision needed: either bring the code back to the
ADR, or rewrite the ADR to describe the hybrid actually in use. Today the ADR's "Audit Results" section
claims "no direct DOM manipulation via D3", which is false and actively misleading.

### 2.4 Merge semantics (M5)
keep-source/keep-target still require a manual resolution map, and the merge commit is recorded as
`operation: 'import'` with a single `parentVersion` — there is no two-parent merge-commit model.

### 2.5 Webhook retry (M6)
`JobService.sendWebhook` performs a single `fetch` and logs on failure. Req 22.4 requires retry with
exponential backoff and delivery-status logging.

### 2.6 Cloud mode (M4)
`container.ts:366-369` initialises `graphService`/`exportService`/`jobService` only when
`localExecution.enabled`. `RateLimitService`, `JobRepository`, `VersionRepository` are file-backed only,
so the graph/export endpoints are uninitialised in cloud mode and the design's Redis/Neo4j assumptions
do not hold for the new subsystems.

---

## Phase 3 — Mount the I/O UI (depends on 2.1)

`GraphSelector`, `GraphManagerModal`, `VersionHistoryPanel`, `ExportPanel`, `ImportWizard` and
`ApiKeyDashboard` are built, unit-tested, and unreachable. Needs routes, a header mount point, and a
working backend contract (1.4) plus real versioning (2.1).

Note `ViewToolbar.tsx:491-525` still carries `TODO: Implement graph switching / copy deletion`, and the
comparison modal is passed `originalData={undefined} copiedData={undefined}`.

---

## Phase 4 — Timeline interaction (Req 3.1/3.3, 4.3, 2.3)

Currently stubs: `TimelineView.handleEventCreate` / `handleEventDrag` only `console.log`.
`Timeline` never consumes its own `onEventDrag` / `onArcResize` / `onArcExpand` / `onArcCollapse`
props, and arc hierarchy is always built with `new Set()`, so nothing is ever expanded.
Because drag and resize are no-ops, the spec's temporal-constraint error flow is unreachable.

---

## Phase 5 — Missing subsystems (build, not wire)

These are genuinely absent, not orphaned.

| Item | Spec | Reality |
|---|---|---|
| Web ingestion | Req 7–10, tasks 4.1–4.12 | No `services/ingestion/`, no `services/llm/`, no `routes/ingest.ts`, no `components/ingestion/`, no `openai`/`anthropic` deps |
| WebSocket streaming | Req 16, tasks 5.1–5.3 | No `websocket/`, no `routes/stream.ts`, no `ws` dep, no frontend client |
| Virtualisation | Req 7, task 12.1 | None. `Timeline.tsx:325-346` renders every event; per perf tests use **5000 ms** thresholds at 1000 events, not sub-200 ms at 10k |
| Offline sync | Req 14.2 | No service worker, no `navigator.onLine`, no mutation queue |
| Keyboard/pinch | Req 8, task 14.1 | Only Alt+1/2/3. `ViewToolbar` advertises `Ctrl+N`, `F`, `Ctrl+Shift+C` in tooltips but registers no keydown listener |

---

## Phase 6 — Infrastructure

- **No CI at all** — no `.github/`. `run-tests.sh` just runs both suites.
- **No coverage measurement** — `@vitest/coverage-v8` not installed, so the plans' ">80%" success
  metric has never been verified.
- **No E2E or visual regression** — no Playwright/Cypress in either package.
- **No aXe** — ARIA was added by hand and regressions are invisible.
- `tsconfig.app.json` / `tsconfig.node.json` are unused Vite templates that **omit the path aliases**,
  so they fail standalone; the real build uses `tsconfig.json`.

---

## Documentation debt (fix alongside, not later)

1. **`DEFERREDFIXES.md` is materially false.** It claims *"965 passed / 7 skipped … ALL PASSING"* and
   lists `EventInteraction.test.tsx (30 tests) — ALL PASSING`. Actual: **1330 passed / 38 skipped**,
   and that file is a 668-line `describe.skip`.
2. **`impl/deferredplans/README.md`** repeats the stale table (all four plans "📋 Planned" while plan 01
   says every phase COMPLETE).
3. **`input-output-system/tasks.md` is 0/51** while Phases 1–3 are genuinely built.
4. **`frontend-timeline-interface/tasks.md`** has two stale duplicate headers, and ticked items 3.1,
   3.2, 4.2, 5.1, 5.2, 2.1, 9.1–9.2 that do not work.
5. **ADR-001's "Audit Results"** is false (see 2.3).
6. **`05-parallel-remediation-plan.md` is missing from `main`** — the record of the test-remediation
   work (84 failed → 641 passing, the anti-cheat audit, three reverted source-bent-to-test regressions)
   exists only on the deleted branch, recoverable from `backup/pre-rebase-66bc083`.

**Rule going forward:** checkboxes in these specs are not evidence. Verify against source.

---

## Working agreement

- Each unit of work is verified by its own tests plus `tsc` and `eslint` gates before it is called done.
- No test is skipped, deleted, or weakened to make something pass. Where a test cannot pass, fix the
  cause or document the blocker with evidence.
- No `any`, `as any`, `@ts-ignore`, `@ts-expect-error` or `eslint-disable` to silence a problem.
