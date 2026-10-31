# Requirements Document: CLI Agent Interface

## Introduction

The **Althistory CLI (`althistory`)** provides a robust, scriptable command-line interface and tool interface designed specifically for **autonomous AI agents**, automated pipeline scripts, and power users.

The core mission of the CLI is twofold:
1. **Build histories from text**: Rapidly parse, extract, structure, and link historical events, narrative arcs, and causal dependencies from raw unstructured text, document files, or web resources.
2. **Generate histories whole cloth**: Given a counterfactual premise (a "point of divergence") or creative worldbuilding prompt, autonomously synthesize coherent, multi-layered alternate histories complete with temporal arcs, actor perspectives, and causal graphs.

The CLI is engineered from the ground up to follow the **Unix philosophy** and **Agent-First design**: deterministic exit codes, strict stdout/stderr separation, machine-readable JSON/NDJSON output, headless execution without hanging prompts, and dual-mode operation (communicating with a running backend server or executing directly against local file storage).

---

## Requirements

### Requirement 1: CLI Architecture & Execution Modes

**User Story:** As an AI agent or developer, I want to run `althistory` commands whether or not the background backend server is active, so that I can operate in local headless scripts, automated pipelines, or live development sessions with a browser UI.

#### Acceptance Criteria

1. WHEN a user or agent invokes `althistory` THEN the CLI SHALL support two execution modes:
   - **Daemon/Remote Mode (default when server active)**: Communicates via HTTP/WebSocket with `http://localhost:3000` (or URL specified by `--url` or `ALTHISTORY_URL`).
   - **Embedded/Direct Mode**: Directly boots the backend dependency injection `Container` in headless local execution mode (`LOCAL_EXECUTION_ENABLED=true`), reading and writing directly to `LOCAL_DATA_DIR` without opening network ports.
2. WHEN the backend daemon is not reachable and no `--url` was explicitly provided THEN the CLI SHALL automatically fall back to Direct Mode and print an advisory note to `stderr`.
3. WHEN the `--direct` flag is explicitly passed THEN the CLI SHALL run in Direct Mode regardless of whether a daemon is running.
4. WHEN `--api-key` is supplied or configured via `ALTHISTORY_API_KEY` THEN the CLI SHALL authenticate using the dual-header authentication pattern (`X-API-Key` or `Bearer`).
5. WHEN `--help` or `-h` is invoked on any command or subcommand THEN the CLI SHALL output concise usage instructions, argument types, and JSON schema examples to `stdout` with exit code 0.

---

### Requirement 2: Agent-First Machine-Readable Output Protocol

**User Story:** As an autonomous AI agent parsing CLI outputs, I want clean, predictable JSON on stdout without terminal escape codes or interactive prompts, so that I can reliably pipe results into downstream tools or model prompts.

#### Acceptance Criteria

1. WHEN the `--json` flag is provided THEN the CLI SHALL output valid JSON to `stdout` containing only the command payload or structured error.
2. WHEN long-running commands (e.g. generation, ingestion, validation) produce progress logs THEN all progress indicators, spinners, and log messages SHALL be written to `stderr`, leaving `stdout` clean for pipelining.
3. WHEN streaming real-time event updates THEN the CLI SHALL support `--ndjson` (Newline Delimited JSON) outputting one JSON object per line.
4. WHEN a command succeeds THEN the CLI SHALL exit with status code `0`.
5. WHEN a command fails THEN the CLI SHALL exit with a distinct non-zero exit code:
   - `1`: General or operational error
   - `2`: Validation / Temporal / Causal constraint failure
   - `3`: Authentication / Permission failure
   - `4`: Entity Not Found
   - `5`: Network / Daemon connection failure
6. WHEN an error occurs and `--json` is active THEN the CLI SHALL emit a structured error object on `stderr` or `stdout`:
   ```json
   {
     "success": false,
     "error": {
       "code": "CONSTRAINT_VIOLATION",
       "message": "Event 'evt-1' precedes its cause 'evt-2'",
       "details": []
     }
   }
   ```
7. WHEN running in non-interactive environments (CI or agent subprocess) THEN the CLI SHALL never hang waiting on interactive stdin; missing required arguments SHALL fail immediately with a descriptive error.

---

### Requirement 3: Text-Based History Ingestion

**User Story:** As an AI agent, I want to feed raw historical text or literature into the system, so that events, actors, targets, and causal relationships are extracted, clustered into narrative arcs, and persisted into a timeline graph.

#### Acceptance Criteria

1. WHEN invoking `althistory ingest text` THEN the CLI SHALL accept text from `--text "<content>"`, `--file <path>`, or standard input pipe (`cat source.txt | althistory ingest text`).
2. WHEN an ingestion mode is chosen via `--mode` THEN the CLI SHALL support:
   - `pattern`: Fast deterministic regex-based date/entity extraction.
   - `llm`: High-accuracy LLM-driven structured extraction using the configured provider.
   - `hybrid` (default): Fast pattern extraction with LLM fallback for ambiguous entities.
3. WHEN LLM extraction is selected THEN the CLI SHALL allow specifying `--provider openai|anthropic`, `--model <name>`, and `--temperature <val>`.
4. WHEN `--group-arcs` is passed THEN the system SHALL automatically cluster extracted events by temporal proximity and actor continuity into hierarchical Arcs.
5. WHEN `--infer-causes` is passed THEN the system SHALL run causal inference to detect cause-and-effect relationships among extracted events.
6. WHEN `--graph <id>` is provided THEN the extracted entities SHALL be committed to that graph; WHEN omitted, a new graph SHALL be created named after the source.
7. WHEN `--dry-run` is specified THEN the CLI SHALL output the extracted events, arcs, and relationships to `stdout` without saving to storage.
8. WHEN `--min-confidence <threshold>` is passed THEN entities below the confidence threshold SHALL be filtered out.

---

### Requirement 4: External Web and Dataset Ingestion

**User Story:** As an AI agent, I want to ingest knowledge directly from Wikipedia URLs or Wikidata queries, so that I can ground alternate histories in canonical factual baselines.

#### Acceptance Criteria

1. WHEN invoking `althistory ingest url <url>` THEN the CLI SHALL extract historical events from the target Wikipedia or web page using the SSRF-hardened HTTP client.
2. WHEN `--follow-links` is passed THEN the CLI SHALL follow internal links up to `--depth <n>` (default 1) subject to `--max-pages <m>` and regex filtering `--filter <regex>`.
3. WHEN invoking `althistory ingest wikidata` THEN the CLI SHALL accept a predefined query (`--preset battles|wars|reigns`) or custom SPARQL query (`--sparql "<query>"`).
4. WHEN external ingestion completes THEN the system SHALL record provenance data (source URL, extractor, extraction timestamp) on all created entities.

---

### Requirement 5: Whole-Cloth Alternate History Generation

**User Story:** As an AI agent or creative researcher, I want to provide a counterfactual premise and point of divergence, so that the system generates a complete, internally coherent alternate history timeline.

#### Acceptance Criteria

1. WHEN invoking `althistory generate timeline` THEN the CLI SHALL accept:
   - `--premise "<scenario>"`: The counterfactual "what-if" premise (e.g. "What if the Spanish Armada succeeded in 1588?").
   - `--divergence-point "<event>"`: The precise initial point of divergence and historical anchor.
   - `--start-date <iso>` and `--end-date <iso>`: Temporal boundary of the simulation.
   - `--event-count <n>`: Target number of pivotal historical events (default 15).
   - `--depth <levels>`: Depth of arc hierarchy (1 = epochs only, 2 = epochs + campaigns, 3 = deep detail).
2. WHEN generating whole-cloth histories THEN the generator SHALL enforce historical causality:
   - Causes must not follow their effects in time. A cause and an effect at the same moment are allowed: the two can be part of the same occurrence. The rule is the project's single rule, in `timeline/src/utils/causalOrder.ts`, and every path that compares a cause with its effect uses it. (The generator's own sequence of events is a separate rule: the events it produces have to advance in time.)
   - The divergence point must be the earliest counterfactual event.
   - Cascading societal, military, and political ripple effects must be logically linked via causal relationships.
3. WHEN generation finishes THEN the CLI SHALL automatically run the validation engine:
   - Verify acyclicity (no causal loops).
   - Verify temporal constraints (all events in an arc fit within the arc start/end times).
4. WHEN `--style <style>` is passed THEN the narrative style SHALL adapt to `academic` (formal historiography), `narrative` (story/dramatic focus), or `concise` (bullet-point facts).
5. WHEN generation completes THEN the CLI SHALL output the resulting graph ID, event count, arc summary, and causal path length.

---

### Requirement 6: Counterfactual Branching & Deep Expansion

**User Story:** As an AI agent exploring branching narrative trees, I want to fork an existing historical timeline at an event and generate counterfactual divergent paths, so that multiple scenarios can be compared side-by-side.

#### Acceptance Criteria

1. WHEN invoking `althistory generate branch` THEN the CLI SHALL accept:
   - `--source-graph <id>`: Existing graph to fork.
   - `--diverge-at-event <eventId>`: Anchor event where history changes.
   - `--counterfactual "<prompt>"`: Description of what happens differently at this pivot point.
   - `--branch-name "<name>"`: Name of the new branched graph.
2. WHEN a branch is generated THEN the system SHALL:
   - Create a new branch sharing historical ancestors up to the divergence event.
   - Generate counterfactual successor events and causal links downstream of the divergence point.
   - Preserve untouched parallel branches in other arcs.
3. WHEN invoking `althistory generate expand` with `--arc <arcId>` or `--time-window <start>..<end>` THEN the generator SHALL zoom in on that period, synthesizing granular sub-events and sub-arcs without altering parent boundaries.
4. WHEN invoking `althistory generate simulate` with `--actors <actor1,actor2>` and `--steps <n>` THEN the system SHALL run a step-by-step agentic simulation advancing the timeline step-by-step, evaluating actor motivations and causal pressures.

---

### Requirement 7: Graph & Entity CRUD Operations

**User Story:** As an AI agent manipulating timeline graphs, I want full programmatic CRUD access to graphs, events, arcs, and causal links via CLI commands.

#### Acceptance Criteria

1. WHEN managing graphs THEN the CLI SHALL support:
   - `althistory graph list [--json]`
   - `althistory graph create <name> [--description <desc>]`
   - `althistory graph info <id>`
   - `althistory graph branch <id> <new-name>`
   - `althistory graph merge <source-id> <target-id> [--strategy keep-source|keep-target]`
   - `althistory graph diff <graph-a> <graph-b>`
   - `althistory graph rollback <id> <version>`
   - `althistory graph delete <id>`
2. WHEN managing events THEN the CLI SHALL support:
   - `althistory event add --graph <id> --desc <desc> --time <iso> [--actor <a>] [--target <t>]`
   - `althistory event list --graph <id> [--actor <a>] [--from <t>] [--to <t>]`
   - `althistory event get <id> --graph <id>`
   - `althistory event update <id> --graph <id> [--desc <d>] [--time <t>]`
   - `althistory event delete <id> --graph <id>`
3. WHEN managing arcs THEN the CLI SHALL support:
   - `althistory arc create --graph <id> --name <name> --start <iso> --end <iso> [--parent <arcId>]`
   - `althistory arc list --graph <id>`
   - `althistory arc assign --graph <id> --arc <arcId> --event <eventId>`
4. WHEN managing causal relationships THEN the CLI SHALL support:
   - `althistory causal link --graph <id> --cause <evt1> --effect <evt2> [--weight <w>] [--type <type>]`
   - `althistory causal unlink --graph <id> --cause <evt1> --effect <evt2>`
   - `althistory causal list --graph <id>`
   - `althistory causal paths --graph <id> --from <evt1> --to <evt2>` (finds all causal chains between two events)

---

### Requirement 8: Verification, Diagnostics & Integrity Audits

**User Story:** As an AI agent, I want to validate a timeline graph for temporal contradictions, hierarchy leaks, and causal paradoxes, so that I can automatically detect and repair invalid states.

#### Acceptance Criteria

1. WHEN invoking `althistory validate <graph-id>` THEN the CLI SHALL verify:
   - **Temporal Order**: Event timestamps are valid ISO-8601; arc start $\le$ arc end.
   - **Arc Containment**: Every assigned event satisfies $arc.start \le event.time \le arc.end$; child arcs fall strictly inside parent arcs.
   - **Causal Consistency**: The cause timestamp does not follow the effect timestamp ($cause.time \le effect.time$). A cause at the same moment as its effect is allowed, and only a strictly later cause is an error.
   - **Causal Acyclicity**: The causal graph is a directed acyclic graph (DAG); no causal cycles or bootstrap paradoxes exist.
   - **Cross-Graph Integrity**: Cross-graph entity references resolve to existing entities.
2. WHEN errors are detected THEN the CLI SHALL output structured diagnostic error objects detailing the exact entity IDs, violation types, and suggested remediation steps.
3. WHEN `--fix` or `--auto-repair` is passed THEN the CLI SHALL apply automated healing (e.g. expanding arc bounds to contain out-of-bounds events, removing paradoxical reverse edges).
4. WHEN `--strict` is enabled THEN warnings (e.g. isolated events without causal links) SHALL be treated as errors resulting in exit code 2.

---

### Requirement 9: Context Formatting & Serialization

**User Story:** As an AI agent constructing context for an LLM prompt, I want to export the timeline into clean markdown, graph representations, or standard JSON, so that it can be injected directly into prompt windows.

#### Acceptance Criteria

1. WHEN invoking `althistory export <graph-id>` THEN the CLI SHALL support `--format`:
   - `json`: Standard Althistory interchange format with full schema, versions, and metadata.
   - `markdown`: Chronologically formatted Markdown table with hierarchical arc headings, actor callouts, and causal antecedent annotations.
   - `dot`: Graphviz DOT format for graph rendering.
   - `graphml`: Standard GraphML format for network analysis tools.
   - `ndjson`: Stream of entity objects.
2. WHEN `--output <file>` is provided THEN output SHALL be written to the file; WHEN omitted, output SHALL be written to `stdout`.
3. WHEN invoking `althistory import <file>` THEN the CLI SHALL parse and validate the file, apply conflict resolutions (`--strategy skip|overwrite|rename`), and commit to storage.

---

### Requirement 10: AI Agent Integration & Tool Protocol

**User Story:** As an autonomous agent framework (e.g. Antigravity, Claude, LangChain, AutoGen), I want standardized tool definitions or Model Context Protocol (MCP) support, so that I can directly invoke `althistory` tools without shell parsing quirks.

#### Acceptance Criteria

1. WHEN invoking `althistory schema` THEN the CLI SHALL output the complete JSON Schema of all commands, arguments, and data models to `stdout`.
2. WHEN invoking `althistory mcp` THEN the CLI SHALL start a Model Context Protocol (MCP) stdio server exposing all CLI commands as structured agent tools (`create_event`, `ingest_text`, `generate_alternate_history`, `query_causal_path`, `validate_graph`).
3. WHEN an MCP client sends a tool invocation request THEN the server SHALL execute the request and return typed results matching the tool schema.
