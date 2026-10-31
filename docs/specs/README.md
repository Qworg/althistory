# Feature requirements

The requirements each part of the system was built against. Code comments and
tests cite them by number (`Req 19`, `Requirement 4.4`); the number refers to
the document for that area:

| Document | Area |
| --- | --- |
| [`hierarchical-temporal-graph.md`](hierarchical-temporal-graph.md) | The core graph: events, arcs, causal relationships, inferred pressures, temporal queries, integrity, graph copies, performance. |
| [`local-execution.md`](local-execution.md) | Running without Neo4j or Redis: local persistence, configuration, and parity with cloud mode. |
| [`input-output-system.md`](input-output-system.md) | Multiple graphs, versions, branching and merging, export, import, ingestion, API keys, rate limits, batch, validation, suggestions, WebSocket streaming, async jobs, and the UI panels for them (Req 17-20). |
| [`frontend-timeline-interface.md`](frontend-timeline-interface.md) | The timeline UI: events and arcs, editing, causal views, filtering, pressures, copying, view modes, error handling. |
| [`cli-agent-interface.md`](cli-agent-interface.md) | The `althistory` CLI and the MCP server. |

They record what was asked for. Where the code and a requirement disagree, the
code, its tests and `GET /api/openapi.json` describe what the system does.
