# Design: Graph-Scoped Isolation (Gap 2.1 increment 2 / M2)

**Status:** Proposed — awaiting review before implementation
**Prereq:** Phase 2.1 increment 1 (versioned writes to the active graph) — landed
**Supersedes nothing.** Extends `README.md` §2.1/§2.2.

---

## 1. Problem

Entities are global. `Event` and `Arc` carry **no `graphId`**, so the live store is a single shared
dataset no matter how many graphs exist:

- `events.ts` routes take only `req.params.id` — the entity id. They have no graph concept at all.
- `suggest.ts` accepts a `graphId` in the body and runs it through `authorizeGraphAccess`, but then
  calls `eventRepository.findAll()`. Its own comment admits the gap:
  *"EventRepository.findAll takes (limit, offset); it has no graphId filter, so the whole event set is
  what this endpoint can offer."* (`suggest.ts:145-149`)
- `validate.ts` has the same shape (`:436`, `:472`, `:487`, `:509`, `:523`).
- `batch.ts` only stamps `graphId` into `metadata` (`:178`, `:267`) — a label, not a boundary.
- Increment 1 commits writes to the **active** graph's version store. That makes version history and
  export work, but it is an approximation: the live data it snapshots is still global.

Net effect: `graphId` is used for **authorisation** and **labelling**, never for **isolation**. Two
graphs share one event set. Switching graphs changes which version history you see but not which data
you read. Requirements 1.3, 2.1, 4 and 15 are unmet.

### Why this is worth a design rather than a patch

The tempting fix is to add `graphId` to the entities and add `.filter(e => e.graphId === graphId)` at
each read site. That reproduces the current failure mode exactly: today's bug exists *because* scoping
was left to call sites, and one of them (`suggest.ts`) documents that it cannot comply. A forgotten
filter is a silent cross-graph data leak, and nothing would catch it.

**No users exist**, so there is no data-migration constraint. That is worth using to pick the
structurally correct design rather than the least invasive one.

---

## 2. Goals / non-goals

**Goals**
1. Reads and writes are scoped to one graph, and it is **not possible to read across graphs by
   accident**.
2. Switching the active graph changes the data read, not just the version history shown (Req 2.1).
3. Every entity modification versions into the graph it belongs to (Req 1.3) — generalises increment 1
   from "the active graph" to "the graph in context".
4. The existing route surface keeps working for the single-graph case without changes to the frontend.

**Non-goals (explicit)**
- Cloud/Neo4j parity. `container.ts:366-369` only initialises `graphService`/`exportService`/
  `jobService` when `localExecution.enabled`, and `RateLimitService`/`JobRepository`/
  `VersionRepository` are file-backed only. Cloud mode does not support the I/O system yet (gap M4).
  This design keeps a seam for it but implements local mode.
- Cross-graph causal references (gap M1). The model exists (`CrossGraphCausalRelationship`) and
  `registerCrossGraphReference` has no callers. Deliberately out of scope; noted as the natural
  follow-on since it is the one feature that legitimately reads two graphs.
- Real-time streaming or ingestion (Phase 5).

---

## 3. Design principle

> **Scoping must be structural, not a filter you remember to apply.**

The route layer should not be able to ask for unscoped data. If `findAll()` exists and is reachable
from a request handler, someone will eventually call it. So instead of widening the repositories with
an optional `graphId` parameter, we bind the store to a graph **before** the handler runs, and hand the
handler a repository that is already scoped.

An un-scoped `findAll()` should not be callable from a request path at all.

---

## 4. Options considered

### Option A — `graphId` on entities, filter at read sites

Add `graphId: string` to `Event`, `Arc`, `CausalRelationship`, pressures; filter in every read.

- Uniform across backends; a single dataset.
- **Rejected:** depends on every call site remembering the filter. Silent leak on omission, and
  `suggest.ts` is documented proof that this already fails in practice. It also means the same dataset
  grows without bound, and an index is needed for every query.

### Option B — one live store per graph

Each graph gets its own live store; `LocalGraphStore` already resolves its file at construction
(`LocalGraphStore.ts:1065` → `path.join(dataDirectory, graphFile)`), so a per-graph file is a natural
fit and matches the version store's per-`graphId` layout under `data/graphs/`.

- **Isolation by construction** — physically separate data cannot be cross-read.
- No entity schema change.
- **Alone, insufficient:** Neo4j mode still needs a property/label mechanism, so this is not uniform.
  It also conflicts with the container's singleton repositories, which must become graph-scoped
  rather than global.

### Option C — request-scoped graph context over a store abstraction (recommended)

Combine B's structural isolation with a backend-neutral interface:

- A **graph context** is resolved per request (explicit `X-Graph-Id`, else the active graph).
- The container hands back a **graph-scoped repository set** bound to that context.
- Local mode implements it as a store per graph (Option B — physical isolation).
- Cloud mode would implement it as `graphId`-property-scoped queries behind the same interface
  (Option A — deferred, seam only).

Chosen because isolation holds by construction in the mode we actually run, the interface keeps the
cloud path open, and no call site can forget to scope.

---

## 5. Recommended design

### 5.1 Graph context resolution

A middleware resolves the graph for every request, before container injection:

1. `X-Graph-Id` header, if present and valid.
2. Otherwise the active graph from `GraphRepository.getActiveGraph()` (line 208), preserving current
   single-graph behaviour.
3. If neither resolves → **404** with a clear message. A request that cannot be scoped must not fall
   back to unscoped data. (Today's implicit fallback is the bug.)

It attaches a non-optional `graphId` to the request, so downstream handlers cannot see a request
without one. `authorizeGraphAccess` then checks permission against *that* id, replacing the current
per-route `(req) => req.body?.graphId` extractions, which read the graph id from the body and are
therefore absent on every GET.

**Why a header rather than `/api/graphs/:graphId/events`:** the path form is more canonical REST, but
it changes every route and every frontend call site, and the frontend already models a single active
graph via `apiClient.graphs.activate()` plus `switch()`. The header is explicit (so it does not race
across concurrent requests the way ambient active-graph scoping would) while leaving the existing URLs
and the SPA untouched. Path-based scoping is a reasonable later change; it is not required to make
isolation correct, so it is deferred rather than bundled.

### 5.2 Store binding

`GraphContextStore` (new, `src/utils/` or `src/repositories/`) owns the per-graph store lifecycle:

- Local: one `LocalGraphStore` per graph, file `data/graphs-live/<graphId>.json`, loaded lazily and
  cached. Reuses the existing class unchanged — only the path differs.
- The container exposes `graphScopedRepositories(graphId)` returning `{ eventRepository,
  arcRepository, causalService }` bound to that graph's store.
- The existing global `eventRepository`/`arcRepository` accessors are **removed from the request
  path**. They stay only for non-request contexts (cli/tests) or are removed outright if nothing needs
  them — to be decided during implementation by grepping consumers.

This is the change that makes the goal real: after it, there is no un-scoped `findAll()` reachable from
a route.

### 5.3 Data layout

```
data/
  graphs/                    # version store (existing, per-graphId) — unchanged
  graphs-live/<graphId>.json # NEW: one live store per graph
  graph.json                 # legacy single store — see 5.4
```

### 5.4 Legacy data

There is no user data to preserve, but the repo's own `data/graph.json` and the test fixtures do
exist. Behaviour: on startup, if a legacy single store exists and no per-graph store does, assign its
contents to the active graph (creating a default graph if none exists) and leave the legacy file
untouched as a backup. This keeps local dev and existing fixtures working without a migration
framework. Simpler alternative, if preferred: ignore the legacy file and start empty.

### 5.5 Version store tie-in

Increment 1's `GraphWriteVersioningService` currently resolves the **active** graph. It must instead
use the **request's** graph context. That is a small change with a real consequence: versioning stops
being "wherever the active pointer happens to be" and becomes "the graph this write belongs to" —
which is what Req 1.3 actually asks for, and what makes concurrent graphs safe.

### 5.6 Read path changes

- `events.ts`, `arcs.ts`, `causal.ts`: use graph-scoped repositories.
- `suggest.ts`, `validate.ts`: replace `eventRepository.findAll()` with the scoped repository. The
  admitting comments get deleted because they stop being true.
- `batch.ts`: apply to the scoped store; `graphId` in metadata becomes redundant but is left for
  export provenance.
- `temporal.ts`, `inference.ts`, `export.ts`, `graphs.ts`: audit each for unscoped reads.

---

## 6. Testing strategy

The acceptance criterion is a **negative** test as much as a positive one:

1. **Isolation:** create graph A with events; create graph B with different events; assert a read in
   context A never returns B's events, and vice versa. This is the test that would catch a forgotten
   filter.
2. **Default resolution:** with no `X-Graph-Id`, a request uses the active graph, and switching the
   active graph changes the data read — the direct Req 2.1 assertion.
3. **No fallback:** a request with neither a header nor an active graph returns 404 and **does not**
   return global data.
4. **Versioning follows context:** a write in graph B's context versions into B, not into whichever
   graph is active (regression-testing the increment-1 approximation away).
5. **Legacy adoption:** a legacy store is adopted into the active graph, once.
6. Existing suites must pass unchanged apart from tests that encoded the unscoped behaviour, each
   changed with a stated reason.

---

## 7. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Missing a read site, leaving one path unscoped | Remove the unscoped accessors from the request path so the compiler finds every site; add the isolation test |
| Container becomes a graph-scoped factory, complicating DI | Keep the global container for services (graphs, export, jobs); scope only the live-store repositories |
| Per-graph stores multiply file handles / memory | Lazy load + cache with eviction; store count is bounded by graph count |
| Legacy adoption duplicates data | One-shot adoption guarded by "per-graph store absent"; legacy file retained as backup |
| `authorizeGraphAccess` semantics change | It now checks the resolved context id rather than body-supplied ids — strictly stronger, but tests exercising the old extraction must be updated deliberately |
| Cloud mode silently diverges | Out of scope by design; the interface is the seam, and M4 tracks wiring it |

---

## 8. Task breakdown (suggested phasing)

| # | Task | Notes |
|---|---|---|
| 1 | `GraphContextStore` + per-graph `LocalGraphStore` lifecycle, with unit tests | No route changes yet; independently testable |
| 2 | Graph-context middleware (`X-Graph-Id` → active graph → 404) + tests | Includes the 404-no-fallback test |
| 3 | Container: expose graph-scoped repositories; remove unscoped accessors from request paths | Compiler-driven sweep of call sites |
| 4 | Migrate `events.ts`, `arcs.ts`, `causal.ts` | |
| 5 | Migrate `suggest.ts`, `validate.ts`, `batch.ts`; delete the admitting comments | |
| 6 | Point `GraphWriteVersioningService` at the request context | Settles increment 1's approximation |
| 7 | Legacy adoption + integration tests (isolation, default resolution, versioning-follows-context) | |
| 8 | Audit remaining routes (`temporal`, `inference`, `export`, `graphs`) for unscoped reads | |

Tasks 1–2 are independently verifiable and do not change route behaviour, so they are a safe first
increment. Task 3 is the point of no return: after it, unscoped reads are a compile error rather than
a silent leak.

---

## 9. Open questions

1. **Header vs path scoping.** Recommended header (§5.1) for minimal blast radius; path-based
   `/api/graphs/:graphId/...` is more canonical. Worth confirming, since it is a public API shape and
   changing it later is a breaking change.
2. **Remove the global repository accessors entirely, or keep them for non-request use?** Depends on
   whether any test or CLI path genuinely needs unscoped access. Grep-driven during task 3.
3. **Legacy adoption vs start-empty** (§5.4). Adoption keeps local dev and fixtures working; starting
   empty is simpler and, with no users, defensible.
4. **Should pressures be versioned per graph too?** `EntityType` already includes `'pressure'`, so the
   version side does; confirm the live side stores them per store rather than globally.
