# ADR-001: D3-React Integration Pattern

## Status
**Accepted**

## Date
2024-12-19

## Context

The Timeline component in the frontend application needs to integrate D3.js for data visualization with React's declarative rendering model. This has caused infinite update loops due to:
1. State management problems with useEffect hooks
2. D3 potentially manipulating DOM directly while React expects declarative updates
3. Performance anti-patterns (missing memoization)

We need to establish a clear pattern for how these two libraries should interact.

## Decision

**We will use Option A: React Owns the DOM**

D3 will be used **only for calculations** (scales, layouts, data transformations), while React handles **all DOM rendering**.

### Implementation Pattern

1. **D3 for Calculations Only:**
   - `d3.scaleTime()` for time scale computations
   - `d3.scaleLinear()` for linear scale computations
   - Data transformation and layout algorithms
   - Position calculations

2. **React for DOM:**
   - All SVG elements rendered via JSX
   - Event handlers attached via React props
   - State managed via React hooks and Zustand store
   - Memoization via `useMemo` and `useCallback`

3. **Hook Architecture:**
   - `useTimelineScales`: Memoized D3 scale calculations
   - `useTimelineEventHandlers`: Stable callback references using refs
   - Pure calculation functions in `utils/d3Calculations.ts`

4. **Ref Pattern for Callbacks:**
   ```typescript
   // To avoid dependency issues with callbacks in useEffect
   const onTimeRangeChangeRef = useRef(onTimeRangeChange)
   onTimeRangeChangeRef.current = onTimeRangeChange

   useEffect(() => {
     onTimeRangeChangeRef.current?.({ start, end })
   }, [start, end]) // callback NOT in dependencies
   ```

## Consequences

### Positive
- **Better testability**: React components can be tested with standard React Testing Library
- **Maintainable code**: Clear separation of concerns
- **No DOM conflicts**: React is sole owner of DOM, preventing reconciliation issues
- **Performance**: Proper memoization prevents unnecessary recalculations
- **No infinite loops**: Ref pattern breaks dependency cycles

### Negative
- Complex D3 animations harder to implement (would need isolated D3 sections)
- More boilerplate for hook creation
- May need to refactor existing animation code

### Mitigations
- For advanced animations that require D3 DOM control, create isolated container components
- Document patterns clearly for future contributors

## References
- [01-timeline-architecture-refactor.md](./01-timeline-architecture-refactor.md)
- React documentation on useEffect dependencies
- D3 integration patterns with React

## Audit Results (Phase 1.1)

### Current State Analysis

**useEffect Hooks:**
- Lines 74-76: `onTimeRangeChange` effect with `[xDomain[0]?.getTime(), xDomain[1]?.getTime()]` dependencies
  - **Status**: FIXED - Uses ref pattern (lines 70-71) to stabilize callback reference
  - **Pattern**: `onTimeRangeChangeRef.current` instead of direct callback in dependencies

**D3 Usage:**
- `d3.scaleTime()` for xScale computation via `useTimelineScales` hook (correct usage - calculation only)
- `xScale.invert()` for converting pixel position to date in `useTimelineEventHandlers` (correct usage)
- No direct DOM manipulation via D3 (good - already follows Option A)

**State Variables:**
- `eventAssignmentModal`: Local modal state (lines 53-57, appropriate)
- No visualization state (zoom, pan) - could be added for advanced features

**Zustand Store:**
- No direct subscriptions in Timeline.tsx (state passed via props)

**Custom Hooks:**
- `useTimelineScales` (line 60-66): Memoized scale calculations
- `useTimelineEventHandlers` (lines 96-103): Stable event handlers using ref pattern

### Conclusion
The Timeline component has been refactored to follow the "React Owns the DOM" pattern:
- All D3 calculations are memoized in custom hooks
- Event handlers use the ref pattern to avoid dependency issues
- No infinite loop risks remain
- DOM rendering is fully declarative via JSX
