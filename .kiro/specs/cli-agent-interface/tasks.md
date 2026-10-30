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
  - [x] 1.5 Implement `RemoteEngine`  `timeline/src/cli/engine/RemoteEngine.ts:33`, `:103-112` (`X-Graph-Id` scoping header on graph-scoped calls), `timeline/src/cli/remote-engine.test.ts` (18 tests): communicates via HTTP client with the running Express backend.
  - [x] 1.6 Implement Agent-First Output Formatters:
    - Pure machine-readable JSON formatter (`--json`) with standardized error envelopes. `timeline/src/cli/formatters/jsonFormatter.ts:6`
    - Streaming Newline Delimited JSON formatter (`--ndjson`). `timeline/src/cli/formatters/ndjsonFormatter.ts:4-19` (`writeNdjsonRecord` streams line-by-line to `stdout`; `formatNdjson` formats batches)
    - Stderr progress logger and spinner (ensuring `stdout` stays clean for pipes). `timeline/src/cli/utils/logger.ts` _(stderr logger keeps `stdout` clean for pipes)_
    - Semantic Unix exit codes (`exitCodes.ts`). `timeline/src/cli/utils/exitCodes.ts:5`
  - [x] 1.7 Add unit tests  `timeline/src/cli/engine.test.ts`, `timeline/src/cli/remote-engine.test.ts`, `timeline/src/cli/formatters.test.ts`, `timeline/src/cli/cli.test.ts` for `ExecutionContext`, engines, formatters, and exit code propagation.
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7_

- [x] 2. Text-Based & External Web Ingestion CLI
  - [x] 2.1 Implement `althistory ingest text` command  `timeline/src/cli/index.ts:606`, `timeline/src/cli/engine/DirectEngine.ts:819-869`, `timeline/src/services/ingestion/mergeExtractions.ts`:
    - Support `--file <path>`, `--text "<content>"`, and standard input pipe (`cat file.txt | althistory ingest text`).
    - Support `--mode pattern|llm|hybrid`, `--provider openai|anthropic`, `--model <name>`, and `--temperature <val>`.
    - Support `--min-confidence <threshold>` and `--dry-run` preview (returns preview without creating a graph).
  - [x] 2.2 Implement automatic arc clustering (`--group-arcs`): groups ingested events into hierarchical Arcs by temporal proximity and actor continuity. `timeline/src/cli/generator/arcClustering.ts:36-210`
  - [x] 2.3 Implement causal inference integration (`--infer-causes`): runs `InferenceService` to link causes to effects during ingestion. `timeline/src/cli/engine/DirectEngine.ts:570-594`
  - [x] 2.4 Implement `althistory ingest url` command: SSRF-hardened extraction from Wikipedia articles and web documents with `--follow-links` and `--depth`. `timeline/src/cli/index.ts:673`, `timeline/src/services/ingestion/WikipediaExtractor.ts`, `timeline/src/services/ingestion/WebDocumentExtractor.ts`
  - [x] 2.5 Implement `althistory ingest wikidata` command: extracts entities via predefined presets (`--preset`) or custom SPARQL queries (`--sparql`). `timeline/src/cli/index.ts:714`, `timeline/src/cli/engine/DirectEngine.ts:887`
  - [x] 2.6 Add unit and integration tests for all ingestion commands, verifying pipe inputs and flag options. `timeline/src/cli/ingest.test.ts`, `timeline/src/cli/cli-input.test.ts`, `timeline/src/services/ingestion/WebDocumentExtractor.test.ts`, `timeline/src/services/ingestion/mergeExtractions.test.ts`
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 4.1, 4.2, 4.3, 4.4_

- [x] 3. Whole-Cloth Alternate History Generation Engine
  - [x] 3.1 Implement `TimelineGeneratorService`: multi-pass generation engine _(the class is `TimelineGenerator`, `timeline/src/cli/generator/TimelineGenerator.ts:50`)_:
    - Pass 1: Strategic Premise & Point of Divergence analysis.
    - Pass 2: Chronological micro-event generation with strict ISO-8601 timestamps.
    - Pass 3: Hierarchical narrative arc clustering based on `--depth`. `timeline/src/cli/generator/arcClustering.ts:36-210`
    - Pass 4: Causal ripple synthesis linking divergence causes to downstream effects.
    - Pass 5: Integrity verification pass ensuring temporal constraints and DAG acyclicity. `timeline/src/cli/generator/TimelineGenerator.ts:950-1015`
  - [x] 3.2 Implement `althistory generate timeline` command with flags  `timeline/src/cli/index.ts:756`:
    - `--premise "<what-if>"`
    - `--divergence-point "<anchor>"`
    - `--start-date <iso>`, `--end-date <iso>`
    - `--event-count <n>`, `--depth <levels>`, `--style academic|narrative|concise`
  - [x] 3.3 Implement `althistory generate branch` command:
    - Fork existing graph at `--diverge-at-event <id>` with counterfactual prompt, synthesizing divergent future while preserving historical ancestors. `timeline/src/cli/index.ts:811`
  - [x] 3.4 Implement `althistory generate expand` command:
    - Zooms in on `--arc <id>` or `--time-window <range>` to generate granular sub-events and sub-arcs. `timeline/src/cli/index.ts:854`, `timeline/src/cli/generator/TimelineGenerator.ts:460-570`
  - [x] 3.5 Implement `althistory generate simulate` command  `timeline/src/cli/index.ts:895`
    - Agentic step-by-step timeline advancement evaluating actor motivations and causal pressures.
  - [x] 3.6 Write comprehensive unit and integration tests with deterministic mocked LLM fixtures. `timeline/src/cli/generator.test.ts`
  - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 6.1, 6.2, 6.3, 6.4_

- [x] 4. Graph, Entity & Causal Manipulation Commands
  - [x] 4.1 Implement `althistory graph` subcommands  `timeline/src/cli/index.ts:62-224`:
    - `list`, `create`, `info`, `branch`, `merge`, `diff`, `rollback`, `delete`.
  - [x] 4.2 Implement `althistory event` subcommands  `timeline/src/cli/index.ts:226-363`:
    - `add`, `list`, `get`, `update`, `delete`.
  - [x] 4.3 Implement `althistory arc` subcommands  `timeline/src/cli/index.ts:365-504`:
    - `create`, `list`, `get`, `delete`, `assign`, `nest`.
  - [x] 4.4 Implement `althistory causal` subcommands  `timeline/src/cli/index.ts:506-604`:
    - `link`, `unlink`, `list`, `paths` (tracing all causal pathways between two events).
  - [x] 4.5 Add integration tests verifying end-to-end CRUD across both Remote and Direct modes. `timeline/src/cli/crud.test.ts`, `timeline/src/cli/remote-engine.test.ts`
  - _Requirements: 7.1, 7.2, 7.3, 7.4_

- [x] 5. Validation, Self-Healing & Context Export
  - [x] 5.1 Implement `althistory validate <graph-id>` command  `timeline/src/cli/index.ts:993`, `timeline/src/cli/validation/GraphValidator.ts:33`:
    - Temporal order validation ($t_{start} \le t_{end}$).
    - Arc containment checks ($arc_{start} \le event_{time} \le arc_{end}$).
    - Causal direction check: the cause may not follow the effect ($cause_{time} \le effect_{time}$; a cause at the same moment is allowed -- the rule is in `timeline/src/utils/causalOrder.ts`).
    - Causal cycle detection (DAG topological sort).
    - Cross-graph reference referential integrity check (`GraphValidator.ts:300-355`).
    - Structured diagnostic output with exit code 2 on violations.
  - [x] 5.2 Implement automated self-healing (`--auto-repair` / `--fix`)  `timeline/src/cli/index.ts:996`, `timeline/src/cli/validation/GraphValidator.ts:371-407`, `timeline/src/cli/validator-repair.test.ts`:
    - Automatically expand arc bounds to fit contained events; remove or reverse paradoxical cycle edges.
  - [x] 5.3 Implement `althistory export <graph-id>` command  `timeline/src/cli/index.ts:1025`, `timeline/src/cli/export/GraphExporter.ts:17`:
    - Formats: `--format json`, `--format markdown` (LLM-optimized context table), `--format dot`, `--format graphml` (`GraphExporter.ts:35-43`, `timeline/src/cli/export/GraphExporter.test.ts`).
  - [x] 5.4 Implement `althistory import <file>` command with conflict strategies (`skip`, `overwrite`, `rename`). `timeline/src/cli/index.ts:1075-1090`, `timeline/src/cli/export/GraphImporter.ts:7`
  - [x] 5.5 Write unit tests for validation diagnostics, self-healing, and markdown export formatting. `timeline/src/cli/validation-export.test.ts`, `timeline/src/cli/validator-repair.test.ts`, `timeline/src/cli/export/GraphExporter.test.ts`
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
  - [x] 6.3 Implement `althistory schema` command: outputs complete JSON Schema for all commands and MCP tools. `timeline/src/cli/index.ts:1132`, `timeline/src/cli/schema/commandSchema.ts`, `timeline/src/cli/schema/commandSchema.test.ts`
  - [x] 6.4 Write integration tests simulating an MCP client executing tool calls against the server. `timeline/src/cli/mcp.test.ts`
  - _Requirements: 10.1, 10.2, 10.3_
