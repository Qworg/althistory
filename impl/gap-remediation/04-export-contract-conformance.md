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

### Review round: things the first version got wrong

An adversarial review of the first cut found four defects, all fixed here:

- **`?version` was dropped on the async path.** `GET /api/export` counted the
  pinned tree, then handed the request to `JobService`, whose job parameters had
  no `version` field — so a 12k-entity v3 export returned `202` and the job
  exported the head. `version` is now carried through
  `CreateExportJobRequest` → `ExportJobParams` → `executeExportJob`, and both the
  inline and job paths are tested against a graph with two differing commits.
- **Cross-graph relationship endpoints were still lost on import.** The commit
  payload rebuilt relationships field by field and omitted `causeGraphId` /
  `effectGraphId` / `sourceRef`, so an imported remote cause was stored as a
  local event id that does not exist. Now preserved, with a round-trip test.
- **The webhook guard could be bypassed with a redirect.** `fetch` followed 3xx
  by default, so a public URL could re-POST the payload to
  `169.254.169.254` or the admin port. The request now uses
  `redirect: 'manual'` and a 3xx is a terminal delivery failure.
- **`metadata.graphVersion` named the metadata counter, not the exported
  version.** `?version=0` returned v0's data labelled with the current counter
  (and the download filename said so too). The label now comes from the resolved
  version ref.

The same defect class was fixed on the POST paths: a body `version` is validated
and carried into `POST /export/jobs`, `POST /export/sync` now honours it (it was
typed but silently ignored), and `estimateExportSize` estimates a pinned tree
from that tree rather than from the head's metadata, so a small historical
export is not refused because the head is large.

Smaller fixes from the same round: progress is persisted through the repository
instead of only emitted (`GET /export/jobs/:id` used to sit at 0% until
completion); a rollback now recomputes `graph.metadata` (it commits through the
version repository directly, so the export entity-count trigger could read
pre-rollback counts); an unknown `?version` is a 404 instead of a 500; webhook
targets use `net.BlockList` range matching (`::`, `localhost.`, NAT64 and
IPv4-mapped forms are covered, and `::ffff:0:0/96` is handled in code because a
mapped IPv6 subnet also matches every IPv4 lookup); `scope=full` with filters is
a 400 instead of silently ignoring them; the threshold env var must be digits
only; and `JobService.initialize` fails import/ingest jobs left runnable by a
previous process, which the earlier "dead stubs" removal would otherwise have
orphaned.

## Review round 2

A second adversarial pass over the review fixes found that three of the round-1
claims were still broader than the code, plus consistency and authorisation
gaps. All fixed here:

- **`POST /export/jobs` accepted a version that does not exist** (202, then a
  failed job) while `GET /api/export` and `POST /export/sync` answered 404 for
  the same input. `createExportJob` now resolves the version before creating
  the job.
- **`exportGraph` measured the tree before resolving the version**, so a
  missing pinned version surfaced as the store's plain `Error` (a 500) for any
  caller that had not validated first. Resolution now happens before any read.
- **The job path was tested only up to `job.parameters`** — deleting the
  `version` pass-through into `exportToFile` failed nothing. A test now runs a
  pinned job and asserts the version reaches the exporter.
- **The three routes disagreed on the same input**: `scope=full` with filters
  was a 400 on GET and silently ignored on both POSTs; `scope=filtered` without
  filters was a 400 on GET and `/jobs` but a 200 on `/sync`; a string
  `includeProvenance` was a 400 on GET and truthy on the POSTs. Both POSTs now
  parse the body through one `parseExportBody`, mirroring the GET parser.
- **Export job routes were not graph-scoped**: a key with `export` permission
  but a restricted `allowedGraphs` list could list, fetch and delete another
  graph's export jobs, and download its file. The list filters by
  `canAccessGraph`, and get/delete/download answer 404 (not 403, which would
  confirm the id) for a job outside the key's graphs.
- **Events and arcs still lost `sourceRef` on import**, the same class as the
  relationship fix; preserved and covered.
- **A recent crash left an export `processing` forever**: `recoverStalledJobs`
  only ages out old rows. Startup now re-queues `processing` exports to
  `pending` (re-running an export is safe).
- Webhook ranges extended (`192.0.0.0/24`, `198.18.0.0/15`, `240.0.0.0/4`,
  `fec0::/10`, `64:ff9b:1::/48`, deprecated IPv4-compatible `::/96`); repeated
  trailing dots (`localhost...`) stripped; `version` query strings must be
  digits only (`0x10`, `1e2` rejected); the job-creation size estimate now
  honours the pinned version; and `config.ts` / `config.test.ts` were restored
  to their original CRLF endings, which had turned a 27-line change into a
  583-line diff.

The second round also corrected the round-1 note's claim that a rename test
"proves a stored reference follows the new id": stored references carry no local
id, so the test guards the *lookup by exported id*, not a rewriting step.

## Review round 3

The third pass found that round 2's headline claim — one parser so identical
input gives identical status codes on all three routes — was still false for
`filters`, and that two other claims were broader than the code.

- **POST bodies skipped filter normalisation.** `parseExportBody` only ran
  `validateFilters`, which checks array-typed keys and nothing else, so
  `{"scope":"filtered","filters":"x"}` was a **200 full export** while the same
  input on the query string was a 400 — the "acknowledged filter, exported
  everything" bug reappearing through a type confusion. Both paths now share
  `normalizeFilters` → `asExportFilters`, so non-objects, non-string list
  entries and unknown keys are handled identically, and a table-driven test
  sends six malformed payloads to all three routes and requires the same status.
- **A POST body without `scope` was accepted** by the new parser (it inherited
  the GET default), where round 1 returned 400 and the design makes `scope`
  required in a body. Now a 400 on both POSTs; the GET default stands.
- **Job scoping was still porous**: a key restricted to graph A could read or
  delete an *import* or *ingest* row through the export routes (no `job.type`
  check), `/stats` counted every graph's jobs and every job type, and the access
  helper failed *open* when no key was attached. Non-export jobs now 404, the
  helper fails closed, and `/stats` is computed from the jobs the caller may
  see.
- **Startup recovery ran after the stall sweep.** `recoverStalledJobs` fails any
  `processing` row older than the timeout, so an export interrupted by a crash
  and a restart 31 minutes later was failed instead of re-queued. Re-queueing
  now runs first. The docstring also stopped claiming a re-run "rewrites the
  same output file" — every run writes a new timestamped file.
- **"Checked out once" was true only inside `exportGraph`.** A pinned
  `POST /export/sync` still reads the tree three times (count, estimate,
  export). The claim is now stated for what it is, with a test pinning the
  single checkout and the resolve-before-read order inside `exportGraph`.
- **`sourceRef` was unvalidated on import.** A number or object was stored under
  a string-typed field and re-exported. Non-strings are now warned about and
  dropped.
- Several new tests were mutation-insensitive: the orphan sweep's `findAll` mock
  ignored its filter, so narrowing the sweep would not have failed; the `/jobs`
  unknown-version route test passed even with the pre-create check removed (the
  estimate threw the same error, after a job had already been written) — it now
  asserts the job count is unchanged, and a mutation run confirms it fails. The
  job-scoping test gained a download case and a positive case for the restricted
  key.

## Verification

| Gate | Result |
| --- | --- |
| `npx tsc --noEmit` (timeline) | clean |
| `npx eslint` (touched files) | clean |
| `npm test` (timeline) | 88 files, 1754 tests passed |

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
  and JSON filters, filtered-without-filters 400 on both POSTs, contradicting
  `graphId` 400, invalid scope / `includeProvenance` 400, `?version` pinning and
  its 400, unknown version 404 on GET and `/jobs`, `POST /export/sync` refusal
  message, small graph still synchronous, a restricted key unable to list, fetch
  or delete another graph's job, unauthenticated 401.
- `JobService.test.ts`: pinned version reaches `exportToFile`; a `processing`
  export is re-queued at startup; orphan sweep filter pinned; an invalid stored
  webhook is never POSTed; a redirect ends delivery after one attempt.
- `webhookTarget.test.ts`: private/loopback/NAT64/IPv4-compatible ranges,
  repeated trailing dots, and the false-positive cases (`172.15.0.1`,
  `10.example.com`, `2001:db8::1`).

## Residual gaps and where they live

- The unused cross-graph registry (`GraphService.registerCrossGraphReference`,
  `getReferencesFromGraph` / `getReferencesToGraph`, the `cross-references.json`
  file and the reference-change notifications) still has no writer. The round
  trip no longer depends on it. Tracked in
  [#32](https://github.com/Qworg/althistory/issues/32), which asks for a decision:
  delete the second representation or make it authoritative.
- `estimateExportSize` uses per-type byte weights (500/300/200/400). For an
  unpinned export it reads them from `graph.metadata`; for a pinned version it
  counts the pinned tree. That is by design now: it is the secondary memory
  guard and the job-size estimate, while the requirement-driven decision is the
  entity count. No issue filed.
- An *unpinned* async export runs against the head at the time the worker picks
  the job up, so the `202`'s `entityCount` (computed at request time) can differ
  from the finished file. Recording the resolved head version in the job at
  creation would make it deterministic; not done here.
- A re-queued export has no attempt counter. Re-running is safe for a normal
  export, but a graph that reliably exhausts memory would re-queue on every
  restart. Failing after N attempts needs a counter in the job parameters.
- An export of a graph with **no versions** is labelled `graphVersion: 0`
  (an empty tree), and `?version=0` on that graph is a 404 because no version 0
  exists. The three routes agree with each other, but the label names a version
  that is not there. Pre-existing; fixing it means deciding what an empty graph
  exports as.
- `GET /api/export` accepts `version`, which was the last gap recorded here.
  Adding it removed the residual rather than deferring it.
- **The async path still materialises the document**, so the 50 MB in-memory
  estimate caps the export even when it runs as a job; a large enough graph gets
  `202` and then a failure that advises the async endpoint. Tracked in
  [#36](https://github.com/Qworg/althistory/issues/36).
- **Req 4.4's optional embedding is not implemented**: reference metadata is
  exported, `embeddedEntity` never is. Tracked in
  [#37](https://github.com/Qworg/althistory/issues/37), which also covers the
  authorisation question (embedding reads another graph's data into the file).
