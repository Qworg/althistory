# Implementation Plan: CLI Agent Interface

> **Status:** re-audited against the source. Every ticked box carries the
> `file:line` or test name that proves it.
>
> A tick means the work is done **and reachable** — the code exists, and the
> command reaches it. Where the code exists but the command does not work, or
> only part of it is built, the box says so on its own line (`PARTIAL` /
> `NOT DONE`) rather than reading as a plain tick.

- [x] 1. CLI Scaffolding, Output Formatter & Dual-Mode Engine Core
  - [x] 1.1 Create `cli/` monorepo package structure with `package.json`, `tsconfig.json`, and `vitest.config.ts` _(superseded: the CLI lives in the `timeline` package, as `timeline/src/cli/`, with the entry point at `bin/althistory` — not as a separate workspace package; the CLI's own tests are `timeline/src/cli/cli.test.ts`)_
  - [x] 1.2 Implement `cli/bin/althistory.ts` executable shebang script with Commander CLI option parser _(superseded: `bin/althistory` and `timeline/src/cli/index.ts:12-13`, which builds the Commander program)_
  - [x] 1.3 Implement `ExecutionContext`  `timeline/src/cli/engine/ExecutionContext.ts:8`: auto-detect active backend daemon at `http://localhost:3000` or fall back to Direct in-process mode.
  - [x] 1.4 Implement `DirectEngine`  `timeline/src/cli/engine/DirectEngine.ts:42`: boots `timeline`'s `Container` in headless local execution mode (`LOCAL_EXECUTION_ENABLED=true`).
  - [x] 1.5 Implement `RemoteEngine`  `timeline/src/cli/engine/RemoteEngine.ts:33` _(PARTIAL: it speaks HTTP through axios, not WebSocket, and it sends the graph in the body or query while the server reads the `X-Graph-Id` header (`timeline/src/api/middleware.ts:153-188`), so only `simulate` reaches the right graph; it also calls routes that are not mounted (`/api/generate/*`, `/api/causal`, `/api/graphs/diff`), so several remote commands answer 404 — tracked in [#52](https://github.com/Qworg/althistory/issues/52))_: communicates via HTTP/WS client with the running Express backend.
  - [x] 1.6 Implement Agent-First Output Formatters:
    - Pure machine-readable JSON formatter (`--json`) with standardized error envelopes. `timeline/src/cli/formatters/jsonFormatter.ts:6`
    - Streaming Newline Delimited JSON formatter (`--ndjson`). `timeline/src/cli/formatters/ndjsonFormatter.ts:4` _(PARTIAL: it buffers everything and joins it at the end, rather than streaming)_
    - Stderr progress logger and spinner (ensuring `stdout` stays clean for pipes). `timeline/src/cli/utils/logger.ts` _(PARTIAL: there is a stderr logger, but no spinner and no progress output)_
    - Semantic Unix exit codes (`exitCodes.ts`). `timeline/src/cli/utils/exitCodes.ts:5`
  - [x] 1.7 Add unit tests  `timeline/src/cli/engine.test.ts`, `timeline/src/cli/formatters.test.ts`, `timeline/src/cli/cli.test.ts` for `ExecutionContext`, engines, formatters, and exit code propagation.
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7_

- [x] 2. Text-Based & External Web Ingestion CLI
  - [x] 2.1 Implement `althistory ingest text` command  `timeline/src/cli/index.ts:567` _(PARTIAL: `llm` and `hybrid` behave identically (`timeline/src/cli/engine/DirectEngine.ts:733-735`), and `--dry-run` still creates a graph (`DirectEngine.ts:732`))_:
    - Support `--file <path>`, `--text "<content>"`, and standard input pipe (`cat file.txt | althistory ingest text`).
    - Support `--mode pattern|llm|hybrid`, `--provider openai|anthropic`, `--model <name>`, and `--temperature <val>`.
    - Support `--min-confidence <threshold>` and `--dry-run` preview.
  - [x] 2.2 Implement automatic arc clustering (`--group-arcs`): groups ingested events into hierarchical Arcs by temporal proximity and actor continuity. `timeline/src/cli/generator/arcClustering.ts` _(PARTIAL: the clusters are split on time gaps alone (`arcClustering.ts:83-101`) and capped at eight events (`arcClustering.ts:95`); the actor only names the arc, and every arc is `level: 0` (`arcClustering.ts:60,140`), so the hierarchy is not built)_
  - [x] 2.3 Implement causal inference integration (`--infer-causes`): runs `InferenceService` to link causes to effects during ingestion. `timeline/src/cli/engine/DirectEngine.ts:570-594`
  - [x] 2.4 Implement `althistory ingest url` command: SSRF-hardened extraction from Wikipedia articles and web documents with `--follow-links` and `--depth`. `timeline/src/cli/index.ts:634` _(PARTIAL: only Wikipedia is extracted from; another host is rejected (`timeline/src/services/ingestion/WikipediaExtractor.ts:183-185`))_
  - [x] 2.5 Implement `althistory ingest wikidata` command: extracts entities via predefined presets (`--preset`) or custom SPARQL queries (`--sparql`). `timeline/src/cli/index.ts:675`, `timeline/src/cli/engine/DirectEngine.ts:754`
  - [x] 2.6 Add unit and integration tests for all ingestion commands, verifying pipe inputs and flag options. `timeline/src/cli/ingest.test.ts` _(PARTIAL: no test covers the standard input pipe, the flag parsing, `ingest url` or `ingest wikidata`)_
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 4.1, 4.2, 4.3, 4.4_

- [x] 3. Whole-Cloth Alternate History Generation Engine
  - [x] 3.1 Implement `TimelineGeneratorService`: multi-pass generation engine _(the class is `TimelineGenerator`, `timeline/src/cli/generator/TimelineGenerator.ts:50`)_:
    - Pass 1: Strategic Premise & Point of Divergence analysis.
    - Pass 2: Chronological micro-event generation with strict ISO-8601 timestamps.
    - Pass 3: Hierarchical narrative arc clustering based on `--depth`. _(PARTIAL: the pass does not read `--depth` and every arc it produces is `level: 0`)
    - Pass 4: Causal ripple synthesis linking divergence causes to downstream effects.
    - Pass 5: Integrity verification pass ensuring temporal constraints and DAG acyclicity. _(PARTIAL: the pass checks the temporal constraints but not acyclicity, `timeline/src/cli/generator/TimelineGenerator.ts:823-876`)_
  - [x] 3.2 Implement `althistory generate timeline` command with flags  `timeline/src/cli/index.ts:717` _(PARTIAL: `--depth` and `--style` are parsed and never read)_:
    - `--premise "<what-if>"`
    - `--divergence-point "<anchor>"`
    - `--start-date <iso>`, `--end-date <iso>`
    - `--event-count <n>`, `--depth <levels>`, `--style academic|narrative|concise`
  - [x] 3.3 Implement `althistory generate branch` command:
    - Fork existing graph at `--diverge-at-event <id>` with counterfactual prompt, synthesizing divergent future while preserving historical ancestors. `timeline/src/cli/index.ts:772`
  - [x] 3.4 Implement `althistory generate expand` command:
    - Zooms in on `--arc <id>` or `--time-window <range>` to generate granular sub-events and sub-arcs. `timeline/src/cli/index.ts:815` _(PARTIAL: `--time-window` is parsed and never read, the events are placeholders ("Granular escalation event i", `timeline/src/cli/generator/TimelineGenerator.ts:482`), and no sub-arcs are created)_
  - [x] 3.5 Implement `althistory generate simulate` command  `timeline/src/cli/index.ts:856`
    - Agentic step-by-step timeline advancement evaluating actor motivations and causal pressures.
  - [x] 3.6 Write comprehensive unit and integration tests with deterministic mocked LLM fixtures. `timeline/src/cli/generator.test.ts`
  - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 6.1, 6.2, 6.3, 6.4_

- [x] 4. Graph, Entity & Causal Manipulation Commands
  - [x] 4.1 Implement `althistory graph` subcommands  `timeline/src/cli/index.ts:62-224`:
    - `list`, `create`, `info`, `branch`, `merge`, `diff`, `rollback`, `delete`.
  - [x] 4.2 Implement `althistory event` subcommands  `timeline/src/cli/index.ts:226-363`:
    - `add`, `list`, `get`, `update`, `delete`.
  - [x] 4.3 Implement `althistory arc` subcommands  `timeline/src/cli/index.ts:365-460`:
    - `create`, `list`, `assign`, `nest` _(PARTIAL: the commands are `create`, `list`, `get` and `delete`; nesting is the `--parent` option of `create` (`timeline/src/cli/index.ts:374`), and there is no `assign` command)_
  - [x] 4.4 Implement `althistory causal` subcommands  `timeline/src/cli/index.ts:462-562`:
    - `link`, `unlink`, `list`, `paths` (tracing all causal pathways between two events).
  - [x] 4.5 Add integration tests verifying end-to-end CRUD across both Remote and Direct modes. `timeline/src/cli/crud.test.ts` _(PARTIAL: the suite exercises the DirectEngine only; no test calls the RemoteEngine)_
  - _Requirements: 7.1, 7.2, 7.3, 7.4_

- [x] 5. Validation, Self-Healing & Context Export
  - [x] 5.1 Implement `althistory validate <graph-id>` command  `timeline/src/cli/index.ts:924`, `timeline/src/cli/validation/GraphValidator.ts:33`:
    - Temporal order validation ($t_{start} \le t_{end}$).
    - Arc containment checks ($arc_{start} \le event_{time} \le arc_{end}$).
    - Causal direction check ($cause_{time} < effect_{time}$).
    - Causal cycle detection (DAG topological sort).
    - Cross-graph reference referential integrity check. _(NOT DONE: there is no such check in `GraphValidator`; and in remote mode the command always passes, because the CLI sends no arrays for the validator to check — `timeline/src/api/routes/validate.ts:166-167`, `timeline/src/cli/engine/RemoteEngine.ts:540-547`)_
    - Structured diagnostic output with exit code 2 on violations.
  - [x] 5.2 Implement automated self-healing (`--auto-repair` / `--fix`)  `timeline/src/cli/index.ts:927` _(PARTIAL: there is no `--fix`; and the edge reversal adds the reversed edge without removing the original (`timeline/src/cli/validation/GraphValidator.ts:370-384`), which creates a two-node cycle rather than repairing one — tracked in [#52](https://github.com/Qworg/althistory/issues/52))_:
    - Automatically expand arc bounds to fit contained events; remove or reverse paradoxical cycle edges.
  - [x] 5.3 Implement `althistory export <graph-id>` command  `timeline/src/cli/index.ts:956`, `timeline/src/cli/export/GraphExporter.ts:17`:
    - Formats: `--format json`, `--format markdown` (LLM-optimized context table), `--format dot`, `--format graphml` _(PARTIAL: json, markdown and dot are implemented (`GraphExporter.ts:31-37`); `graphml` is not)_
  - [x] 5.4 Implement `althistory import <file>` command with conflict strategies (`skip`, `overwrite`, `rename`). `timeline/src/cli/index.ts:1006-1020`, `timeline/src/cli/export/GraphImporter.ts:7`
  - [x] 5.5 Write unit tests for validation diagnostics, self-healing, and markdown export formatting. `timeline/src/cli/validation-export.test.ts`
  - _Requirements: 8.1, 8.2, 8.3, 8.4, 9.1, 9.2, 9.3_

- [x] 6. Model Context Protocol (MCP) Server & Agent Tooling
  - [x] 6.1 Implement `McpServer`: JSON-RPC 2.0 stdio transport conforming to Model Context Protocol. `timeline/src/cli/mcp/McpServer.ts:24`
  - [x] 6.2 Expose core CLI capabilities as typed MCP tools with JSON Schema definitions  `timeline/src/cli/mcp/toolDefinitions.ts`:
    - `althistory_ingest_text`
    - `althistory_generate_timeline`
    - `althistory_branch_timeline`
    - `althistory_query_causal_path`
    - `althistory_validate_graph`
    - `althistory_export_context`
    - _(the tool set also has `althistory_list_graphs`, `althistory_create_event` and `althistory_simulate_timeline`)_
  - [x] 6.3 Implement `althistory schema` command: outputs complete JSON Schema for all commands. `timeline/src/cli/index.ts:1063` _(PARTIAL: it outputs the JSON Schema of the nine MCP tools (`index.ts:1081-1084`), not of every command)_
  - [x] 6.4 Write integration tests simulating an MCP client executing tool calls against the server. `timeline/src/cli/mcp.test.ts`
  - _Requirements: 10.1, 10.2, 10.3_
