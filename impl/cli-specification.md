# Althistory CLI: Agent-First Interface Specification & Implementation Plan

**Date:** October 9, 2026  
**Author:** Principal Engineer Review  
**Target Package:** `cli/` (or `timeline/src/cli/`)  
**Executable Command:** `althistory`  
**Full Specification Documents:**
- [Requirements](.kiro/specs/cli-agent-interface/requirements.md)
- [Design Document](.kiro/specs/cli-agent-interface/design.md)
- [Implementation Tasks](.kiro/specs/cli-agent-interface/tasks.md)

---

## 1. Executive Summary & Purpose

The Althistory system currently features an Express backend (`timeline/`) and a React/Cytoscape/D3 frontend (`frontend/`). While the browser interface is suited for human visual exploration, **autonomous AI agents** (such as Antigravity, Claude, or custom LLM worker loops) require a deterministic, scriptable, machine-readable command-line interface.

The objective of the CLI is to empower agents to:
1. **Build histories from text**: Parse, structure, and link narrative arcs and causal chains from unstructured text, web documents, or Wikipedia/Wikidata.
2. **Generate histories whole cloth**: Given a counterfactual premise ("What if Caesar lived?") or creative prompt, synthesize complete timelines with strictly ordered timestamps, hierarchical narrative arcs, and causal dependencies without hallucinated chronological paradoxes.

---

## 2. Core Architectural Pillars

```
┌────────────────────────────────────────────────────────┐
│ 1. Dual-Mode Execution (Daemon vs Direct)              │
│    - Remote: Talks to Express backend (localhost:3000) │
│    - Direct: Boots Container in-process for headless CI│
└───────────────────────────┬────────────────────────────┘
                            │
┌───────────────────────────▼────────────────────────────┐
│ 2. Agent-First Unix Ergonomics                         │
│    - stdout: Clean machine-readable JSON/NDJSON        │
│    - stderr: Progress indicators, logs, warnings       │
│    - Deterministic Unix exit codes (0, 1, 2, 3, 4, 5)  │
└───────────────────────────┬────────────────────────────┘
                            │
┌───────────────────────────▼────────────────────────────┐
│ 3. Whole-Cloth Multi-Pass History Synthesis            │
│    - Pass 1: Macro Epochs & Divergence Anchor          │
│    - Pass 2: Chronological Micro-Events               │
│    - Pass 3: Hierarchical Arc Grouping                 │
│    - Pass 4: Causal Ripple Linking                     │
│    - Pass 5: DAG Acyclicity & Temporal Verification    │
└───────────────────────────┬────────────────────────────┘
                            │
┌───────────────────────────▼────────────────────────────┐
│ 4. Model Context Protocol (MCP) Server                 │
│    - althistory mcp provides stdio JSON-RPC tools for  │
│      direct AI agent invocation                        │
└────────────────────────────────────────────────────────┘
```

---

## 3. Command Taxonomy for Agents

### Ingestion Pipeline
```bash
# Ingest raw text or pipe
cat source.txt | althistory ingest text --graph-id <id> --group-arcs --infer-causes --json

# Ingest from Wikipedia / web page
althistory ingest url "https://en.wikipedia.org/wiki/Battle_of_Hastings" --depth 2 --json

# Ingest from Wikidata SPARQL query
althistory ingest wikidata --preset battles --time-range "1000..1100" --json
```

### Whole-Cloth Generation Pipeline
```bash
# Generate complete alternate history timeline from a counterfactual premise
althistory generate timeline \
  --premise "What if the Library of Alexandria never burned?" \
  --divergence-point "48 BC: Caesar's soldiers quench the dock fires" \
  --start-date "-0048-01-01" \
  --end-date "0500-01-01" \
  --event-count 25 \
  --depth 2 \
  --json

# Fork an existing timeline at an event with counterfactual ripples
althistory generate branch \
  --source-graph "g-alexandria" \
  --diverge-at-event "evt-steam-engine-invention" \
  --counterfactual "Hero of Alexandria's aeolipile sparks an industrial revolution in 100 AD" \
  --branch-name "Early Industrial Era" \
  --json

# Deepen a specific era
althistory generate expand --graph g-123 --arc arc-roman-enlightenment --density high --json
```

### Graph & Entity Manipulation
```bash
althistory graph list --json
althistory graph branch <id> <new-name>
althistory graph merge <source> <target> --strategy keep-source
althistory event add --graph <id> --desc "Coronation" --time "1066-12-25" --actor "William I"
althistory arc create --graph <id> --name "Norman Conquest" --start "1066-01-01" --end "1087-09-09"
althistory causal link --graph <id> --cause evt-1 --effect evt-2 --weight 0.95
althistory causal paths --graph <id> --from evt-1 --to evt-10 --json
```

### Self-Healing & Verification
```bash
# Returns exit code 0 if valid, exit code 2 if violations exist
althistory validate <graph-id> --strict --json

# Auto-heals arc boundaries and breaks paradoxical cycles
althistory validate <graph-id> --auto-repair --json
```

### LLM Context Export
```bash
# Formats timeline into an LLM-ready markdown table for prompt injection
althistory export <graph-id> --format markdown
```

---

## 4. Implementation Phasing & Milestones

1. **Phase 1: CLI Core & Scaffolding** (`cli/` package, Commander routing, `ExecutionContext`, `DirectEngine`, `RemoteEngine`, output formatters, exit codes).
2. **Phase 2: Ingestion CLI** (`ingest text`, `ingest url`, `ingest wikidata`, arc clustering, causal inference).
3. **Phase 3: Whole-Cloth Generation Engine** (`generate timeline`, `generate branch`, `generate expand`, multi-pass prompt engine, divergence anchor).
4. **Phase 4: Graph & Entity CRUD** (Full CLI suite for graphs, events, arcs, causal links, path queries).
5. **Phase 5: Diagnostics, Self-Healing & Context Export** (`validate`, `--auto-repair`, `export markdown/json/dot`).
6. **Phase 6: Model Context Protocol (MCP) Server** (`althistory mcp` stdio server, tool schemas).
