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
| timeline | 69.16%     | ~78.5%   | 83.67%    | 69.16% | 1320 passed / 1 skipped |

Both packages use `all: true` in `vitest.config.ts`, so the denominator counts
every source file matching `include` -- `.ts` and `.tsx` in both packages --
including files no test imports. Two further settings have to agree before the
figures mean the same thing, and both now do:

* `include` covers `.ts` and `.tsx` in both packages. The backend glob was
  originally `.ts` only and was widened after an independent review found it had
  silently omitted the five non-test `.tsx` components (1081 lines, including
  `TimelineVisualization.tsx`, which has running tests).
* `ignoreEmptyLines` is `true` in both. Vitest 3 (the frontend) defaults it to
  `true`; Vitest 1 (the backend) defaults it to `false`, so the backend was
  counting every physical line -- blank lines, comment-only lines and all -- as
  a statement. Its pre-fix statement total, 31050, is exactly the physical line
  count of the 70 files the report covered. Setting it explicitly to `true` in
  `timeline/vitest.config.ts` drops the denominator to 18834 executable lines,
  so both packages now count the same kind of thing and the figures are
  comparable.

Comparability is at the engine level too, not just the option level. Both
packages resolve to the same line-based `v8-to-istanbul` converter bundled in
`@vitest/coverage-v8`; the AST-aware `experimentalAstAwareRemapping` path is not
enabled in either. `_buildLines` and `_parseLinesToCover` are identical between
the two bundled copies, and the only engine difference is that the newer
frontend copy also understands `node:coverage` ignore comments -- neither tree
contains any ignore comment. Statements and lines are consequently identical
within each package, which is what that engine produces.

### Caveat: branch and function percentages are flattered

With `all: true`, a file that no test imports reports 0/0 branches and 0/0
functions, and v8 scores an empty or near-empty denominator as 100%. Every
never-loaded file therefore pulls the branch and function percentages *up*. At
this baseline `src/utils/index.ts` is 0% statements but 100% branches and 100%
functions.
Statements and lines do not have this artifact: an unimported file has a
non-empty statement count, all uncovered.

This is inherent to v8's `all: true` mode, not a config error -- v8 has no
reporting option that renders 0/0 as 0%. Do not read the branch or function
figure as clean coverage, and do not drop `all: true` to "fix" it: counting
unimported files is the correct behaviour. The same note sits next to
`all: true` in both `vitest.config.ts` files.

### The backend figure is not reproducible to the hundredth

Two consecutive runs of the full backend suite on the same tree are not
identical. Before the `ignoreEmptyLines` change, statements/lines moved 77.51%
<-> 77.49% and the branch total moved (3680 vs 3674). After it, two runs gave
statements 13027/18834 and 13026/18834, with branch totals 3677 and 3674 (78.54%
and 78.52%), so the backend branch figure is quoted above as ~78.5% rather than
to hundredths. Some tests exercise data-dependent paths and v8 instrumentation
is worker/timing dependent; the frontend shows the same effect on a smaller
scale (branch total 2838 vs 2837 across two runs, with the percentage unchanged
at 83.75). The frontend percentages reproduced exactly at two decimals
(67.33/83.75/65.55/67.33) against the earlier measurement.

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
