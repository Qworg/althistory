# The Althistory CLI

`althistory` is the agent-first interface to the system: every command reads
JSON on stdout, writes its progress to stderr, and answers with a semantic
exit code (`0` success, `1` general error, `2` validation failed, `3`
authentication failed, `4` not found, `5` connection failed).

The CLI runs in two modes. `--direct` (or the `LOCAL_EXECUTION_ENABLED`
environment) runs in process against the local store; without it the CLI talks
to the daemon over HTTP, and every request that names a graph says so in the
`X-Graph-Id` header the daemon reads.

## The commands

| Command | What it does |
|:---|:---|
| `status` | Reports the health and the execution mode. |
| `graph list\|create\|info\|branch\|merge\|diff\|rollback\|delete` | Manages the graphs. |
| `event add\|list\|get\|update\|delete` | Manages the events of a graph. |
| `arc create\|list\|get\|delete\|assign` | Manages the narrative arcs. `assign` puts an event inside an arc. |
| `causal link\|unlink\|list\|paths` | Manages the causal links and finds the paths between two events. |
| `ingest text\|url\|wikidata` | Extracts events from a text, a page or Wikidata. |
| `generate timeline\|branch\|expand\|simulate` | Generates an alternate history, a branch, an expansion or a simulation. |
| `validate` | Validates a graph, and with `--auto-repair` repairs what it can. |
| `export` | Exports a graph as `json`, `markdown`, `dot` or `graphml`. |
| `import` | Imports a graph from a JSON document. |
| `schema` | The JSON Schema of every command, with the required options and arguments marked required (`--mcp` for the MCP tool dictionary, `--tool` for one tool). The default output used to be the MCP tool dictionary; it is now the command schema, which is what the flag list has always described. |
| `mcp` | The stdio MCP server. |

## The ingestion modes

`ingest text --mode` selects how the text is read, and the three modes are
three different things:

- `pattern` reads the text with the deterministic extractor only;
- `llm` asks the language model, and fails when no model answered, rather
  than reporting a pattern extraction as a model one;
- `hybrid` reads the text both ways and keeps the union.

The union is a union of *events*, not of readings: when the two readings
describe the same event -- the model paraphrasing the sentence the patterns
read -- they become one event, and the copy with the higher confidence wins.
The two readings are matched on the event itself, not on the wording: the
date it happened and the words that say who did what. A model that answers
"Adoption of the Declaration of Independence" has still found the event the
sentence "On 4 July 1776, the Continental Congress adopted the Declaration
of Independence" describes, so a hybrid ingestion does not write every event
twice.

`--dry-run` writes nothing at all: not the events, and not the graph it would
have written to.

`ingest url` reads a Wikipedia article through the Wikipedia extractor, and a
page on any other site as a web document: the page is fetched over HTTPS,
converted from HTML to text and read by the text extractor -- with the
language model when one is configured, and with the patterns when it is not.
It is not read the way the pasted text is: the pasted text has three modes
and defaults to the union of the two readings, while `ingest url` has no mode
of its own and the web document extractor asks the model first and falls back
to the patterns.

The web document fetch refuses a page that is not served over HTTPS, and a
host that is internal: a loopback, private, link-local or unique-local
address, whether it is written as an IPv4 or an IPv6 literal, and the names
that are reserved for internal use (`localhost`, `*.local`, `*.internal`). A
host *name* that resolves to an internal address is not caught -- that needs
a DNS lookup, which the client does not do -- so the guard is a check on the
address and on the reserved names, not on where the name points. The body is
read as a stream and the page is refused once it grows past five megabytes.

## The generation flags

`generate timeline --depth` is the number of levels of arcs the timeline has:
at depth one the arcs are the periods, and every further level wraps them in
an enclosing arc. `--style` (`academic`, `narrative`, `concise`) is how the
timeline is written. `generate expand --time-window` is the window to
interpolate into, as two ISO-8601 instants separated by a slash
(`2020-01-01T00:00:00Z/2020-12-31T00:00:00Z`); the expansion is recorded as
an arc, a child of the arc it expands when there is one.

## What the daemon cannot do

The daemon serves no generation routes: there is no
`POST /api/generate/timeline`, `/branch` or `/expand` in the backend, so
`generate timeline`, `generate branch` and `generate expand` need `--direct`.
In remote mode the CLI fails with a message naming the route that is missing;
it does not fall back to a different route. `generate simulate` works in both
modes, because the daemon serves `POST /api/inference/simulate`.

The daemon's ingestion routes do not write anything. They run the extractor
and return a *review job* that holds the extracted entities until a reviewer
approves it, so a remote `ingest` creates no events: the result says so
(`"eventsCreated": 0`, and the `pendingReview` block names the job the
entities are waiting in), and no graph is created for `--graph-name` either.
The provider is the daemon's, so `--provider` and `--model` are the daemon's
business in remote mode, and the daemon's `/api/ingest/url` route reads
Wikipedia only -- a page on any other site is `ingest url` in `--direct`
mode.

The remote engine computes the graph diff and the causal paths itself: the
daemon serves `GET /api/graphs/:id/data` and `GET /api/causal/relationships`,
but no diff route and no path route.

The remote validator is the CLI's own. The daemon's `POST /api/validate/graph`
validates the arrays it is given, so the CLI fetches the graph's events, arcs
and relationships and runs the same validator the direct engine runs -- which
also finds the causal cycles and the cross-graph references that the daemon's
validator does not look for.

`--auto-repair` removes the link of a paradoxical causal pair and adds the
reversed one, so that every surviving link points forward in time; it does
not have to break a cycle to do it. A link the store refuses to delete is
reported as such and the repair carries on: the daemon looks the ends of a
link up before it deletes it, so an orphaned link is still there after the
repair, and the report says so instead of claiming that it was removed. The
repairs that were made are listed in `repairsApplied`, and the ones that were
not -- with the reason -- in `repairFailures`.

A reference that points into another graph is not deleted: the fix for that is
to copy the entity into this graph, not to remove the reference. The same goes
for a causal link whose end lives in another graph, and for a reference whose
cross-graph lookup failed: a reference that could not be checked is left
alone.
