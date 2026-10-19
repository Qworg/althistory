# Deferred Test Fixes Implementation Plans

## Overview

These are the plans and the record of the work that resolved the 89 deferred
frontend tests identified in the original `DEFERREDFIXES.md`. All four are
complete: neither package has a skipped or disabled test today (backend
1689 passed / 88 files, frontend 1652 passed / 100 files at the time of writing —
re-measure, do not copy). They are kept as the design record for the test
infrastructure, not as pending work.

## Plan Summary

| Plan | Category | Outcome | Status |
|------|----------|---------|--------|
| [01-timeline-architecture-refactor.md](./01-timeline-architecture-refactor.md) | Component Architecture | Timeline rebuilt on `useTimelineScales` / `useTimelineEventHandlers`; D3 used for calculations only (see `ADR-001-d3-react-integration.md`) | ✅ Complete |
| [02-cytoscape-mocking-strategy.md](./02-cytoscape-mocking-strategy.md) | Library Mocking | `test/__mocks__/cytoscape.ts` + `helpers/cytoscapeTestHelpers.ts`; mock contract pinned by `test/__mocks__/cytoscape.test.ts` | ✅ Complete |
| [03-modal-testing-strategy.md](./03-modal-testing-strategy.md) | Integration Tests | Modal suites pass; `a11yTestHelpers.ts` and vitest-axe assertions in place | ✅ Complete |
| [04-causal-graph-advanced-features.md](./04-causal-graph-advanced-features.md) | Advanced Features | Causal graph, layout manager and path explorer suites pass | ✅ Complete |
| [05-parallel-remediation-plan.md](./05-parallel-remediation-plan.md) | Remediation record | Ground-truth baseline (84 failed) and the anti-cheat audit of the fixes that followed | ✅ Complete |

## Recommended Execution Order

### Phase 1: Foundation (Weeks 1-3)
**Focus: Timeline Component Architecture**

The Timeline component is the core of the application and affects the most tests. Addressing the infinite loop issues and D3-React integration problems will have the highest impact.

1. Audit current Timeline implementation
2. Extract testable logic to utility functions
3. Implement memoization strategy
4. Refactor D3-React integration
5. Update tests with simplified patterns

### Phase 2: Visualization Library Mocks (Weeks 4-5)
**Focus: Cytoscape Mocking Infrastructure**

Once the Timeline is stabilized, build comprehensive mocks for Cytoscape to enable testing of the causal graph components.

1. Create comprehensive Cytoscape mock
2. Build test helper utilities
3. Update existing tests to use new mocks
4. Extract component logic for unit testing

### Phase 3: Modal Components (Weeks 6-9)
**Focus: Form and Interaction Testing**

With core visualization fixed, address modal component testing by improving accessibility and simplifying test patterns.

1. Extract validation logic to testable utilities
2. Improve component accessibility (ARIA attributes)
3. Create shared modal base component
4. Refactor tests to use user-event patterns

### Phase 4: Advanced Features (Weeks 10-12)
**Focus: Causal Graph Features**

Finally, address the advanced causal graph features which are lower priority but affect power user functionality.

1. Extract algorithmic logic to utility functions
2. Create comprehensive test data generators
3. Simplify component tests
4. Add integration test coverage

## Cross-Cutting Concerns

### Test Infrastructure Improvements

All plans share common infrastructure needs:

```
frontend/src/test/
├── __mocks__/
│   ├── d3.ts                  # D3 mock (Plan 01)
│   └── cytoscape.ts           # Cytoscape mock (Plan 02)
├── fixtures/
│   └── modalFixtures.ts       # Modal test data (Plan 03)
├── generators/
│   └── causalDataGenerators.ts # Causal data generation (Plan 04)
├── helpers/
│   ├── cytoscapeTestHelpers.ts # Cytoscape test utilities (Plan 02)
│   └── a11yTestHelpers.ts      # Accessibility helpers (Plan 03)
└── mocks/
    └── causalApiMocks.ts       # API mocks (Plan 04)
```

### Shared Patterns

1. **Logic Extraction**: All plans emphasize extracting testable business logic from React components into pure utility functions.

2. **Simplified Component Tests**: Focus component tests on rendering and callbacks, not implementation details.

3. **Realistic Mock Data**: Use generators and fixtures to create realistic test data that matches API responses.

4. **Accessibility First**: Improve component accessibility to make testing with queries like `getByRole` and `getByLabelText` more reliable.

## Success Metrics

| Metric | Target | Current |
|--------|--------|---------|
| Total Deferred Tests | 0 | 89 |
| Test Coverage | >80% | Maintained |
| Component Re-renders | Minimal | TBD |
| Test Execution Time | <30s | TBD |

## Risk Mitigation

### Rollback Strategy
- Keep original implementations as `.legacy.tsx` files
- Use feature flags for gradual rollout
- Maintain parallel test suites during migration

### Quality Gates
- No merge without passing tests
- Performance benchmarks required for Timeline
- Accessibility audit for modal changes

## Getting Started

These plans describe how the suite reached its current state; there is no
remaining work to schedule from them. For current test status read
[`DEFERREDFIXES.md`](../../DEFERREDFIXES.md); for the current quality gates read
[`.github/workflows/ci.yml`](../../.github/workflows/ci.yml).

## Contributing

When implementing fixes:
1. Create a feature branch from `timeline-fe`
2. Follow the plan structure and phases
3. Add tests for new utility functions
4. Update documentation as needed
5. Request review before merging

## References

- [DEFERREDFIXES.md](../../DEFERREDFIXES.md) - Current test status
- [React Testing Library Best Practices](https://testing-library.com/docs/react-testing-library/intro/)
- [Vitest Documentation](https://vitest.dev/)
- [D3.js + React Patterns](https://d3js.org/)
- [Cytoscape.js Documentation](https://js.cytoscape.org/)
