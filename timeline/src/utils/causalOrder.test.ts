/**
 * Tests for the shared causal-order rule.
 *
 * The rule is that a cause may happen at the same moment as its effect, and
 * that only a cause which happens *strictly after* its effect is an error.
 * Every path that looks at a causal pair asks these functions, so they
 * cannot drift apart again -- the drift test at the bottom checks that no
 * other file compares a cause with an effect on its own.
 */

import { describe, it, expect } from 'vitest'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import {
  isTemporalInversion,
  isCausalOrderValid,
  isSimultaneous,
} from './causalOrder'

describe('isTemporalInversion', () => {
  it('should be true when the cause is after the effect', () => {
    expect(
      isTemporalInversion(new Date('2023-01-02T00:00:00Z'), new Date('2023-01-01T00:00:00Z'))
    ).toBe(true)
  })

  it('should be false when the cause is before the effect', () => {
    expect(
      isTemporalInversion(new Date('2023-01-01T00:00:00Z'), new Date('2023-01-02T00:00:00Z'))
    ).toBe(false)
  })

  it('should be false when the cause and the effect are at the same moment', () => {
    const moment = new Date('2023-01-01T00:00:00Z')
    expect(isTemporalInversion(moment, moment)).toBe(false)
  })

  it('should accept millisecond timestamps as well as dates', () => {
    const moment = Date.parse('2023-01-01T00:00:00Z')
    expect(isTemporalInversion(moment + 1000, moment)).toBe(true)
    expect(isTemporalInversion(moment, moment + 1000)).toBe(false)
    expect(isTemporalInversion(moment, moment)).toBe(false)
  })
})

describe('isCausalOrderValid', () => {
  it('should be the opposite of an inversion', () => {
    const cause = new Date('2023-01-01T00:00:00Z')
    const effect = new Date('2023-01-02T00:00:00Z')
    expect(isCausalOrderValid(cause, effect)).toBe(true)
    expect(isCausalOrderValid(effect, cause)).toBe(false)
  })

  it('should be true for a simultaneous pair', () => {
    const moment = new Date('2023-01-01T00:00:00Z')
    expect(isCausalOrderValid(moment, moment)).toBe(true)
  })
})

describe('isSimultaneous', () => {
  it('should be true only for the very same moment', () => {
    const moment = new Date('2023-01-01T00:00:00Z')
    expect(isSimultaneous(moment, new Date(moment))).toBe(true)
    expect(isSimultaneous(moment, new Date(moment.getTime() + 1))).toBe(false)
  })
})

describe('the rule is applied in one place', () => {
  /**
   * Every source file under a directory, except the tests.
   */
  function sourceFiles(dir: string, found: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry)
      if (statSync(path).isDirectory()) {
        sourceFiles(path, found)
      } else if (
        (path.endsWith('.ts') || path.endsWith('.tsx')) &&
        !path.endsWith('.test.ts') &&
        !path.endsWith('.test.tsx')
      ) {
        found.push(path)
      }
    }
    return found
  }

  /**
   * Whether a file compares a cause with an effect on its own.
   *
   * The comparison is found by its operands rather than by its spelling, so
   * that `cause.timestamp.getTime() >= effect.timestamp.getTime()`,
   * `causeTime > effectTime` and `cause.timestamp < effect.timestamp` are all
   * caught -- and so is a spelling nobody has thought of yet.
   *
   * The comments and the string literals are left out: a comparison in a
   * comment is not a comparison in the code, and a comparison inside a
   * Cypher string is a different question (the cycle query compares the
   * hops of a cycle with each other, not a cause with its effect).
   */
  function comparesCauseWithEffect(text: string): boolean {
    const code = text
      // Line comments.
      .replace(/\/\/[^\n]*/g, ' ')
      // Block comments.
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      // String literals.
      .replace(/'[^'\n]*'/g, "''")
      .replace(/"[^"\n]*"/g, '""')
      .replace(/`[^`]*`/g, '``')

    // Every comparison, with the operands on either side of it.
    const operator = /(<=|>=|===|!==|<|>)/g
    let match: RegExpExecArray | null

    while ((match = operator.exec(code)) !== null) {
      const before = code.slice(Math.max(0, match.index - 160), match.index)
      const after = code.slice(match.index + match[1].length, match.index + match[1].length + 160)

      // The operand is the expression right before (or after) the operator:
      // a name, a dotted name, a call, or any of those in parentheses.
      const operand = /(\([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*\)|[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*(?:\(\))?)\s*$/
      const left = before.match(operand)?.[1] ?? ''
      const right = after.match(/^\s*(\([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*\)|[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*(?:\(\))?)/)?.[1] ?? ''

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

  it('should leave no path comparing a cause with an effect on its own', () => {
    const src = join(__dirname, '..')
    const offenders: string[] = []

    for (const file of sourceFiles(src)) {
      if (file.endsWith(join('utils', 'causalOrder.ts'))) continue

      if (comparesCauseWithEffect(readFileSync(file, 'utf8'))) {
        offenders.push(file.replace(`${src}/`, ''))
      }
    }

    expect(offenders).toEqual([])
  })

  it('should leave no path comparing a cause with an effect on its own in the frontend', () => {
    // The frontend is a separate package and cannot import the helper, so it
    // keeps its own copies of the rule. They have to be the same rule.
    const frontend = join(__dirname, '..', '..', '..', 'frontend', 'src')
    if (!existsSync(frontend)) return

    const offenders: string[] = []

    for (const file of sourceFiles(frontend)) {
      if (file.endsWith(join('utils', 'causalOrder.ts'))) continue

      if (comparesCauseWithEffect(readFileSync(file, 'utf8'))) {
        offenders.push(file.replace(`${frontend}/`, ''))
      }
    }

    expect(offenders).toEqual([])
  })
})
