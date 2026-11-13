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

### Prose about an invented world

Ingesting text into a graph with world calendars (see
[the MCP guide](mcp-agent-guide.md#inventing-a-world) and
[the spec](specs/world-calendars.md)) tells the model how each of them names
a date, and has it write every date that way: "the Tide War began on
Midyear's Day, 141 AR" is read by the graph's own calendar, a month or a year
alone ("in Thaw of 141 AR") with that precision. The review step shows and
takes dates in the world's notation too. The patterns read only Gregorian
dates, which an invented world does not use: for a world, use `llm` (the
pattern reader's dates would be places on the timeline, not the world's
days).

Both ingestion paths do this. The CLI's in-process ingestion (the CLI and the
MCP server when no app is running) reads the target graph's calendar, and
also names the arcs it groups the events into in the world's years. The app's
review flow, `POST /api/ingest/text`, reads the calendar of the graph its
`X-Graph-Id` header names; the app's import wizard sends the graph it will
import into, and the CLI sends `--graph-id`. A request without the header is read
without a calendar. The review table shows every date in the world's calendar,
and the box you edit holds it in the world's notation; ISO 8601 typed there
is read too. An arc's edited end without a time is the last moment of the
day, month or year it names.

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

`llm` and `hybrid` make **two** model calls per source document, whatever the
event count: one to extract the events, one to suggest the causal links
between them. Link-following does not add model calls — the Wikipedia
extractor runs without a model client. `pattern` costs nothing.

`--dry-run` still calls the model: it skips *writing*, not reading.

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

### Fetching from Wikipedia and Wikidata

Wikimedia rate-limits by client: a request identified only by its IP gets 10
a minute, a bot with a User-Agent that names a contact gets 200
([Rate limits](https://www.mediawiki.org/wiki/Wikimedia_APIs/Rate_limits)).
The server sends `AlthistoryBot/1.0 (https://github.com/Qworg/althistory)`,
plus `WIKIMEDIA_CONTACT` if you set it, starts at most one request every
400 ms across all ingestions, and on a 429 or 503 waits out `Retry-After` (or
5 s, 10 s, 20 s without one) before retrying, up to three times. A 50-page
crawl therefore takes upwards of 20 s; ingest routes get a 5-minute budget
(`INGEST_TIMEOUT_MS`). If Wikimedia is still refusing after the retries, the
route answers **503** with `details.retryAfterSeconds` when Wikimedia gave one;
a missing page is **404**.

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
extraction into a graph it cannot access. The reviewer's dates are read
with that graph's calendars, not those the job was extracted with: a date in
a world's notation goes only into a graph of that world.

`validationIssues` are worth reading: they name the events that were dropped
and why (no date, no actor, below the confidence threshold).

## Sources

| Source | What it reads | Notes |
| --- | --- | --- |
| `text` | A sentence stream. | Dated sentences become events. |
| `wikipedia` | Article prose. | Link-following and depth are bounded (depth ≤ 3). |
| `wikidata` | An item's claims. | Dates and participants come from the item. |
| `text` | Pasted text — or the text of a fetched page. | `ingest url` on a non-Wikipedia page reads it as a text document, so its events are `text`-sourced. |

Events ingested **through the API** carry a `sourceRef` naming where they came
from, and that value survives export. Events ingested **through the CLI** do
not: the CLI writes description, actor, target and timestamp only. If you need
the provenance, use the API door.

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
