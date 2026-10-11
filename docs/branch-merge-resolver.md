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

### On "harmonized compromise"

The merge API resolves a conflict **per entity** by choosing a side; it has no
field for a merged payload. A field-level “harmonized compromise” would
therefore have to silently degrade to `keep-target`, discarding the branch edit
the user thought they were blending. The UI does not offer that button for
exactly that reason; it tells the user to resolve by side and edit the surviving
entity afterward. Adding a real compromise needs a backend `merged` payload in
`manualResolutions`, which is a separate change.

Graph-level circular-causal detection before a merge is likewise **not** part of
this feature: `detectMergeConflicts` compares entity records, it does not walk
the causal DAG. A caller who wants that assurance runs the graph validator
(`GET/POST /validate/graph`) after merging.

---

## 4. Where it lives

| Layer | File |
| :--- | :--- |
| API client | `apiClient.graphs.mergeDetailed` in `frontend/src/services/api.ts` (returns 409 conflicts instead of throwing) |
| Resolver UI | `frontend/src/components/branch/BranchMergeModal.tsx` |
| Entry point | “Merge Branch into Baseline” in the footer of the Counterfactual Divergence Explorer (`BranchComparisonModal`), which the toolbar's *Branch Comparison* action opens |
| Backend | `dryRun` handling in `GraphService.mergeGraph` and the merge route |
