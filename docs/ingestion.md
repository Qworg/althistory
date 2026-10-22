# Ingestion

Getting history *into* a graph. There are two doors — the CLI and the HTTP
API — and behind both is the same pipeline.

Written from the implementation: `timeline/src/services/ingestion/`
(extractors, `mergeExtractions`, the orchestrator),
`timeline/src/api/routes/ingest.ts` and `timeline/src/cli/engine/`.

## What ingestion does

1. **Extract** dated events (and, optionally, arcs and causal links) from a
   source — pasted text, a web page, or Wikidata.
2. **Validate** what came out and report what it could not use.
3. **Persist** it, either immediately (CLI) or after a review step (API).

The extractor produces *events*, not prose. Each one has a description, an
actor, a target, a timestamp and a confidence. Nothing is invented: if the
source does not state a date, no event is produced for it.

## Extraction modes

`--mode` on the CLI; `useLLM` over the API. The two readings are:

| Mode | What it does | When to use |
| --- | --- | --- |
| `pattern` | Regular expressions over the text. No network, no cost, no key. | Offline, deterministic, or when you want to see what the patterns alone find. |
| `llm` | Asks a model. Requires a provider key. | Prose that patterns miss. |
| `hybrid` (default) | Runs both and merges the two readings. | Almost always. |

`hybrid` merges by the *event*, not by the wording: a model paraphrase of the
same sentence is not written a second time. Where both readings found the same
event, the higher-confidence copy wins and the model's relationships still
name the surviving event.

`--mode llm` **fails** when no model answered, rather than presenting
pattern output as the model's.

### Provider selection

The provider is inferred from the environment, or named with `--provider`:

| Provider | Key |
| --- | --- |
| `openai` | `OPENAI_API_KEY` |
| `anthropic` | `ANTHROPIC_API_KEY` |

If the selected provider has no key, no client is built and extraction stays
pattern-based. `--model` and `--temperature` are passed through to the
provider; the defaults are the provider's own.

### Cost

`llm` and `hybrid` make one model call per source document (not per event),
plus one per followed link when link-following is on. `pattern` costs nothing.
`--dry-run` still calls the model — it skips *writing*, not reading.

## The CLI

```bash
# Pasted text, a file, or stdin
althistory ingest text "On 4 July 1776 the Congress adopted the Declaration."
althistory ingest text --file ./sources/revolution.txt
cat article.txt | althistory ingest text

# A web page (HTTPS only)
althistory ingest url https://en.wikipedia.org/wiki/French_Revolution
althistory ingest wikidata Q6534
```

| Flag | Meaning |
| --- | --- |
| `-g, --graph-id <id>` | Target graph. Creates one when omitted. |
| `--graph-name <name>` | Name for the graph created when `-g` is absent. |
| `-m, --mode <mode>` | `pattern`, `llm` or `hybrid`. Default `hybrid`. |
| `--provider`, `--model`, `--temperature` | Model selection. |
| `--group-arcs` | Cluster the extracted events into narrative arcs. |
| `--infer-causes` | Infer causal links between them. |
| `--min-confidence <0..1>` | Drop events below this confidence. |
| `--dry-run` | Show what would be written; write nothing, not even the graph. |
| `--follow-links`, `--depth`, `--max-pages`, `--filter` | URL ingestion: follow links out of the page. |

`ingest url` accepts any public HTTPS page, not only Wikipedia. The fetch
refuses internal addresses — including a public-looking name that resolves to
one — caps the body at 5 MB **decompressed**, and follows at most five
redirects, checking each hop.

## The HTTP API

All routes are under `/api/ingest` and require the `ingest` permission.

| Route | Purpose |
| --- | --- |
| `POST /api/ingest/text` | Extract from pasted text. Answers a **preview**. |
| `POST /api/ingest/url` | Extract from a Wikipedia page (`strategy: "wikipedia"` or `"auto"`). |
| `POST /api/ingest/wikidata` | Extract from a Wikidata item. |
| `GET /api/ingest/jobs/:id` | The job's status. |
| `GET /api/ingest/jobs/:id/preview` | What was extracted, for review. |
| `POST /api/ingest/jobs/:id/approve` | Commit the reviewed extraction to a graph. |
| `DELETE /api/ingest/jobs/:id` | Discard it. |

### The review step

Unlike the CLI, the API does **not** write on extraction. It answers with an
`IngestionPreview`:

```json
{
  "jobId": "job-abc",
  "status": "review",
  "extraction": {
    "events": [ "..." ],
    "arcs": [ "..." ],
    "relationships": [ "..." ],
    "sources": [ "..." ]
  },
  "validationIssues": [ "..." ]
}
```

Nothing is saved until `POST /api/ingest/jobs/:id/approve`. That is
deliberate: extraction is lossy and a human should see what the model
produced before it becomes history.

Approval is bound to the graph the request is scoped to. A `targetGraphId` in
the body must match the resolved graph context, so a key cannot approve an
extraction into a graph it cannot access.

`validationIssues` are worth reading: they name the events that were dropped
and why (no date, no actor, below the confidence threshold).

## Sources

| Source | What it reads | Notes |
| --- | --- | --- |
| `text` | A sentence stream. | Dated sentences become events. |
| `wikipedia` | Article prose. | Link-following and depth are bounded (depth ≤ 3). |
| `web` | Any public HTTPS page. | Refuses internal addresses; 5 MB cap. |
| `wikidata` | An item's claims. | Dates and participants come from the item. |

Each source has a `sourceRef` recorded on the events it produces, so an event
can be traced back to where it came from. That value survives export.

## What ingestion does not do

- It does not invent dates. An undated sentence yields no event.
- It does not merge into an existing event. Re-ingesting the same source
  produces the same events again; see [conflict handling](#conflicts).
- It does not run the merge validator. Two graphs combine through
  [`docs/branch-merge-resolver.md`](./branch-merge-resolver.md), which checks
  anomalies an import would not.

## Conflicts

The API path creates new entities; it does not reconcile with what is already
in the graph. To combine an ingested graph with another one, export and
import with a conflict strategy (`skip`, `overwrite`, `rename`, `manual`), or
merge the graphs — see [`docs/export-format.md`](./export-format.md) for the
document and [`docs/branch-merge-resolver.md`](./branch-merge-resolver.md)
for the merge.
