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
  document. Each pass is generated and discarded per entity, so peak memory is
  the resolved tree plus one serialised entity — not the tree plus the document
  plus the document's JSON string.

`maxInMemorySize` is now a constructor option (default 50 MB) so the boundary is
testable. The ceiling still applies to `exportGraph`, which genuinely returns the
whole document as an object; its message now says that, and names the three paths
that stream.

### Progress

Req 5.4 also asks for "progress tracking", and until now the job reported exactly
three values (10, 50, 100). `exportToFile` accepts an `ExportHooks` argument whose
`onProgress` receives a fraction as entities are streamed. `JobService` maps it
into the 50–95% band and persists whole percentage points only — writing on every
entity would mean thousands of repository writes for the graphs this feature
exists for.

## Deliberate behaviour changes

- **Export files are compact JSON.** They used to be
  `JSON.stringify(doc, null, 2)`. Reproducing two-space indentation through a
  generator is possible, but only by hand-rolling the formatter and keeping it in
  lock-step with `JSON.stringify` forever; the file is machine-read (import parses
  it), and the checksum covers `data` either way.
- **The in-memory ceiling no longer applies to the job path**, which is the point
  of the issue. The real ceiling for a streamed export is the process heap, which
  the tree already dominates.

## Verification

| Gate | Result |
| --- | --- |
| `npx tsc --noEmit` (timeline) | clean |
| `npx eslint` (touched files) | clean |
| `npm test` (timeline) | 88 files, 1761 tests passed |

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

- A job that fails mid-stream leaves a partial file. Nothing reads it (the job
  is `failed`, and `getExportFilePath` only serves `completed` jobs), but nothing
  deletes it either until the job expires. Cleaning partial files on failure is a
  small follow-up.
- The tree itself is still resolved into memory (`GraphRepository.checkout`), so
  a graph larger than the heap cannot be exported regardless of streaming. Fixing
  that means a version-store read path that yields entities instead of a map.
