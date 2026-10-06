# Phase 6 coverage and accessibility results

Measured after the Phase 6.2 coverage tooling and Phase 6.3 axe assertions
landed. Re-measure with `npm run test:coverage` in each package; do not copy
figures forward without re-running.

## Coverage baseline

No failing threshold is set, deliberately: a threshold chosen blind either fails
on the first run or is so low it gates nothing. The low-coverage list, not the
single number, is the useful output.

| package  | statements | branches | functions | lines | suite |
|----------|-----------:|---------:|----------:|------:|-------|
| frontend | 67.33%     | 83.75%   | 65.55%    | 67.33% | 1438 passed / 1 skipped |
| timeline | ~77.5%     | ~78.5%   | 83.67%    | ~77.5% | 1320 passed / 1 skipped |

Both packages use `all: true` in `vitest.config.ts`, so the denominator counts
every source file matching `include` -- `.ts` and `.tsx` in both packages --
including files no test imports. The two figures are therefore comparable: the
backend `include` glob was widened from `.ts` only to `.ts,tsx` after an
independent review found that the original glob silently omitted the five
non-test `.tsx` components (1081 lines, including `TimelineVisualization.tsx`,
which has running tests).

### Caveat: branch and function percentages are flattered

With `all: true`, a file that no test imports reports 0/0 branches and 0/0
functions, and v8 scores an empty denominator as 100%. Every never-loaded file
therefore pulls the branch and function percentages *up*. At this baseline
`src/utils/index.ts` is 0% statements but 100% branches and 100% functions.
Statements and lines do not have this artifact: an unimported file has a
non-empty statement count, all uncovered.

This is inherent to v8's `all: true` mode, not a config error -- v8 has no
reporting option that renders 0/0 as 0%. Do not read the branch or function
figure as clean coverage, and do not drop `all: true` to "fix" it: counting
unimported files is the correct behaviour. The same note sits next to
`all: true` in both `vitest.config.ts` files.

### The backend figure is not reproducible to the hundredth

Two consecutive runs of the full backend suite on the same tree produced
statements/lines 77.51% and 77.49%, and branches 78.61% and 78.52% (functions
stable at 83.67%). The branch *total* itself moved between runs (3680 vs 3674),
so the v8 instrumentation is timing/worker dependent. Treat the backend figures
as ~77.5% statements/lines and ~78.5% branches, and do not quote hundredths for
them.

## Accessibility checks (vitest-axe)

`toHaveNoViolations()` assertions run under axe + jsdom. They cover element
roles, accessible names, label/control associations, ARIA attribute validity,
and required-children / required-parent relationships within the DOM node handed
to `axe()`. They do NOT cover:

- Colour contrast or any rule that needs computed layout. jsdom performs no
  layout and does not apply Tailwind, so axe cannot evaluate those rules.
- Responsive visibility. Tailwind classes such as `hidden sm:inline` are inert
  under jsdom, so a label hidden at narrow viewports is treated as visible. A
  `ViewToolbar` button's `aria-label` is therefore redundant in these tests; the
  assertion does not prove the accessible name survives once the visible text is
  genuinely hidden.
- Portaled content. `axe(container)` sees only the subtree under `container`.
  None of the components under test uses a React portal today, so this limit is
  latent.

The same limits are stated in `frontend/src/test/setup.ts`.
