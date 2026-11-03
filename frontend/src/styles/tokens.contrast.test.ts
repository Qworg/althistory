// @vitest-environment node
import { describe, it, expect } from 'vitest'

// Read the stylesheet from disk: Vitest blanks CSS modules, `?raw` included,
// and this package has no @types/node, hence the narrow typed handle on fs.
type Fs = { readFileSync(path: URL, encoding: 'utf8'): string }
const nodeProcess = (globalThis as unknown as { process: { getBuiltinModule(id: 'node:fs'): Fs } }).process
const indexCss = nodeProcess.getBuiltinModule('node:fs').readFileSync(new URL('../index.css', import.meta.url), 'utf8')

/**
 * WCAG contrast of the ink tokens in src/index.css against every surface they
 * sit on, in both themes. The tokens are parsed from the stylesheet itself, so
 * editing a colour there is what this test measures -- there is no second copy
 * of the palette to keep in sync.
 *
 * It checks the token seam only: a component that writes a raw colour
 * (a raw gray text or placeholder utility) is outside what this covers.
 */

/** The custom properties declared directly inside the first `selector {` block. */
function tokensOf(css: string, selector: string): Record<string, string> {
  const start = css.indexOf(`${selector} {`)
  if (start === -1) throw new Error(`no "${selector} {" block in index.css`)
  const end = css.indexOf('\n}', start)
  const body = css.slice(start, end).replace(/\/\*[\s\S]*?\*\//g, '')
  const tokens: Record<string, string> = {}
  for (const match of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    const [, name, value] = match
    if (name && value) tokens[name] = value.trim()
  }
  return tokens
}

/** Resolve `var(--x)` chains to a literal value. */
function resolve(tokens: Record<string, string>, name: string): string {
  let value = tokens[name]
  for (let depth = 0; value && depth < 5; depth++) {
    const ref = /^var\((--[\w-]+)\)$/.exec(value)
    if (!ref?.[1]) return value
    value = tokens[ref[1]]
  }
  if (!value) throw new Error(`${name} is not defined`)
  return value
}

function luminance(hex: string): number {
  const match = /^#([0-9a-f]{6})$/i.exec(hex)
  if (!match?.[1]) throw new Error(`expected a #rrggbb colour, got "${hex}"`)
  const digits = match[1]
  const [r, g, b] = [0, 2, 4].map((i) => {
    const c = parseInt(digits.slice(i, i + 2), 16) / 255
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }) as [number, number, number]
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number]
  return (hi + 0.05) / (lo + 0.05)
}

const light = tokensOf(indexCss, ':root')
const themes = {
  light,
  dark: { ...light, ...tokensOf(indexCss, 'html.dark') },
}

const SURFACES = ['--surface-canvas', '--surface-card', '--surface-subtle'] as const
const INKS = ['--text-primary', '--text-secondary', '--text-muted', '--text-placeholder'] as const

describe('ink token contrast (WCAG AA, 4.5:1 for body text)', () => {
  for (const [theme, tokens] of Object.entries(themes)) {
    for (const ink of INKS) {
      for (const surface of SURFACES) {
        it(`${theme}: ${ink} on ${surface}`, () => {
          const ratio = contrast(resolve(tokens, ink), resolve(tokens, surface))
          expect(ratio, `${resolve(tokens, ink)} on ${resolve(tokens, surface)}`).toBeGreaterThanOrEqual(4.5)
        })
      }
    }

    it(`${theme}: muted ink stays a distinct step below secondary`, () => {
      // Muted must read as quieter than secondary, or the two tokens collapse.
      const step = contrast(resolve(tokens, '--text-secondary'), resolve(tokens, '--text-muted'))
      expect(step).toBeGreaterThanOrEqual(1.3)
    })
  }

  it('measures the known failure it replaced', () => {
    // #64748b, the previous light --text-muted, on the subtle surface: 4.14:1.
    expect(contrast('#64748b', '#f1efe9')).toBeLessThan(4.5)
  })
})

// The accents draw marks, lines and rings (the divergence line and diamond,
// baseline marks, the selection ring): non-text graphics, which need 3:1
// against every surface they sit on (WCAG 1.4.11).
const ACCENTS = ['--accent-baseline', '--accent-divergence', '--accent-selected'] as const

describe('accent token contrast (WCAG 1.4.11, 3:1 for graphics)', () => {
  for (const [theme, tokens] of Object.entries(themes)) {
    for (const accent of ACCENTS) {
      for (const surface of SURFACES) {
        it(`${theme}: ${accent} on ${surface}`, () => {
          const ratio = contrast(resolve(tokens, accent), resolve(tokens, surface))
          expect(ratio, `${resolve(tokens, accent)} on ${resolve(tokens, surface)}`).toBeGreaterThanOrEqual(3)
        })
      }
    }
  }
})
