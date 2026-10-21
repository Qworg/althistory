/**
 * The frontend's copy of the causal-order rule, and the check that no other
 * file in the frontend compares a cause with an effect on its own.
 *
 * The backend keeps the same rule in `timeline/src/utils/causalOrder.ts` and
 * checks its own tree the same way. The two packages cannot import each
 * other, so the rule is written down twice -- and each package checks that
 * it is the only place in it that compares a cause with its effect.
 */

import { describe, it, expect } from 'vitest'

/**
 * The source of every file of the frontend, keyed by its path.
 *
 * The files are read through Vite's raw import, so the check needs nothing
 * but the bundler the frontend already uses.
 */
const SOURCES = import.meta.glob('../**/*.{ts,tsx}', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

/**
 * Whether a file compares a cause with an effect on its own.
 *
 * The comparison is found by its operands rather than by its spelling, so
 * that `cause.timestamp.getTime() >= effect.timestamp.getTime()`,
 * `causeTime > effectTime` and `cause.timestamp < effect.timestamp` are all
 * caught -- and so is a spelling nobody has thought of yet.
 */
function comparesCauseWithEffect(text: string): boolean {
  const code = text
    .replace(/\/\/[^\n]*/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/'[^'\n]*'/g, "''")
    .replace(/"[^"\n]*"/g, '""')
    .replace(/`[^`]*`/g, '``')

  const operator = /(<=|>=|===|!==|<|>)/g
  let match: RegExpExecArray | null

  while ((match = operator.exec(code)) !== null) {
    const operatorText = match[1] ?? ''
    const before = code.slice(Math.max(0, match.index - 160), match.index)
    const after = code.slice(match.index + operatorText.length, match.index + operatorText.length + 160)

    const operand =
      /(\([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*\)|[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*(?:\(\))?)\s*$/
    const left = before.match(operand)?.[1] ?? ''
    const right = after.match(
      /^\s*(\([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*\)|[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*(?:\(\))?)/
    )?.[1] ?? ''

    const leftIsCause = /cause/i.test(left)
    const rightIsCause = /cause/i.test(right)
    const leftIsEffect = /effect/i.test(left)
    const rightIsEffect = /effect/i.test(right)

    // The comparison has to be about *time*. `cause_event_id ===
    // effect_event_id` is a self-causation check, not the order of a cause
    // and its effect.
    const isTime = (operand: string): boolean => /time|date|stamp/i.test(operand)

    if (
      (leftIsCause && rightIsEffect && (isTime(left) || isTime(right))) ||
      (leftIsEffect && rightIsCause && (isTime(left) || isTime(right)))
    ) {
      return true
    }
  }

  return false
}

describe('the causal-order rule is applied in one place', () => {
  it('should leave no path comparing a cause with an effect on its own', () => {
    const offenders: string[] = []

    for (const [file, text] of Object.entries(SOURCES)) {
      if (file.endsWith('/utils/causalOrder.ts')) continue
      if (file.includes('.test.')) continue

      if (comparesCauseWithEffect(text)) {
        offenders.push(file)
      }
    }

    expect(offenders).toEqual([])
  })
})
