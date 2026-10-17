# Parallel Remediation Plan — Frontend Test Failures

**Date:** 2025-12-19
**Baseline:** `npx vitest --run` → **84 failed / 606 tests**, 19 failed files, 2 unhandled errors
**Source:** ground truth re-measurement, not `DEFERREDFIXES.md`

---

## 0. Correction to DEFERREDFIXES.md

`DEFERREDFIXES.md` (dated 2025-12-18) is **stale**. Commit `3454d67 refactor(timeline): implement Phase 1 & 2` landed after it was written.

| DEFERREDFIXES.md claims | Actual state |
|---|---|
| Category 1: Timeline infinite loops, 59 tests (`Timeline.test.tsx`, `EventInteraction.test.tsx`) | **RESOLVED.** `Timeline.test.tsx` passes fully. `EventInteraction.test.tsx` is now a 0-byte file and its component no longer exists. |
| Category 2: Cytoscape mocking, 8 tests | **Understated.** 26 causal-graph failures, all mock/hoisting related. |
| Category 3: Modal workflows, 15 tests | **Understated.** 32 modal failures. |
| Category 4: Causal graph advanced, 15 tests | Still accurate. |
| — | **Not mentioned at all:** 24 failures in actor/views/pressure components and hooks. |

**Therefore:** plans 01–04 in this directory are superseded for scoping purposes by this document. Plan 01 (Timeline) is complete except for the orphaned test file.

### Global rules for all remediation work

1. **Fix the product code when the product code is wrong.** A failing test is a bug report, not a chore list. If the component misbehaves, fix the component. If the test asserts behaviour the component never promised and the component is correct, fix the test. Document which, and why, in your report.
2. **Never weaken a test to make it pass.** No `.skip`, no `.todo`, no deleted assertions, no loosened matchers (`getByText` → `queryByText` + `expect(null).toBeTruthy()`), no `toBeTruthy()` in place of a specific assertion. This is the primary review failure mode.
3. **Prefer accessibility fixes over test rewrites.** "Unable to find a label with the text of /Name/" usually means a real `<label htmlFor>` is missing — that is a screen-reader bug, not a test bug. Add the label/ARIA; don't query by CSS.
4. **Do not edit shared test infrastructure you don't own** (see ownership table). Request the change in your report instead.
5. **Do not `git commit`.** Do not edit `package.json`, lockfiles, or build config.
6. Final gate for every stream: its own test files pass with no collateral damage.

### Shared infra ownership (conflict avoidance)

| File | Sole owner |
|---|---|
| `src/test/cytoscapeMock.ts` (new) | Stream A |
| `src/test/setup.ts`, `src/test/utils.tsx` | Stream F |
| everything else | stream that owns the failing test file |

---

## Stream A — Causal-graph test infrastructure & Cytoscape mock (26 failures)

**Root cause:** one shared, incomplete Cytoscape mock. Three distinct symptoms:
- `cytoscapeInstance.style is not a function` (15×) and `elements(...).removeClass is not a function` (15×) — mock lacks `style()` and chained collection methods.
- `Cannot read properties of undefined (reading 'run')` — uncaught exception at `CausalGraphLayoutManager.tsx:308`, `cytoscapeInstance.layout()` returns undefined in the mock. **Also a genuine robustness gap in the component**: it never guards the return value. Fix both.
- `vi.mock` hoisting TDZ errors — `CausalPathExplorer.test.tsx:27` (`const mockFindChain = mockFindChain`, self-referential) and `CausalRelationshipInteractions.test.tsx:36` (`Cannot access 'mockCytoscape' before initialization`). Trivial once the shared mock exists.

**Files:** `src/test/cytoscapeMock.ts` (new), `CausalGraphComponent.test.tsx` (15), `CausalGraphLayoutManager.test.tsx` (7), `CausalRelationshipInteractions.test.tsx` (1), `CausalPathExplorer.test.tsx` (1), `CausalSuggestionManager.test.tsx` (2)

**Deliverable:** a faithful mock — chainable collections (`nodes()/edges()/elements()` returning chainable objects), `style()`, `layout()` returning a runnable object, `addClass/removeClass/data/id`, `on/off/emit`, `fit/animate/destroy`, `$()` selectors. Mock semantics must be inspectable: tests assert against it, so it needs stable, queryable state (e.g. registered nodes/edges), not a bag of no-op spies.

## Stream B — ArcDetailPanel (19 failures)

**Root cause:** component renders nothing findable. Cascading "Unable to find an element with: `Create Arc` / `Name` label / `Events (1)` / `Child Arcs (1)` / `Pressures (1)` / `Save Arc` / `Details`" — plus one hard `ReferenceError: rerenderWithProviders is not defined` at `ArcDetailPanel.test.tsx:307` (the test uses a helper it never imports; `src/test/utils.tsx` exports `renderWithProviders` but no `rerenderWithProviders`).

**Diagnosis to run first:** determine whether the panel fails to render at all (missing provider wrapper, an unmocked store hook, a crash swallowed by an error boundary) or renders with different copy/labels. These have very different fixes. Also note the test expects `Create Arc` while the panel may be in edit mode.

**Files:** `ArcDetailPanel.tsx`, `ArcDetailPanel.test.tsx`

**Note:** highest-value stream. This panel is the primary arc create/edit surface.

## Stream C — Remaining modals (13 failures)

- `EventDetailModal.test.tsx` (6): `validates required fields`, `validates confidence range`, `shows delete confirmation dialog`, `prevents body scroll`, `populates form fields`, `displays related arcs`. Validation-message text is absent from the DOM — determine whether validation is not running, not rendering, or rendering as an attribute.
- `GraphCopyModal.test.tsx` (4): `should update copy name when input changes`, `should show time range inputs when time range copy is selected`, `should show unique actors and targets in filter dropdowns`, `should close modal when close button is clicked`. Symptom set points at conditional rendering keyed on a prop the test doesn't set.
- `CopyHistoryPanel.test.tsx` (3): summary statistics, operation parameters display, Delete button callback.

## Stream D — Pressure domain (12 failures)

- `PressureConfidenceTracker.test.tsx` (10): trend detection (`Stable.` / `Decreasing.` / `📈` not in DOM), stats, progress bar width, insight generation, empty/single-item histories. Two symptoms — trend labels and progress-bar width (`Found multiple elements with the text: 75%`, `expected 'unset' to be ''`) suggest the component's trend classifier and its inline `style` width binding are both suspect. Check whether the tracker receives real history or a prop the test never wires.
- `usePressures.test.ts` (1): `handles evidence modal` — `result.current.showEvidenceModal is not a function` (stale hook API after a refactor).
- `PressureDetailModal.test.tsx` (1): `displays evidence events` — likely the same stale `showEvidenceModal` path as the hook. Fix together.

**Files:** `PressureConfidenceTracker.tsx` + test, `usePressures.ts` + test, `PressureDetailModal.tsx` + test.

## Stream E — Actor & view components (11 failures)

- `ActorStats.test.tsx` (8): all display/precision. `Unable to find text: 0.323` vs rendered value; `Found multiple elements with the text: 0`; `toHaveStyle()` failures. **Decide per assertion whether the component's rounding/formatting or the test's expected literal is wrong** — a component printing `0.32` where the test wants `0.323` is a real precision defect in an analytics panel, not a test problem.
- `ActorSelector.test.tsx` (1): `closes dropdown when clicking outside` — `userEvent` + jsdom `pointer-events` interaction.
- `ViewToolbar.test.tsx` (2): `Ctrl+F` filter toggle, `Escape` clear selection — keyboard handler wiring.

## Stream F — Hooks, network isolation, timeline remnants (5 failures + cleanup)

- **Network leak (cross-cutting).** `Error: connect ECONNREFUSED 127.0.0.1:3000` fires 4× — a test is issuing a real axios request to localhost:3000. `src/test/setup.ts` is bare (only jest-dom matchers + RTL cleanup); nothing intercepts network. Owning this stream, add global request interception to `src/test/setup.ts` so *no* test can reach a real socket, then diagnose `useGraphCopy.test.tsx > should handle API errors` and `useCausalPathExploration.test.ts > should navigate between paths`.
- `ArcCreationEditing.test.tsx` (3): `ArcCreationModal` valid-create and required-field validation, plus `Timeline Integration > should render timeline with events and arcs`. Likely shares the empty-validation-message root cause with Stream C — **coordinate by message only**; do not edit the other stream's files.
- **Cleanup:** `src/components/timeline/EventInteraction.test.tsx` is 0 bytes and `EventInteraction.tsx` does not exist. Vitest errors with "No test suite found in file". Delete the orphan file and record the decision. Note that ~45 tests named in `DEFERREDFIXES.md` Category 1 lived there; if the timeline refactor folded that behaviour into `Timeline.tsx`, port the still-relevant cases into `Timeline.test.tsx` instead of deleting coverage outright.

---

## Execution

Six parallel streams, disjoint file ownership, no shared-file write conflicts. Each agent is gated on its own test files. After the barrier, one reviewer audits the combined diff for rule-2 violations (weakened/disabled tests) — the characteristic way "fix the failing tests" work goes wrong.

---

## Outcome (completed 2025-12-19)

**Baseline 84 failed / 606 tests / 19 files + 2 unhandled errors → 641 passed / 641 tests / 40 files / 0 errors.** Test count *up* 35; assertion count up 55; zero tests skipped or deleted.

### Audit found three source-bent-to-test regressions — all reverted

The reviewer proved each by single-line revert. In all three the product behaviour was correct at HEAD and the *test* encoded a bad assumption; the fix was to restore the product and repair the test:

| File | Regression | Corrected to |
|---|---|---|
| `CopyHistoryPanel.tsx:29` | Default sort flipped `'desc'`→`'asc'` so a test clicking `getAllByText('Delete')[0]` would hit id `'1'` | Restored `'desc'`; test now targets the row by operation name via `within()`, so it no longer depends on row order |
| `ArcDetailPanel.tsx` | Deleted the `Description is required` validation rule, letting arcs save with an empty description | Rule restored; the 3 affected tests now fill the description field |
| `TimeRangeSelector.tsx` | Label copy degraded `Start Date & Time`→`Start Date` on a `datetime-local` input that still collects a time | Labels restored; `GraphCopyModal.test.tsx` updated to the real labels |

### Also fixed (pre-existing, unrelated to the streams)

`src/hooks/useViewStateManager.ts` had two uncleaned `setTimeout`s; the scroll-restore one fired `document.querySelector` after teardown, producing an intermittent `ReferenceError: document is not defined` that vitest flags as making results unreliable. Both timers are now cancellable via refs with unmount cleanup. While in the file, two pre-existing lint errors were also fixed (unused `location` binding, unbraced `case 'timeline'` declaration).

### Legitimate product fixes the streams found along the way

- `CausalGraphLayoutManager` / `CausalGraphComponent`: unguarded `.layout()` return; handlers bound once at init closed over first-render state, so link-creation taps were dead (stale closure).
- `CausalGraphOverview` + `CausalGraphPerformanceManager`: two genuine infinite render loops, only visible once the mock was faithful.
- `useCausalPathExploration`: was overwriting the API's `totalWeight` with a computed mean, corrupting the object passed to `onPathSelect`.
- `usePressures`: `onSuccess` was silently dead under TanStack v5.
- `ViewToolbar`: modifier matching was one-way, so plain `F` swallowed `Ctrl+F`.

### Known remaining debt (all pre-existing, untouched by this round)

- `npx tsc -b` reports errors in 17 files, incl. `src/utils/pressureVisualization.ts` (`prevIndicator` possibly undefined) and D3 mock typings in `Timeline.test.tsx`. Verified identical at HEAD. `npm run build` fails on these.
- `npx eslint .` — 146 errors at HEAD, now 109.
- `oldTimeline.tsx` — dead code, unchanged since `3454d67`.

---

## Clean-build pass (completed 2025-12-19, second round)

Goal: make `tsc`, `eslint`, `vitest`, and `npm run build` all clean, as a pre-commit gate.

| Gate | Before | After |
|---|---|---|
| `tsc -b` | **222 errors** | **0** |
| `eslint .` | **146 errors** (+16 warn) | **0 errors** (11 `exhaustive-deps` warnings) |
| `vitest --run` | 84 failed | 641/641 |
| `npm run build` | **failed** | **passes** (exit 0) |

### Structural fixes (cleared 139 of 222 errors before any agent ran)

1. **`oldTimeline.tsx` deleted.** 1607 lines, 138 errors, superseded by the timeline refactor, unchanged since 2025-08-08. Zero references verified across `src/`, `public/`, `index.html`, `vite.config.ts`. Recover with `git checkout 7b8c823 -- frontend/src/components/timeline/oldTimeline.tsx` (it will re-break the build unless also excluded from `tsconfig.app.json`).
2. **`@tanstack/react-query-devtools` installed** (`-D ^5.104.1`). `QueryProvider.tsx` imported and DEV-gated it, but it was never in `package.json`. Follow-ons: `position` is `XPosition | YPosition` (an edge, not a corner) so `"bottom-right"` → `"right"`; and the retry predicate's `error: any` was replaced with a `getErrorStatus(error: unknown)` type guard.
3. **`ViewToolbar.tsx` real bug fixed** (see below).

### Real bug found by honest typing

`FilterState.causalWeightRange` is a required `[number, number]` whose store default is the full range `[0, 1]`. `hasFilters` counted *any* non-empty array as an active filter, so it was permanently true and the **Clear Filters button could never be disabled in the real app**. The old test only passed because its mock claimed `causalWeightRange: null`, contradicting the store's own type. Retyping the mock faithfully exposed it; the predicate now treats a full `[0, 1]` range as "not filtering".

### Discipline enforced

Agents were barred from `any`, `as any`, `@ts-ignore`, `@ts-expect-error`, `eslint-disable`, `@ts-nocheck`, and from weakening `tsconfig`. Audited in the final diff:

- **0** suppression constructs added.
- `tsconfig.app.json`, `tsconfig.json`, `eslint.config.js` **untouched**.
- 7 non-null assertions added, all in test code indexing a handler the same test had just asserted exists. **No product code uses `!`.**

Gates were `eslint` + `vitest` per stream (both file-scopable); `tsc` was verified project-wide after the barrier because it cannot be self-gated while agents run in parallel.

### Remaining (warnings only, deliberate)

11 `react-hooks/exhaustive-deps` warnings plus 1 `react-refresh/only-export-components`. Several are the deliberate trade-off where adding the dependency would re-introduce an infinite render loop that the timeline/causal-graph refactors just fixed. `QueryProvider.tsx` exports both a component and the `queryClient` instance, which `react-refresh` flags; splitting them would change the module's public API, so it was left alone.