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
- Line 79-81: `onTimeRangeChange` effect with `[xDomainStart, xDomainEnd, onTimeRangeChange]` dependencies
  - **Issue**: Callback in dependencies can cause infinite loops if parent re-renders
  - **Fix**: Use ref pattern to stabilize callback reference

**D3 Usage:**
- `d3.scaleTime()` for xScale computation (correct usage - calculation only)
- `xScale.invert()` for converting pixel position to date (correct usage)
- No direct DOM manipulation via D3 (good - already follows Option A)

**State Variables:**
- `eventAssignmentModal`: Local modal state (appropriate)
- No visualization state (zoom, pan) - could be added for advanced features

**Zustand Store:**
- No direct subscriptions in Timeline.tsx (state passed via props)

### Conclusion
The Timeline component is mostly well-architected. Primary fix needed is the useEffect dependency pattern.
