# Streaming exports (issue #36)

Branch: `fix/stream-large-exports`

`POST /export/jobs` exists so a large graph can be exported without holding the
document in a synchronous response, and Req 5.4 makes it the required path above
10k entities. It could not do that job.

## What was broken

`JobService.executeExportJob` called `ExportService.exportToFile`, which called
`exportGraph`, which enforced a **50 MB estimate ceiling** before building the
document. A graph of roughly 110k events therefore got `202` from
`GET /api/export` (correct — it is above the entity threshold) and then had its
job fail with:

```text
Export too large for in-memory operation (estimated 55MB, max 50MB).
Use exportToFile() for large exports or create an async export job.
```

So the async path existed, was chosen automatically, and then refused the export
by advising the caller to use the async path. The ceiling was also the wrong
quantity: it was a per-type byte heuristic over `graph.metadata`, not a measure of
the work.

## Changes

`exportToFile` no longer routes through `exportGraph`. It resolves the version,
checks out the tree, applies the filters, then **streams** the document to disk:

- `convertEvent` / `convertArc` / `convertRelationship` / `convertPressure` are
  extracted from `convertToExportFormat` so the in-memory and streaming paths
  share one definition of the format. Property order is part of the contract:
  the checksum is over the serialised bytes, so two implementations that drifted
  in key order would disagree about the same graph.
- `exportDataChunks(data)` yields the data section as `JSON.stringify` would
  produce it — `{"events":[…],"arcs":…,"causalRelationships":…,"inferredPressures":…}`
  with `crossGraphRefs` last and omitted when empty — but one entity at a time.
- `checksumOfExportData(data)` hashes that same chunk stream, and
  `exportDocumentChunks` writes it, so the hash and the bytes can never come from
  different serialisations. This is what makes the streamed checksum equal the
  in-memory one (`ExportService.test.ts`, "should produce the same document the
  in-memory path returns").
- The document is written through `stream/promises.pipeline` from
  `Readable.from(generator)`, so backpressure and write errors are the standard
  stream semantics rather than an ignored `write()` return value.
- The data section is serialised twice: once to hash, once to write. It has to
  be, because the checksum appears in `metadata`, which precedes `data` in the
  document. Each pass is generated and discarded per entity.

  The honest bound is the resolved tree plus **O(entities) bookkeeping, not
  one entity**: the accumulated `crossGraphRefs`, the provenance object (whose
  `entityIds` lists every entity added across up to 1000 versions), and one
  `Object.keys` array per section. That is still far below the previous peak
  (tree + document + two document-sized JSON strings), and the serialisation
  itself allocates one entity at a time.

`maxInMemorySize` is now a constructor option (default 50 MB) so the boundary is
testable. The ceiling still applies to `exportGraph`, which genuinely returns the
whole document as an object; its message now says that, and names the three paths
that stream.

### Progress

Req 5.4 also asks for "progress tracking", and until now the job reported exactly
three values (10, 50, 100).

`exportToFile` accepts `ExportHooks`. `onPhase` announces which of the two
serialisation passes is running (the hashing pass is about half the work and was
otherwise invisible), and `onProgress` receives a fraction **after every entity**
in the writing pass. `JobService` reports 55 for each phase, maps the fraction
into 60–95, and persists whole percentage points only: the first draft reported
at section boundaries, which for a graph of any size meant progress moved four
times and the de-duplication guarded a case that could not happen.

## Deliberate behaviour changes

- **Export files are compact JSON.** They used to be
  `JSON.stringify(doc, null, 2)`. Reproducing two-space indentation through a
  generator is possible, but only by hand-rolling the formatter and keeping it in
  lock-step with `JSON.stringify` forever; the file is machine-read (import parses
  it), and the checksum covers `data` either way.
- **The in-memory ceiling no longer applies to the job path**, which is the point
  of the issue. The real ceiling for a streamed export is the process heap, which
  the tree already dominates.

## Review round

An adversarial review of the first cut found one blocker and several
claim-vs-code gaps. All fixed:

- **Blocker: cancelling a job mid-stream could terminate the process.** Progress
  was persisted with `void this.reportProgress(...)`; `reportProgress` rejects
  when the job is no longer `processing`, and Node ends the process on an
  unhandled rejection. A `DELETE` during a long export was enough. Progress
  writes now go through one promise chain that is awaited before the terminal
  write, skips once the job leaves `processing`, and logs (rather than throws)
  a failed write.
- **The same chain fixes overlapping writes.** `JobRepository` persists by
  truncating and rewriting one file; two unordered `writeFile` calls could leave
  a shorter document over a longer one, and a job file that no longer parses is
  dropped on the next start.
- **Progress moved only at section boundaries** — at most four times for any
  graph, so the "whole percentage points only" throttle protected a case that
  could not happen, and a 110k-event graph sat still for its entire run.
  `onProgress` now fires after every entity, and the hashing pass announces
  itself.
- **The request-level test did not reproduce the failure.** `largeGraph` has 4
  entities (~3.7 KB), nowhere near the 50 MB ceiling, so restoring the old
  `exportToFile` would not have failed it. The suite now configures
  `LOCAL_EXPORT_MAX_IN_MEMORY_BYTES` low enough that the same options are refused
  by `exportGraph` and delivered by the job.
- **The `exportGraph` message could re-recommend the failing path.** For an
  unfiltered filtered-scope export the estimate came from `graph.metadata` and
  ignored filters, so a small filtered export could be refused with advice to use
  the endpoint the caller had just used. A filtered or pinned export is now
  estimated from the tree it will actually export.
- Test sensitivity, per the review's mutations: the "chunked" test now requires
  more chunks than the head/data/tail envelope (a single `JSON.stringify` of the
  data section would still pass the old assertion); the progress test requires
  one in-band value per entity; and the streaming test now hashes the *written*
  bytes, runs `validateExport` on the streamed document, and covers
  `crossGraphRefs`, `sourceRef`, nested metadata and non-ASCII text, which the
  original fixture never reached.

## Verification

| Gate | Result |
| --- | --- |
| `npx tsc --noEmit` (timeline) | clean |
| `npx eslint` (touched files) | clean |
| `npm test` (timeline) | 88 files, 1763 tests passed |

New and changed tests:

- `ExportService.test.ts`
  - the streamed document deep-equals `exportGraph`'s document, checksum included
    (the acceptance criterion);
  - a graph above a lowered `maxInMemorySize` is refused by `exportGraph` and
    exported successfully by `exportToFile` (the other acceptance criterion);
  - the document is emitted as multiple chunks, so it is streamed and not one
    buffered write;
  - progress fractions are monotonic and end at 1;
  - a filtered export streams only the included entities and records its filters;
  - provenance is appended when requested;
  - the existing `exportToFile` tests now capture the written bytes through a real
    `Writable`, so `pipeline` is exercised rather than bypassed.
- `JobService.test.ts`: the streamed progress reaches the repository at
  intermediate values (61, 73) rather than only 50 and 100.
- `api/routes/export.test.ts` (request-level): a graph above the threshold gets
  `202`, the job **completes**, and its download contains the full document —
  the end-to-end form of the original failure.

## Residual

- A job that fails mid-stream leaves a partial file. Nothing serves it (the job
  is `failed`, and `getExportFilePath` only answers for `completed` jobs), but
  nothing ever deletes it either: job expiry removes `jobs/<id>.json` only, and
  no code path cleans `exports/`. Cleaning both partial and completed files on
  expiry is a small follow-up.
- The tree itself is still resolved into memory (`GraphRepository.checkout`), so
  a graph larger than the heap cannot be exported regardless of streaming. Fixing
  that means a version-store read path that yields entities instead of a map.
