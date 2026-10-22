# Export format

The Althistory export document is what `GET /api/export` returns and what
`althistory export` writes. It is the interchange format: an export can be
imported into another graph, and a third party can read it without running
the server.

This document is written from the implementation, not from the design:
`timeline/src/services/ExportService.ts` builds the document,
`timeline/src/services/ImportService.ts` reads it, and
`timeline/src/api/routes/export.ts` is the HTTP surface. Where the two
disagree, the code is what ships — so if you find a mismatch, that is a bug
and worth an issue.

## Top level

```json
{
  "version": "1.0",
  "metadata": { "...": "..." },
  "data": { "...": "..." },
  "provenance": { "...": "..." }
}
```

| Field | Type | Always present | Meaning |
| --- | --- | --- | --- |
| `version` | `"1.0"` | yes | The **format** version. Import accepts `"1.0"` and nothing else; any other value is rejected with `UNSUPPORTED_VERSION`. |
| `metadata` | object | yes | Provenance and integrity information about the export itself. |
| `data` | object | yes | The graph's entities. This is the section the checksum covers. |
| `provenance` | object | only with `includeProvenance` | How the graph was built. |

Three versions are in play and they mean different things:

- `version` — the shape of *this document*. `"1.0"`.
- `metadata.graphVersion` — the graph's own committed version number, or `0`
  when the graph has no committed version (the head).
- `metadata.sourceVersion` — the version of the Althistory build that wrote
  the file (`"1.0.0"` unless configured otherwise).

## `metadata`

| Field | Type | Meaning |
| --- | --- | --- |
| `graphId` | string | The graph the entities came from. |
| `graphName` | string | Its name at export time. |
| `description` | string? | Its description, omitted when empty. |
| `exportedAt` | string (ISO 8601) | When the export ran. |
| `sourceVersion` | string | The exporting build, as above. |
| `graphVersion` | number | The committed version exported, or `0` for the head. |
| `checksum` | string | Lowercase hex SHA-256 of the `data` section. See below. |
| `filters` | object? | Present **only** when `scope=filtered`; records the filters that were applied, so a reader can tell a partial export from a full one. |

## `data`

All four arrays are always present, even when empty. `crossGraphRefs` is
present only when the graph has any.

| Field | Type | Meaning |
| --- | --- | --- |
| `events` | array | See below. |
| `arcs` | array | See below. |
| `causalRelationships` | array | The causal links. |
| `inferredPressures` | array | Pressures inferred from the graph. |
| `crossGraphRefs` | array? | References into another graph. Omitted when empty. |

### `data.events[]`

```json
{
  "id": "evt-1",
  "description": "The Continental Congress adopts the Declaration",
  "actor": "Continental Congress",
  "target": "Kingdom of Great Britain",
  "timestamp": "1776-07-04T00:00:00.000Z",
  "metadata": { "arcId": "arc-1" },
  "sourceRef": "wikipedia:Declaration_of_Independence"
}
```

| Field | Type | Required | Meaning |
| --- | --- | --- | --- |
| `id` | string | yes | Stable identifier, unique within the graph. Import conflict handling is keyed on it. |
| `description` | string | yes | What happened. |
| `actor` | string | yes | Who acted. |
| `target` | string | yes | Who or what was acted on. |
| `timestamp` | string (ISO 8601) | yes | When. Comparisons are by instant. |
| `metadata` | object? | no | Free-form. `arcId` records the arc the event belongs to — that is where the association lives, not in a column of its own. |
| `sourceRef` | string? | no | Where the event came from, when it was ingested. |

### `data.arcs[]`

| Field | Type | Required | Meaning |
| --- | --- | --- | --- |
| `id` | string | yes | Stable identifier. |
| `name` | string | yes | The arc's name. |
| `description` | string | yes | What the arc covers. |
| `start_time` | string (ISO 8601) | yes | Inclusive start. |
| `end_time` | string (ISO 8601) | yes | Inclusive end; must be after `start_time`. |
| `level` | number | yes | Depth in the arc hierarchy: `0` is the outermost. |
| `parent_arc_id` | string \| null | yes | The containing arc, or `null` at the top. Must name an arc in the same document. |
| `metadata` | object? | no | Free-form. |
| `sourceRef` | string? | no | Provenance. |

### `data.causalRelationships[]`

| Field | Type | Required | Meaning |
| --- | --- | --- | --- |
| `id` | string | yes | Stable identifier. |
| `cause_event_id` | string | yes | Must name an event in this document, or one in `causeGraphId`. |
| `effect_event_id` | string | yes | Same. |
| `weight` | number | yes | Strength, `0..1`. |
| `evidence` | string | yes | Why the link is claimed. Non-empty. |
| `confidence` | number | yes | Confidence, `0..1`. |
| `relationship_type` | `"direct"` \| `"indirect"` \| `"contributory"` | yes | The kind of link. |
| `sourceRef` | string? | no | Provenance. |
| `causeGraphId` | string? | no | Set when the cause lives in another graph. |
| `effectGraphId` | string? | no | Set when the effect lives in another graph. |

**Causal order.** The cause may not happen *after* its effect. A cause at the
same instant as its effect is allowed — the two can be part of the same
occurrence, and day-level timestamps make such pairs common. This is the one
rule the whole project uses (`timeline/src/utils/causalOrder.ts`), and the
importer, the merge, the validator and the CLI all apply it.

### `data.inferredPressures[]`

| Field | Type | Required | Meaning |
| --- | --- | --- | --- |
| `id` | string | yes | Stable identifier. |
| `description` | string | yes | The pressure as a sentence. |
| `confidence_score` | number | yes | `0..1`. |
| `pressure_type` | `"economic"` \| `"social"` \| `"environmental"` \| `"political"` | yes | The kind of pressure. |
| `evidence_event_ids` | string[] | yes | The events it is inferred from. |
| `affected_arc_ids` | string[] | yes | The arcs it bears on. |

### `data.crossGraphRefs[]`

| Field | Type | Meaning |
| --- | --- | --- |
| `localEntityId` | string | The entity in *this* graph that points elsewhere. |
| `localEntityType` | `"event"` \| `"arc"` \| `"relationship"` | Its type. |
| `referencedGraphId` | string | The graph it points into. |
| `referencedEntityId` | string | The entity there. |
| `referencedEntityType` | `"event"` \| `"arc"` | Its type. |
| `embeddedEntity` | object? | The referenced entity, copied into this document. Present only when `embedReferences` was requested **and** the caller may read the referenced graph. |
| `embeddedEntityStatus` | `"embedded"` \| `"forbidden"` \| `"missing"` | Why `embeddedEntity` is or is not there: the caller was not allowed to read the other graph, or the entity no longer exists. |

A cross-graph reference is stored on the entity it describes (in
`metadata.crossGraphRefs`) and hoisted here on export. There is no separate
registry.

### `provenance`

Present when `includeProvenance=true`. Mirrors the graph's own provenance:
how it was created, from what, and by which operation. Its shape is the
graph's, not the export format's — see `ExportProvenance` in
`timeline/src/services/ExportService.ts`.

## The checksum

`metadata.checksum` is the lowercase hex SHA-256 of the **serialised `data`
section**, exactly as those bytes appear in the document — not of a
re-serialisation, and not of the whole file.

That matters because `metadata` precedes `data`: the checksum has to be
computed before the document is written, and it has to describe the bytes a
reader will actually see. So the exporter builds the `data` section twice,
identically: once to hash it, once to write it. Both passes use the same
generator (`exportDataChunks`), and the JSON is emitted in a fixed key order,
so the two are byte-identical.

To verify an export:

```js
const { createHash } = require('node:crypto')
const doc = JSON.parse(fs.readFileSync('export.json', 'utf8'))
const data = JSON.stringify(doc.data) // fixed key order, see below
const ok = createHash('sha256').update(data, 'utf8').digest('hex') === doc.metadata.checksum
```

Key order inside `data` is `events`, `arcs`, `causalRelationships`,
`inferredPressures`, `crossGraphRefs`. Within each entity the keys are the
order listed in the tables above. A re-serialisation that reorders keys will
not match — compare bytes, not values.

## Producing an export

`GET /api/export` — see [`docs/api-integration.md`](./api-integration.md) for
auth and graph scoping. Query parameters:

| Parameter | Values | Default | Meaning |
| --- | --- | --- | --- |
| `scope` | `full` \| `filtered` | `full` | `filtered` applies `filters` and records them in `metadata.filters`. |
| `filters` | filter object | — | **Required** for `filtered`, **rejected** for `full`. |
| `version` | number | head | Export a committed version instead of the current graph. |
| `includeProvenance` | boolean | `false` | Add the `provenance` section. |
| `embedReferences` | boolean | `false` | Embed referenced entities; subject to per-graph authorisation. |

A graph above the server's entity threshold (10 000 by default) is exported
as an **async job**: the route answers `202` with a job id instead of the
document. Poll `GET /api/export/jobs/:id`, then download
`GET /api/export/jobs/:id/download`. The CLI does this for you.

From the CLI:

```bash
althistory export <graph-id> --format json          # the document above
althistory export <graph-id> --format markdown      # LLM-friendly context
althistory export <graph-id> --format dot           # Graphviz
althistory export <graph-id> --format graphml       # GraphML for graph tools
```

Only `json` is this format. The others are renderings of the same data.

## Importing

`POST /api/import`, or `althistory import <file>`. The importer:

1. Validates the document — `version` must be `"1.0"`; ids must be unique;
   every reference (`parent_arc_id`, `cause_event_id`, `effect_event_id`,
   `evidence_event_ids`, `affected_arc_ids`) must resolve within the document
   unless it names another graph; causal order must hold.
2. Checks whether the document's entities collide with the target graph.
3. Applies the conflict strategy (`skip`, `overwrite`, `rename`, or `manual`
   to review them), and attaches cross-graph references to their entities.

Import is **not** a merge: see
[`docs/branch-merge-resolver.md`](./branch-merge-resolver.md) for combining
two graphs, which validates anomalies a plain import would not.
