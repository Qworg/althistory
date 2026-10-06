# Independent Review Practice

How finished work in this repo gets independently reviewed. Written after the PR #5 review round,
which found six real defects across twelve slices.

## Why

The PR #5 review found six defects, and **every one was the same shape**: a guarantee asserted in a
commit message that the code did not deliver.

| Defect | Shape |
|---|---|
| Deletion left orphaned causal relationships | Test used an **unlinked** event, so it passed while proving nothing |
| "Unscoped reads are now a compile error" | False — three cast-free paths still reached global data; the author's probe sampled the happy path and agreed with him |
| A re-enabled test was **inverted** | Asserted the opposite of its original requirement, behind a plausible-sounding comment |
| "Non-optional `graphId`" | Type-level claim with no runtime backing; a missed mount read `undefined` silently |
| ADR counts presented as "verified" | Three of five were wrong; the ADR committed the exact sin it criticised |
| LRU eviction test | Awaited its calls **sequentially**, so it never created the in-flight entry a sibling can evict |

None was a logic slip. They were **verification failures** — a claim outrunning its evidence. That is
what an independent reviewer is for, and it is why self-review and test counts are not enough:
counting tests cannot detect an inverted expectation.

## Reviewer model

### Preferred: Claude Code in headless mode (subscription, not OpenRouter)

```sh
claude -p "$(cat /tmp/brief.md)" \
  --model claude-opus-5-5 \
  --allowedTools "Read Grep Glob Bash" \
  --disallowedTools "Edit Write NotebookEdit" \
  --effort high \
  --output-format json
```

Verified working. Notes, all checked by hand rather than assumed:

- **The model id is `claude-opus-5-5`** — hyphens, not `claude-opus-5.5`. The dotted form is
  rejected with "may not exist or you may not have access", and `opus-5.5` / `opus5.5` are not in
  this version's catalog. The alias `opus` also works and resolves to the latest.
- Resolves as canonical `claude-opus-5-5`, 1M context, 128k max output, `provider: firstParty`.
- Auth is the **claude.ai subscription** (`claude auth status` → `loggedIn: true`,
  `authMethod: claude.ai`), so this consumes subscription quota rather than OpenRouter credits.
- `--allowedTools` plus `--disallowedTools` makes it genuinely read-only and non-interactive; no
  permission prompts in `--print` mode once the tool set is declared.
- `--output-format json` wraps the run with metadata (turns, `total_cost_usd`, `modelUsage`); the
  review text is in `.result`. Ask for a single JSON object and parse it out.
- Budget roughly 20–25 tool turns and 3–4 minutes per slice at `--effort high`.

This is the **preferred** reviewer: stronger than the OpenRouter models, read-only by construction, and
it does not consume the OpenRouter balance. Use it for the default review.

### OpenRouter fallbacks

| Role | Model |
|---|---|
| Primary | `openrouter/openai/gpt-6.1-sol-pro` |
| Lower-cost fallback | `openrouter/anthropic/claude-sonnet-5.5` |

**Say which reviewer model reviewed which slice** in the result. A substitute reviewer is a materially
different guarantee, and passing one off as another is the same class of dishonesty as an unverified
claim — the thing this review process exists to catch.

`openrouter/openai/gpt-6.1-sol-pro` requests up to **128,000 max_tokens**. If the key can afford less,
every call returns `402 insufficient credits` — instantly, with no output, which looks exactly like a
timeout or an overloaded batch. **Read the error before theorising about the cause.**

## Run reviewers ONE AT A TIME

A single review costs roughly 110k tokens on OpenRouter. Concurrent reviewers share one balance, so a
batch of six could afford only one and five returned nothing:

| Run | Returned |
|---|---|
| 12 concurrent | 5/12 |
| 4 concurrent | 1/4 |
| 6 concurrent | 1/6 |
| **6 sequential** | **5/5** |

Sequential is the only configuration that reliably returns. It is slower and it is the right trade. The
headless-Claude route is not subject to this shared-balance problem, which is another reason to prefer it.

## The brief

Give each reviewer **one slice** (a commit or small commit range) and the claims from its commit
message. Ask for adversarial review, not confirmation. The standing instruction:

> Try to **falsify**, do not confirm. A reviewer who confirms is worthless. Hunt for **a claim slightly
> broader than the code; a type-level guarantee with no runtime backing; a test that asserts the
> declared type rather than the behaviour; a comment rationalising behaviour rather than the behaviour
> being right.**

Also hunt for: a test skipped, deleted, weakened, or **inverted** to make something pass; a suppression
(`any` / `as any` / `@ts-ignore` / `@ts-expect-error` / `eslint-disable` / `@ts-nocheck`) or a config
loosened — note `any` **is** permitted in test files by this repo's eslint config, and pre-existing
suppressions are not the slice's fault; a silent behaviour change or a fallback that re-creates the bug
being fixed; isolation that looks structural but is bypassable; and a test claimed to "fail before /
pass after" that would in fact pass either way.

And: **do not invent problems to seem thorough.** A "clean" verdict is valid only when the reviewer
shows what it checked.

## Practical rules for the brief

- **Time-box it.** Reviewers that ran unbounded returned nothing. Mandate: read the diff, list the
  claims, read the 2–3 files that matter, spot-check (no full suite), then **submit** — a partial
  honest review beats a silent timeout.
- **Structure the output** (verdict, per-claim holds/evidence, findings with severity + file:line +
  evidence, rule violations, what was checked but clean, what was not reviewed).
- **Require evidence for a "fails before the fix" claim.** Verify by reverting, not by assumption.
- **A defect is usually one step outside what the test asserts.** Three of the six were found that way.

## Verify the reviewer, too

Reviewer findings are claims like any other. The S7 "blocker" (an unscoped `causalService` in
`suggest.ts`) was real at its commit but **already fixed** by later work — so confirm a finding on
current HEAD before acting on it. `getVersionHistory`-style asymmetric assertions, probe files and
greps are all cheap ways to check.

## Apply it before merging

Every finished slice gets a review before it is called done. Track what has and has not been reviewed
explicitly — "the PR was reviewed" is not a claim to make when half the slices were not.
