// @vitest-environment node
import { describe, it, expect } from 'vitest'

// Read source from disk: Vitest blanks CSS modules, `?raw` included, and this
// package has no @types/node, hence the narrow typed handle on fs.
type Dirent = { name: string; isDirectory(): boolean }
type Fs = {
  readFileSync(path: URL, encoding: 'utf8'): string
  readdirSync(path: URL, options: { withFileTypes: true }): Dirent[]
}
const fs = (globalThis as unknown as { process: { getBuiltinModule(id: 'node:fs'): Fs } }).process.getBuiltinModule('node:fs')
const srcRoot = new URL('../', import.meta.url)
const indexCss = fs.readFileSync(new URL('index.css', srcRoot), 'utf8')

function sourceFiles(dir: URL, out: { path: string; text: string }[] = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const url = new URL(entry.isDirectory() ? `${entry.name}/` : entry.name, dir)
    if (entry.isDirectory()) sourceFiles(url, out)
    else if (/\.tsx$/.test(entry.name) && !/\.test\.tsx$/.test(entry.name)) {
      out.push({ path: url.pathname.slice(srcRoot.pathname.length), text: fs.readFileSync(url, 'utf8') })
    }
  }
  return out
}

/** The CSS text with every `@layer … { … }` block removed (brace-matched). */
function unlayered(css: string): string {
  let out = ''
  let i = 0
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '')
  while (i < stripped.length) {
    const at = stripped.indexOf('@layer', i)
    if (at === -1) return out + stripped.slice(i)
    out += stripped.slice(i, at)
    const open = stripped.indexOf('{', at)
    const semi = stripped.indexOf(';', at)
    if (open === -1 || (semi !== -1 && semi < open)) { i = semi + 1; continue } // `@layer a, b;`
    let depth = 0
    let j = open
    for (; j < stripped.length; j++) {
      if (stripped[j] === '{') depth++
      else if (stripped[j] === '}' && --depth === 0) break
    }
    i = j + 1
  }
  return out
}

/**
 * One focus indicator per control. The global outline used to be unlayered,
 * so it outranked `focus:outline-none` and a control with its own ring drew
 * both. In the base layer the utilities win; a control that switches the
 * outline off must then draw something else, or keyboard focus vanishes.
 */
describe('focus indicators', () => {
  it('keeps the global focus outline in a layer, where utilities can replace it', () => {
    expect(indexCss).toMatch(/\*:focus-visible\s*\{/)
    expect(unlayered(indexCss)).not.toMatch(/:focus(-visible)?[^{]*\{/)
  })

  it('gives every control that turns the outline off another indicator', () => {
    // A focus-time ring, border, background, shadow or underline replaces it;
    // programmatic focus targets (tabIndex -1 panels, a menu that focuses its
    // items) show no indicator by design.
    const replacement = /focus(-visible|-within)?:(ring|border|bg|shadow|underline)|tabIndex=\{-1\}|role="menu"/
    const bare: string[] = []
    for (const { path, text } of sourceFiles(srcRoot)) {
      for (const match of text.matchAll(/(?:focus:)?outline-none/g)) {
        const at = match.index ?? 0
        // The opening tag that carries the class: from its `<` to the next tag.
        const start = text.slice(0, at).search(/<[A-Za-z][\w.]*(?![\s\S]*<[A-Za-z])/)
        const nextTag = text.slice(at).search(/<[A-Za-z/]/)
        const tag = text.slice(Math.max(0, start), nextTag === -1 ? undefined : at + nextTag)
        if (!replacement.test(tag)) bare.push(`${path}:${text.slice(0, at).split('\n').length}`)
      }
    }
    expect(bare).toEqual([])
  })
})
