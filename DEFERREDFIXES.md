# Test Status

**Measured:** backend 1721 passed / 88 files, frontend 1652 passed / 100 files, no
skipped or disabled tests in either package. Re-measure with `npm test` in each
package; do not copy these figures forward without re-running.

This file used to be a "Deferred Test Fixes Report" claiming *"965 passed |
7 skipped — ALL PASSING"*. Both halves were wrong: the suite was larger than
that, and the file described 89 deferred tests that had already been fixed
(`EventInteraction.test.tsx` was listed as "ALL PASSING" while it was a 668-line
`describe.skip`). The history of how they were fixed is preserved in
[`impl/deferredplans/05-parallel-remediation-plan.md`](impl/deferredplans/05-parallel-remediation-plan.md),
which starts from the ground-truth 84-failure baseline.

## What is actually disabled

Nothing. Neither package contains `it.skip`, `describe.skip`, `.todo` tests, or a
disabled test file. If a future change needs to disable a test, this document
should record the reason and the issue that removes it, rather than restoring the
old practice of claiming a green suite.

## Where the test evidence lives

- `./run-tests.sh` — both unit/integration suites.
- `.github/workflows/ci.yml` — the same suites plus coverage, lint, typecheck and
  the production build, gated on every push to `main` and every pull request.
- [`impl/gap-remediation/phase6-results.md`](impl/gap-remediation/phase6-results.md) —
  measured coverage baseline and the caveats that make the branch/function
  percentages optimistic.
- [`e2e/README.md`](e2e/README.md) — Playwright end-to-end and visual-regression
  runs (visual baselines are platform-specific and excluded from CI).
