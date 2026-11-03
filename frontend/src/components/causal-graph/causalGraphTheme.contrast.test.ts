// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { GRAPH_PALETTES, graphTokenName, type GraphPalette, type GraphThemeMode } from './causalGraphPresentation'

// Read the stylesheet from disk, as src/styles/tokens.contrast.test.ts does:
// Vitest blanks CSS modules, and this package has no @types/node.
type Fs = { readFileSync(path: URL, encoding: 'utf8'): string }
const nodeProcess = (globalThis as unknown as { process: { getBuiltinModule(id: 'node:fs'): Fs } }).process
const indexCss = nodeProcess.getBuiltinModule('node:fs').readFileSync(new URL('../../index.css', import.meta.url), 'utf8')

/**
 * WCAG 1.4.11 (non-text contrast) for the causal graph canvas: every colour
 * that identifies a node, a link or a state must be at least 3:1 against the
 * surfaces the graph is drawn on -- the canvas (`bg-canvas`) and the card
 * around it -- in light, dark, and the high-contrast variant of each, where
 * the bar is raised to 4.5:1. The surfaces are parsed from src/index.css, so
 * a change of surface there is measured here; a `--graph-*` token defined in
 * index.css replaces the built-in palette colour, as it does at runtime.
 */

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

function resolve(tokens: Record<string, string>, name: string): string | undefined {
  let value = tokens[name]
  for (let depth = 0; value && depth < 5; depth++) {
    const ref = /^var\((--[\w-]+)\)$/.exec(value)
    if (!ref?.[1]) return value
    value = tokens[ref[1]]
  }
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
const dark = { ...light, ...tokensOf(indexCss, 'html.dark') }
const themeTokens: Record<GraphThemeMode, Record<string, string>> = {
  light,
  dark,
  'high-contrast-light': { ...light, ...tokensOf(indexCss, 'html.high-contrast:not(.dark)') },
  'high-contrast-dark': { ...dark, ...tokensOf(indexCss, 'html.high-contrast.dark') }
}

const SURFACES = ['--surface-canvas', '--surface-card'] as const

/** Dimmed on purpose: an event that cannot be picked is inactive, which 1.4.11 exempts. */
const EXEMPT: ReadonlySet<keyof GraphPalette> = new Set(['inactiveFill', 'inactiveBorder'])

/** The colour actually drawn: a --graph-* token from index.css, else the palette's. */
function drawn(mode: GraphThemeMode, key: keyof GraphPalette): string {
  return resolve(themeTokens[mode], graphTokenName(key)) ?? GRAPH_PALETTES[mode][key]
}

describe('causal graph colours against the canvas (WCAG 1.4.11)', () => {
  for (const mode of Object.keys(GRAPH_PALETTES) as GraphThemeMode[]) {
    const floor = mode.startsWith('high-contrast') ? 4.5 : 3
    for (const surface of SURFACES) {
      it(`${mode}: every node, link and state colour is >= ${floor}:1 on ${surface}`, () => {
        const background = resolve(themeTokens[mode], surface)
        if (!background) throw new Error(`${surface} is not defined`)
        const failures: string[] = []
        for (const key of Object.keys(GRAPH_PALETTES[mode]) as (keyof GraphPalette)[]) {
          if (EXEMPT.has(key)) continue
          const colour = drawn(mode, key)
          const ratio = contrast(colour, background)
          if (ratio < floor) failures.push(`${key} ${colour} on ${background}: ${ratio.toFixed(2)}:1`)
        }
        expect(failures).toEqual([])
      })
    }
  }

  it('reuses the accent tokens where one exists, in light and dark', () => {
    for (const mode of ['light', 'dark'] as const) {
      const tokens = themeTokens[mode]
      expect(drawn(mode, 'edgeDirect'), mode).toBe(resolve(tokens, '--accent-baseline'))
      expect(drawn(mode, 'edgeSelected'), mode).toBe(resolve(tokens, '--accent-selected'))
      expect(drawn(mode, 'selectedFill'), mode).toBe(resolve(tokens, '--accent-selected'))
      expect(drawn(mode, 'edgeContributory'), mode).toBe(resolve(tokens, '--text-muted'))
    }
    // High contrast follows the muted ink there too
    for (const mode of ['high-contrast-light', 'high-contrast-dark'] as const) {
      expect(drawn(mode, 'edgeContributory'), mode).toBe(resolve(themeTokens[mode], '--text-muted'))
    }
  })

  it('tells the three link types apart by colour as well as line style', () => {
    for (const mode of Object.keys(GRAPH_PALETTES) as GraphThemeMode[]) {
      const types = (['edgeDirect', 'edgeIndirect', 'edgeContributory'] as const).map((key) => drawn(mode, key))
      expect(new Set(types).size, mode).toBe(3)
    }
  })

  it('measures the failure it replaced', () => {
    // #1d4ed8, the light theme's direct-link colour that was also drawn on the
    // dark canvas: 2.66:1, under the 3:1 floor.
    expect(contrast('#1d4ed8', resolve(dark, '--surface-canvas')!)).toBeLessThan(3)
  })
})
