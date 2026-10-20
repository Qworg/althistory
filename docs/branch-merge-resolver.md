# Interactive Branch Merge & Conflict Resolver

The web UI can merge a counterfactual branch into its baseline graph through a
Git-style conflict resolver. It is a thin, honest client of the existing
`POST /graphs/:id/merge` endpoint — no merge semantics live in the browser.

---

## 1. Pre-merge dry run

`POST /graphs/:id/merge` now accepts `dryRun: true`:

```jsonc
{
  "sourceGraphId": "graph_branch",
  "conflictResolution": "manual",
  "dryRun": true
}
```

A dry run computes the same conflict set a real merge would, then returns
without committing:

| Outcome | Response |
| :--- | :--- |
| conflicts found | `409` `{ "success": false, "conflicts": [...] }` |
| clean | `200` `{ "success": true, "dryRun": true, "data": <target graph> }` — **no version is written** |

The `dryRun` check runs before the manual-resolution requirement, because a
preview resolves nothing: requiring a resolution map up front would force the
caller to decide before it has seen the conflicts. A dry run never allocates a
version and never calls `commitChanges`.

## 2. Conflict shape

Each conflict names the entity, the two versions, and a suggested side:

```jsonc
{
  "entityType": "event",            // event | arc | relationship | pressure
  "entityId": "event_...",
  "targetVersion": { ... },         // baseline record
  "sourceVersion": { ... },         // branch record
  "suggestedResolution": "keep-target"
}
```

`suggestedResolution` is advisory. The UI starts every conflict **unresolved**
rather than pre-selecting the suggestion, so a commit cannot go through with
entities the caller never reviewed.

## 3. Resolving and committing

Per conflict the caller picks one side:

- **Keep baseline** → `keep-target`
- **Accept counterfactual** → `keep-source`

“Keep all baseline” / “Accept all branch” apply a side to every conflict. The
commit call sends one resolution per conflict, keyed `${entityType}:${entityId}`:

```jsonc
{
  "sourceGraphId": "graph_branch",
  "conflictResolution": "manual",
  "manualResolutions": {
    "event:event_abc": "keep-target",
    "arc:arc_xyz": "keep-source"
  }
}
```

The commit button stays disabled until every conflict has a resolution. If the
baseline advanced between the dry run and the commit, the server refuses and
returns a fresh conflict set, which the UI re-renders instead of retrying
blindly.

### Harmonized compromise (Field-level blending)

The merge API and UI support field-level compromises across conflicts. Callers can specify `{ strategy: "merged", value: { ... } }` in `manualResolutions`:

```jsonc
{
  "sourceGraphId": "graph_branch",
  "conflictResolution": "manual",
  "manualResolutions": {
    "event:event_abc": {
      "strategy": "merged",
      "value": {
        "description": "Blended description",
        "actor": "Branch Actor",
        "target": "Baseline Target"
      }
    }
  }
}
```

In `BranchMergeModal.tsx`, choosing **Harmonized compromise** renders an inline field selector allowing users to choose baseline vs. branch values per differing property.

A blended payload is applied as `{ ...target, ...payload, id }`, so it can change
any field of the entity it resolves. Because that is unchecked, the service
validates the payload before applying it (`services/mergedEntityValidation.ts`)
and refuses the merge with a message naming the conflict and the field:

- the payload may not rename the entity (`id` is fixed by the merge);
- a field the graph has must keep its kind -- a `timestamp` that becomes a
  number is a different instant, or no instant at all;
- a field may not be set to `undefined`, which would drop it;
- a field the graph does not have may be added, and must be a JSON value.

The merge is also refused when the *result* would not hold together. Beyond the
anomalies below, a blended arc may not name a parent arc that does not exist,
and a blended pressure may not name events or arcs that do not exist
(`orphan_reference`).

### Pre-merge anomaly detection

During `dryRun: true` (and verified before committing), `GraphService.mergeGraph` performs a DAG and temporal analysis over the candidate merged graph:
- **Causal cycle detection**: Ensures combined causal relationships form a strict directed acyclic graph (DAG) without circular dependencies.
- **Temporal inversions**: Identifies causal relationships where the cause event timestamp occurs at or after the effect event timestamp.
- **Orphan relationships**: Flags relationships referencing missing cause or effect entities.
- **Orphan references**: Flags an arc naming a parent arc that does not exist, and a pressure naming events or arcs that do not exist.

Detected anomalies are returned in `anomalies: MergeAnomaly[]` and surfaced as blocking warnings in `BranchMergeModal.tsx`.

---

## 4. Where it lives

| Layer | File |
| :--- | :--- |
| API client | `apiClient.graphs.mergeDetailed` in `frontend/src/services/api.ts` (returns 409 conflicts instead of throwing) |
| Resolver UI | `frontend/src/components/branch/BranchMergeModal.tsx` |
| Entry point | “Merge Branch into Baseline” in the footer of the Counterfactual Divergence Explorer (`BranchComparisonModal`), which the toolbar's *Branch Comparison* action opens |
| Backend | `dryRun` handling in `GraphService.mergeGraph` and the merge route |
