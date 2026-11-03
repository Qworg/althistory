# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- **Primary — Alternate-history writers, worldbuilders, and counterfactual scenario designers:** Constructing, branching, and stress-testing "what-if" timelines for real or fictional places, tracking how a point of divergence ripples through subsequent events, periods (arcs), actors, and causal chains.
- **Secondary — Humanities researchers, historians, and analysts:** Ingesting real historical events from Wikipedia, Wikidata, or source texts, curating extracted records before committing them, and inspecting actor roles and inferred macro-pressures across time.
- **Secondary — AI agent operators and developers:** Generating, simulating, validating, and repairing timelines programmatically via the `bin/althistory` CLI or stdio MCP server, then using the web workspace to visually inspect, curate, filter, branch, and merge the resulting graphs.

## Product Purpose

`althistory` is a versioned, multi-graph timeline and causal-network workspace for building, exploring, and branching historical and counterfactual histories. It exists so authors, researchers, and AI agents can treat a history as a structured, queryable, version-controlled causal graph rather than a flat list of dates or unstructured prose.

Success means users can seamlessly bring history in (manually, by bulk import, or via Wikipedia/Wikidata/text ingestion with human-in-the-loop review), examine the same history through multiple synchronized lenses (chronological timeline with nested arcs, directed causal graph, actor perspective, and inferred pressures), spin off counterfactual branches from any divergence point, and merge or export graphs without temporal paradoxes or data loss.

## Positioning

Unlike static timeline drawing tools or freeform worldbuilding wikis, `althistory` enforces causal and temporal integrity across Git-like versioned graphs and pairs its interactive visual workspace with a full-parity agent CLI and MCP server:

- **Multi-lens inspection over one graph:** Every graph is simultaneously navigable as a D3-scaled chronological timeline with nested period arcs, a weighted/typed Cytoscape causal network, an actor-centric activity breakdown, and an inferred economic/social/political pressure analysis.
- **Counterfactual branching, versioning, and merge resolution:** Users can snapshot graph versions, fork counterfactual branches (e.g., testing an alternate outcome at a key historical juncture), and reconcile branches through anomaly-checked merge resolution.
- **Human + agent parity:** Every workspace capability is exposed both in the React UI and through `./bin/althistory` (CLI and MCP server), allowing autonomous multi-step simulations and LLM/deterministic ingestion pipelines to collaborate on the exact same local or cloud graph store.

## Operating Context

- **Dual local and cloud execution:** Commonly run locally via `./start-local.sh` against a zero-dependency JSON store (`LOCAL_EXECUTION_ENABLED=true`, `http://localhost:5173` talking to `http://localhost:3000`), or deployed as a single-replica cloud container backed by Neo4j and Redis.
- **Multi-view analytical workflow:** Users switch between **Timeline** (`/timeline`, `Alt+1`), **Causal Graph** (`/causal-graph`, `Alt+2`), and **Actor Perspective** (`/actor-perspective`, `Alt+3`) while scoping the active graph from the persistent header selector and narrowing visible entities with the right-hand filter panel (search text, date range, actors, confidence threshold).
- **Review-gated ingestion:** When extracting events from Wikipedia URLs, Wikidata queries, or pasted prose (via deterministic pattern matching or configured LLM modes), extracted events land in an editable review table with confidence scores so users can correct actors, dates, or descriptions before anything is written to the active graph.
- **Side-by-side CLI/MCP use:** Users and connected coding/writing agents (Claude Desktop, Cursor, Antigravity) frequently mutate or query graphs via `./bin/althistory` while the web interface reflects changes via REST and WebSocket updates.

## Capabilities and Constraints

- **Core domain terminology:**
  - **Graph:** An isolated timeline history (scoped on API requests via the `X-Graph-Id` header, except `POST /api/import` which reads `targetGraphId` from the request body).
  - **Event:** A dated occurrence with description, timestamp, confidence score, an `actor` (who acted) and a `target` (who was acted upon). Both are required by the API (`timeline/src/models/Event.ts`, `ValidationService`).
  - **Arc:** A named time period with start/end boundaries that groups events and can nest hierarchically into sub-periods.
  - **Causal Link:** A directed cause-to-effect relationship between events, carrying a relationship type (`direct`, `indirect`, or `contributory`), weight, and confidence.
  - **Inferred Pressure:** Economic, social, or political macro-pressures inferred from clusters of related events above a user-adjustable confidence threshold.
  - **Branch & Version:** Immutable version snapshots and forked counterfactual graphs that can be diffed and merged.
- **Causal-order invariant:** A cause may happen at the *same moment* as or before its effect (`cause.timestamp <= effect.timestamp`); only a cause strictly after its effect is a temporal/causal paradox. Both frontend and backend enforce this single rule (`timeline/src/utils/causalOrder.ts`).
- **D3 + React DOM ownership boundary:** In `frontend/`, D3.js is used strictly for mathematical calculations (scales, layouts, path generation) while React owns all DOM rendering. Direct D3 DOM manipulation (`.select()`, `.append()`) is prohibited to prevent reconciliation loops (`docs/adr-001-d3-react-integration.md`). Cytoscape.js manages the interactive network canvas in the Causal Graph view.
- **State and data architecture:** Server state is managed via TanStack React Query (`@tanstack/react-query`) and client/UI state via Zustand (`useGlobalStore`) with granular selectors and persisted user preferences.
- **Responsive and layout modes:** Desktop supports both `sidebar` and `topbar` navigation modes; viewports below `1024px` (`lg` breakpoint) transition to a mobile layout with a persistent bottom navigation bar (`MobileBottomBar`) and touch-scroll guards.

## Brand Commitments

- **Canonical product name:** `althistory` (the current `"Timeline Interface"` string in `frontend/src/components/layout/Header.tsx` and `frontend/index.html` is legacy placeholder text and should yield to `althistory` when touched).
- **Content neutrality rule:** Historical and counterfactual subject matter may document real-world factions, conflicts, and regimes as factual graph data, but the application chrome and decorative system must remain analytical and neutral.

## Evidence on Hand

- **Curated reference scenario ("The Engine Age"):** Deterministic demo seed and walkthrough (`docs/walkthrough.md`, `media/`) exploring an 1843 divergence where Charles Babbage completes the Analytical Engine, complete with nested arcs (*Building the Engine*, *The Calculating Offices*, *Engines on the Wire*, *The Clerks' Rebellion*), causal chains, actor perspectives (e.g., *Prussian General Staff*), inferred economic/social/political pressures, and a counterfactual branch (*Clerks Prevail*).
- **Generated visual captures and tour:** Real application screenshots (`docs/images/workspace.png`, `docs/images/timeline.png`, `docs/images/causal-graph.png`, `docs/images/actor-perspective.png`, `docs/images/pressure-analysis.png`, `docs/images/ingestion-text.png`, `docs/images/ingestion-review.png`, `docs/images/graphs-and-branches.png`) and walkthrough video (`docs/media/walkthrough.mp4`) generated directly from the running application via Playwright and Revideo (`media/`).
- **Authoritative technical and product documentation:** `README.md`, `docs/api-integration.md`, `docs/export-format.md`, `docs/ingestion.md`, `docs/branch-merge-resolver.md`, `docs/mcp-agent-guide.md`, `docs/autonomous-simulation-engine.md`, `docs/production-deployment.md`, `docs/adr-001-d3-react-integration.md`, and feature specifications in `docs/specs/`.
- **Absences not to fabricate:** No external customer testimonials, commercial pricing tiers, SaaS SLA claims, or third-party press quotes exist; future surfaces must not invent them.

## Product Principles

1. **Causal rigor over loose chronology:** Dates alone do not make a plausible alternate history. Every view and workflow should help users see *why* events happen—surfacing actors, targets, weighted causal links, nested period arcs, and inferred pressures while guarding against temporal paradoxes.
2. **Human curation over black-box generation:** Whether events arrive from Wikipedia/Wikidata extraction or multi-step AI simulation, automated outputs are hypotheses first. Give users transparent confidence scores, review tables, and validation/repair tools before committing history to the graph.
3. **Branch without fear:** Exploring a counterfactual ("what if the clerks prevailed?") must never endanger the baseline history. Switching graphs, taking version snapshots, branching, and merging should feel immediate, legible, and safe.
4. **One history, many lenses and interfaces:** A timeline is simultaneously a chronological axis, a directed causal network, an actor's biography, and an agent-accessible data structure. Changes made in any view—or via the CLI/MCP server—must stay coherent everywhere.

## Accessibility & Inclusion

- **Standard:** WCAG AA compliance across interactive views, forms, modals, and data visualizations (enforced in tests with `vitest-axe`).
- **High-contrast mode:** Built-in user preference (`userPreferences.accessibility.highContrast`) synced to `document.documentElement.classList` (`.high-contrast`), which all surfaces and visual refinements must honor.
- **Keyboard-first operation:** Global keyboard shortcuts for view switching (`Alt+1`, `Alt+2`, `Alt+3`), focus management across modals and main regions (`role="main"`, ` role="banner"`), and accessible tooltips/inspections for timeline and graph nodes.
