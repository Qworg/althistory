# ADR-001: D3 / React Integration Pattern

## Status

**Accepted — revision 3.** Revision 2 corrected revision 1's premise (the hybrid was real) but
replaced revision 1's unchecked assertion with its own uncited D3 DOM-operation counts. Revision 3
keeps the decision and replaces those counts with a command a reader can re-run; the numbers were
wrong (three of five) and the lesson is applied rather than restated.

## Date

2026-10 (revision 3) · 2026-10 (revision 2) · 2024-12-19 (revision 1)

## Context

Revision 1 was written while the Timeline component was suffering infinite update loops. It decided
"Option A: React owns the DOM" — D3 for calculations only, all SVG via JSX.

That decision did fix the loops, and revision 1's core prescription (memoized scale hooks, the
callback-ref pattern) is still correct and still followed. **But the decision was never actually
implemented as written**, and revision 1's audit falsely claimed it had been:

> "No direct DOM manipulation via D3 (good - already follows Option A)"

That statement was already untrue when it was written. What the codebase actually contains is a
**hybrid**, and it spans a wide range:

| Tier | Pattern | Where |
|---|---|---|
| 1 | React owns everything; D3 for pure calculation | `useTimelineScales`, `d3Calculations.ts`, `TimelineEvent.tsx`, `TimelineArc.tsx` (both 0 matched lines) |
| 2 | React owns structure; D3 owns *behaviour* on a React-rendered element | `Timeline.tsx` — React renders `<svg ref={svgRef}>` and all marks; D3 attaches zoom/pan via `svg.call(zoom)` and drives fit-to-view `transition()` (12 matched lines) |
| 3 | D3 owns an isolated subtree that React never renders into | `ActorTimeline.tsx` (172 matched lines: axes, ticks, events, arcs, an appended `button`), `PressureIndicators.tsx` (92 matched lines, plus `defs.append('linearGradient')`) |

### How those counts were obtained

A "matched line" is a source line containing a D3 selection/DOM call, counted from the repository
root with:

```sh
grep -cE '\.(append|select|selectAll|attr|style|call|transition|data|enter|exit|remove|text|on|insert|merge|join|each|html|property|classed|duration|delay|ease|tween|interrupt)\(' \
  frontend/src/components/timeline/{Timeline,ActorTimeline,PressureIndicators,TimelineEvent,TimelineArc}.tsx
```

Its real output is:

```
frontend/src/components/timeline/Timeline.tsx:12
frontend/src/components/timeline/ActorTimeline.tsx:172
frontend/src/components/timeline/PressureIndicators.tsx:92
frontend/src/components/timeline/TimelineEvent.tsx:0
frontend/src/components/timeline/TimelineArc.tsx:0
```

This is deliberately a **line count, not an operation count**, and the pattern is a definition of
what was counted rather than a measure of DOM cost; a line may issue more than one call. The figures
place the tiers on a rough scale and are reproducible. (Revision 2's 8 / 95 / 63 figures came from
no cited command and do not reproduce; Timeline, ActorTimeline and PressureIndicators are wrong, two
by roughly 1.8x.)

Tier 3 also reaches *outside* any container: `ActorTimeline.tsx:356` does
`d3.select('body').append('div')` for tooltips, creating DOM React has no knowledge of.

So the choice is not between two clean options. It is: document the hybrid honestly and set rules
for where each tier is acceptable, or spend significant effort converting working, tested Tier 3
code to Tier 1 for doctrinal purity. This ADR takes the first path.

## Decision

**Adopt a documented three-tier hybrid. Tier 1 is the default for new work. Tiers 2 and 3 are
permitted where they earn their cost, under the constraints below.**

### Tier 1 — React owns the DOM (default)

D3 is used **only** for calculation: scales, layouts, data transformation, position maths.

- All SVG produced via JSX.
- Interactions via React props.
- Calculation lives in pure functions (`utils/d3Calculations.ts`) or memoized hooks
  (`useTimelineScales`).
- **This is the default.** New components start here, and Tier 3 code should prefer moving to
  Tier 1 when it is already being rewritten for another reason.

### Tier 2 — React owns structure, D3 owns behaviour

React renders the element; D3 attaches behaviour to it.

- D3 zoom/pan via `d3.zoom()` + `element.call(zoom)` on a React-rendered `<svg ref>`.
- Imperative `transition()` for animation that would be awkward to express declaratively.
- **The element must be React-rendered and stable.** D3 mutates attributes and transforms on it; it
  must not add, remove, or re-order nodes that React also renders.
- This is the right tier for interaction behaviour and animation. It is not an escape hatch for
  structure.

### Tier 3 — D3 owns an isolated subtree

D3 renders a subtree's contents and React never re-renders into it.

Permitted **only** when all of the following hold:

1. The D3-managed content is inside a dedicated container component whose React render output is a
   stable shell (`<div ref>` + `<svg ref>`), with **no React-rendered children inside the
   D3-managed node**. React re-rendering an element that D3 has populated is the exact class of bug
   this ADR exists to prevent.
2. The D3 entry point lives in a single `useEffect` keyed on the data it draws, and clears content
   before redrawing rather than appending duplicates.
3. Every listener, timer, and appended node is cleaned up on unmount.
4. The component documents in a comment why Tier 3 was chosen over Tier 1.

**Prefer Tier 1 when a subtree is small or mostly static.** Tier 3 is justified by scale and by
duration-based animation — the actor-perspective chart and pressure gradients are both cases where
the declarative equivalent would be substantially larger and slower.

### Rule: do not escape the React tree

`d3.select('body').append(...)` (as at `ActorTimeline.tsx:356`) is **not permitted for new code**.
Appending to `body` creates DOM outside React's tree with no lifecycle, no cleanup, and no test
visibility. Existing instances are tolerated but should migrate to either:

- a React-rendered tooltip positioned via state, or
- a portal (`createPortal`) into a known node, so React still owns the lifecycle.

## Consequences

### Positive

- The rules describe what the code actually does, so drift produces a code-review conversation rather
  than a false audit.
- New work has a clear default (Tier 1) without a mandate to rewrite working Tier 3 components.
- Tier 3 is explicitly bounded, so "D3 owns it" stops being a way to avoid thinking about lifecycle
  and cleanup.
- The genuine wins from revision 1 are preserved: memoized scales, the callback-ref pattern, and no
  infinite update loops.

### Negative / risks (stated honestly)

- **D3-owned DOM is invisible to React.** Tier 2 and 3 elements cannot be asserted on with React
  Testing Library queries, and React cannot reconcile them. This is a real, permanent testing cost.
- Two rendering models coexist, so contributors must know which tier they are in.
- Mixed model means React `StrictMode` double-invocation can duplicate D3 appends unless effect
  cleanup is correct — a concrete reason rule 3 above is mandatory.
- Tier 3 components must be re-rendered deliberately (keyed on data), not incidentally.

### Mitigations

- Tests for Tier 2/3 behaviour query the DOM directly (or the D3 computation functions, which are
  pure and unit-tested separately) rather than relying on RTL accessibility queries.
- Tier 3 effects clear their container before drawing.
- Revision 1's hook architecture and ref pattern remain the documented approach for Tier 1.

## Relationship to revision 1

Kept from revision 1, still correct:

- D3 for scale/layout computation, exposed through memoized hooks.
- The callback-ref pattern to keep callbacks out of effect dependency arrays.
- Pure calculation modules (`d3Calculations.ts`).

Corrected across revisions 2–3:

- "React owns the DOM" as a blanket rule — it is now the **default tier**, not a universal law.
- The "Audit Results" claim that no direct DOM manipulation existed. It did, and does.
- The implication that D3-owned rendering is a defect. It is a supported tier with constraints.
- Revision 2's uncited D3 DOM-operation counts. They are replaced by the reproducible command and
  output above; the decision is unchanged.

## References

- [01-timeline-architecture-refactor.md](./01-timeline-architecture-refactor.md)
- [`impl/gap-remediation/README.md`](../../gap-remediation/README.md) — Phase 2.3
- React docs: `useEffect` dependencies, `StrictMode` double-invocation, `createPortal`
- D3 + React integration patterns

Revision 3 changed nothing about the decision; it replaced revision 2's three wrong DOM counts with
the reproducible command and output shown above.

---

## Appendix: revision 1 (2024-12-19), preserved for history

**Decision:** "We will use Option A: React Owns the DOM" — D3 for calculations only, React handles
all DOM rendering. Hook architecture: `useTimelineScales` (memoized scale calculations),
`useTimelineEventHandlers` (stable callbacks via refs), pure functions in `utils/d3Calculations.ts`.
Ref pattern for callbacks:

```typescript
const onTimeRangeChangeRef = useRef(onTimeRangeChange)
onTimeRangeChangeRef.current = onTimeRangeChange

useEffect(() => {
  onTimeRangeChangeRef.current?.({ start, end })
}, [start, end]) // callback NOT in dependencies
```

Its "Audit Results" section asserted "No direct DOM manipulation via D3 (good - already follows
Option A)". As recorded above, this was inaccurate: `Timeline.tsx` used D3 for zoom and transitions,
and `ActorTimeline.tsx` / `PressureIndicators.tsx` were already D3-rendered.
