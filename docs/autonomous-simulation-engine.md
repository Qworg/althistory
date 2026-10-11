# Autonomous Historical Simulation Engine

The simulation engine evolves an existing timeline **forward** from a point of
divergence. Instead of generating a branch from a what-if prompt, it reads the
causal window already on the graph, infers the pressures acting on it, and
persists one milestone event per hop together with a causal link to its
precursor.

It is exposed through the HTTP API, the CLI, the MCP server, and the web UI.

---

## 1. How a hop is produced

Each hop in `timeline/src/services/SimulationService.ts` does the same five
things:

1. **Read the window.** Collect every event at or before the cursor — the
   graph's real history plus milestones generated earlier in this run.
2. **Infer pressures.** Run `InferenceService.analyzeEventClusters` over the
   window to get `InferredPressure` records.
3. **Pick a domain.** Either the explicitly requested domain, or the one mapped
   from the strongest inferred pressure (`military` and `scientific` map onto
   the `political` and `economic` pressure signals the inference service
   actually produces).
4. **Synthesise a milestone.** Build an event whose actor/target pair is drawn
   from the busiest participants in the window, so the narrative continues the
   story already on the graph rather than inventing unrelated cast members.
5. **Validate and persist.** The candidate passes
   `ValidationService.validateCreateEvent` and
   `TemporalService.preventTemporalParadox` before `EventRepository.create`
   writes it and `CausalService.createCausalLink` links it to its precursor.

A run therefore cannot inject a record the write API would reject, and a
generated milestone can never precede its cause.

### Bounds

| Input | Bound |
| :--- | :--- |
| `steps` | 1–10 (clamped) |
| `stepDurationMs` | positive; defaults to one year |
| `aggressiveness` | 0.0–1.0; biases causal weight and importance |
| `domain` | `political` \| `military` \| `economic` \| `scientific` \| `social` \| `environmental` |

`preview` runs the identical algorithm without writing, so a plan and a real run
produce the same milestones.

---

## 2. HTTP API

`POST /inference/simulate` — scoped to the graph named by the `X-Graph-Id`
header (the same `resolveGraphContext` middleware every graph route uses).

```jsonc
// Request
{
  "steps": 3,
  "stepDurationMs": 31536000000,   // or "timeAdvanceMonths": 12
  "anchorEventId": "event_...",     // optional; defaults to the latest event
  "domain": "military",             // optional; defaults to dominant pressure
  "aggressiveness": 0.5,
  "seedContext": "A blockade of the eastern trade routes",
  "dryRun": false,                  // routes through preview()
  "stream": false                   // or send Accept: text/event-stream
}
```

The default response is the usual envelope:

```jsonc
{ "success": true, "data": { "graphId", "domain", "steps", "events", "relationships", "pressures", ... }, "requestId": "..." }
```

### Streaming

With `"stream": true` or an `Accept: text/event-stream` header, the route emits
server-sent events and flushes each milestone **before** the next hop begins:

| Event | Payload |
| :--- | :--- |
| `event_created` | the milestone event, its driving pressure, and the causal link |
| `causal_link_created` | the persisted link alone |
| `simulation_complete` | the full serialised result |
| `simulation_error` | `{ message }` if a hop fails mid-run |

Because headers are committed once the first frame is written, a mid-run failure
is reported as a `simulation_error` frame rather than an HTTP status code, and
the stream is always closed.

---

## 3. CLI

```bash
althistory generate simulate \
  --graph-id <id> \
  --steps 3 \
  --months 12 \
  --domain military \
  --anchor <eventId> \
  --aggressiveness 0.6 \
  --seed "A blockade of the eastern trade routes" \
  --dry-run
```

`--direct` runs the engine in-process; otherwise the command calls the
`/api/inference/simulate` route over HTTP. Both paths map the engine result
through `cli/engine/simulationMapper.ts`, so a run is described identically
either way.

---

## 4. MCP

The `althistory_simulate_timeline` tool wraps the same engine. See
[`docs/mcp-agent-guide.md`](./mcp-agent-guide.md#9-althistory_simulate_timeline).

---

## 5. Web UI

`frontend/src/components/branch/SimulationLauncherPanel.tsx` provides the
controls (steps, months per hop, domain, aggressiveness, seed context, preview)
and lists the generated milestones. It is mounted as the **Forward Simulation**
tab of the Counterfactual Divergence Explorer
(`BranchComparisonModal`), which the toolbar's *Branch Comparison* action opens.
When a run completes, the modal refetches the branch so the dual-lane canvas
picks up the new milestones.

`apiClient.inference.simulate(graphId, options)` translates
`timeAdvanceMonths` into the engine's millisecond step; an explicit
`stepDurationMs` always wins.
