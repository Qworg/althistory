# Export contract conformance (Issue 6, gap M1 + Req 4.4 + Req 5.4 + design §Export API)

Branch: `fix/export-contract-conformance`

The plan document lists three export defects as open. All three were still open at
the branch point (`5c22575`), and the first was worse than described: cross-graph
references were not merely missing from exports, they were also dropped on import
by a map that was built and then never read.

## What was actually broken

### 1. Cross-graph references were lost in both directions (gap M1, Req 4.4)

Req 4.4: *"WHEN exporting a graph with cross-references THEN the system SHALL
include reference metadata and optionally embed referenced entities."*

- `ImportService.applyImportWithRollback` built `crossGraphRefMap` from
  `exportData.crossGraphRefs` and never read it. That was the **only** consumer of
  the field in the backend.
- `ExportService.convertToExportFormat` converted events, arcs, relationships and
  pressures and never populated `crossGraphRefs`, though the type declares it.
- `GraphService.registerCrossGraphReference` has zero callers outside its own
  tests, so the parallel `cross-references.json` registry is also never written.

Net effect: an export → import → export round trip silently deleted every
cross-graph reference, and no code path could create one.

### 2. The async-export trigger was byte-based (Req 5.4)

Req 5.4: *"WHEN exporting a large graph (>10k entities) THEN the system SHALL
create an async job with progress tracking."*

`POST /export/sync` refused at a **5 MB** estimate and `ExportService.exportGraph`
at a **50 MB** estimate. Neither is an entity count, so a graph with 12,000 tiny
events was returned synchronously while a 3,000-entity graph of long descriptions
was refused. No code path compared against an entity threshold.

### 3. The designed `GET /api/export` did not exist (design §Export API)

The design specifies `GET /api/export?graphId&scope&includeProvenance&filters[...]`
returning `AlthistoryExport`. Only `POST /export/sync` and `POST /export/jobs`
existed.

## Changes

### Cross-graph references survive the round trip

`ImportService` now attaches each reference to the entity it describes, under the
entity's `metadata.crossGraphRefs` (metadata is the only free-form field the
entity commit path copies verbatim, and the format defines no per-entity field
for references):

- events and arcs: `metadata.crossGraphRefs`
- relationships: the commit payload now carries the optional `metadata` object
  too, so `localEntityType: 'relationship'` is preserved rather than silently
  dropped
- `localEntityId`/`localEntityType` are not stored: the containing entity already
  supplies them, and a local id renamed during import must not produce a stale
  reference
- `embeddedEntity` is not stored: it is a copy of data the referenced graph owns,
  so keeping it would duplicate that data and let it go stale
- lookups use the *exported* id, before `getEntityId` remaps it, because that is
  the id the reference names

`ExportService.convertToExportFormat` hoists them back out:

- references are collected from the entities actually included by the filters, so
  a filtered export never emits a reference to an entity it dropped
- the private `crossGraphRefs` key is removed from the exported metadata rather
  than duplicated in both places
- `localEntityId`/`localEntityType` are taken from the containing entity
- malformed entries (no referenced graph id, no referenced entity id, or a
  referenced type other than `event`/`arc`) are dropped
- `data.crossGraphRefs` is omitted entirely when there are none, so its absence
  keeps meaning "no cross-graph references"

The checksum covers the data section, so references are now covered by it.

### Entity-count async trigger

- `ExportService.asyncExportThreshold` (default `10_000`, Req 5.4), overridable
  through `LOCAL_EXPORT_ASYNC_ENTITY_THRESHOLD`, validated at startup.
- `ExportService.countEntities(options)` — for an unfiltered export of the latest
  version it sums `graph.metadata`, which `GraphRepository.commitChanges`
  recomputes on every commit (`calculateMetadata`), so the decision does not load
  the graph. A filtered or pinned-version export counts the exact tree, because
  neither the metadata totals nor the predicates can be evaluated without it.
- `ExportService.shouldUseAsyncExport(options)` implements the rule.
- `exportGraph` now returns `entityCount` alongside `size`.
- `POST /export/sync` refuses above the threshold and names both job endpoints.
  The 5 MB estimate check is kept as a second, memory-safety guard for a small
  entity count with pathological descriptions.
- `GET /api/export` applies the rule automatically: at or below the threshold it
  returns the export document; above it, it creates the job Req 5.4 asks for and
  answers `202` with the job id and entity count.

### `GET /api/export`

Query parsing accepts both encodings the design implies — bracket notation
(`filters[actors]=a,b`) and a JSON-encoded `filters` value. `graphId` follows the
same reconciliation rule as the POST bodies: optional, but a contradiction with
`X-Graph-Id` is a 400 rather than a silent re-scope. The synchronous response is
the export document itself with a `Content-Disposition` filename, not the
`{ success, data }` envelope the POST routes use, because the design specifies the
document (it is the downloaded file).

## Verification

| Gate | Result |
| --- | --- |
| `npx tsc --noEmit` (timeline) | clean |
| `npx eslint` (touched files) | clean |
| `npm test` (timeline) | 87 files, 1667 tests passed |

New tests:

- `ExportService.test.ts`: entity count from metadata vs filtered tree, threshold
  boundary (exactly at the threshold stays synchronous), default threshold,
  reference hoisting out of event/arc/relationship metadata, metadata key not
  duplicated, references scoped by filters, malformed references dropped,
  `crossGraphRefs` absent when none exist.
- `ImportService.test.ts`: imported references are stored on the entities they
  describe and survive import → export with the imported ids.
- `api/routes/export.test.ts` (new, request-level against the real container):
  raw document response, `202` + job above a lowered threshold, bracket-notation
  and JSON filters, filtered-without-filters 400, contradicting `graphId` 400,
  invalid scope / `includeProvenance` 400, `POST /export/sync` refusal message,
  small graph still synchronous, unauthenticated 401.

## Residual gaps (not fixed here)

- `GraphService.registerCrossGraphReference` / `getReferencesFromGraph` /
  `getReferencesToGraph` (and the `cross-references.json` registry plus the
  reference-change notifications) remain unwritten and unused. The round trip no
  longer depends on them; consolidating the two representations is a separate
  decision, not a contract fix.
- `estimateExportSize` still estimates from `graph.metadata` with per-type byte
  weights (500/300/200/400). That is now only a secondary memory guard for the
  synchronous path and the job-size estimate; the requirement-driven decision is
  the entity count.
- `GET /api/export` does not accept a `version` query parameter; the design does
  not define one. `ExportService.exportGraph` still supports it.
