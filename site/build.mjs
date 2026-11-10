#!/usr/bin/env node
/**
 * Builds the GitHub Pages site into an output directory (default `site/_site`).
 *
 *   node site/build.mjs [outDir]
 *
 * The page is hand-written (`site/src/`); this script only assembles it:
 *
 * - copies `site/src/` as is;
 * - copies the screenshots and the walkthrough video from `docs/images/` and
 *   `docs/media/`, which `media/` generates from the running app, so the site
 *   shows the same pictures as the README and never keeps its own copies;
 * - draws the hero's forking timeline from `media/src/seed/scenario.ts`, the
 *   history those pictures are taken from, and puts it in place of the
 *   `<!-- hero:timeline -->` marker in `index.html`.
 *
 * Needs Node 24 or later, which imports the TypeScript seed directly.
 */
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')
const out = resolve(process.argv[2] ?? join(here, '_site'))

const { scenario } = await import(join(root, 'media/src/seed/scenario.ts'))

rmSync(out, { recursive: true, force: true })
mkdirSync(out, { recursive: true })
cpSync(join(here, 'src'), out, { recursive: true })
cpSync(join(root, 'docs/images'), join(out, 'images'), { recursive: true })
cpSync(join(root, 'docs/media/walkthrough.mp4'), join(out, 'media/walkthrough.mp4'))
cpSync(join(root, 'frontend/public/favicon.svg'), join(out, 'favicon.svg'))
writeFileSync(join(out, '.nojekyll'), '')

const indexPath = join(out, 'index.html')
const marker = '<!-- hero:timeline -->'
const html = readFileSync(indexPath, 'utf8')
if (!html.includes(marker)) throw new Error(`index.html has no ${marker} marker`)
writeFileSync(indexPath, html.replace(marker, heroTimeline(scenario)))

console.log(`site built in ${out}`)

/* ------------------------------------------------------------------------ */

/**
 * The forking timeline: the baseline history with its periods above, causal
 * links arching over the events, and the branch dropping away at the moment it
 * diverges. x is time throughout; nothing is placed for looks.
 */
function heroTimeline(s) {
  const W = 1200
  const H = 400
  const pad = 48
  const from = 1833
  const to = 1872
  const baseY = 215
  const laneY = 318

  const year = (iso) => {
    const d = new Date(iso)
    const start = Date.UTC(d.getUTCFullYear(), 0, 1)
    const next = Date.UTC(d.getUTCFullYear() + 1, 0, 1)
    return d.getUTCFullYear() + (d.getTime() - start) / (next - start)
  }
  const x = (iso) => pad + ((year(iso) - from) / (to - from)) * (W - 2 * pad)
  const xYear = (y) => pad + ((y - from) / (to - from)) * (W - 2 * pad)
  const f = (n) => Math.round(n * 10) / 10
  const esc = (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const fmt = (iso) =>
    new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
  const delay = (px) => `${f(0.15 + ((px - pad) / (W - 2 * pad)) * 1.1)}s`

  const events = new Map(s.events.map((e) => [e.key, e]))
  const branchEvents = s.branch.events
  const split = branchEvents[0]
  const xs = x(split.timestamp)
  const xEnd = W - pad

  // The branch eases from the baseline down to its own lane; y as a function of
  // x keeps every branch event at its true date while sitting on the line.
  const drop = 26
  const branchY = (px) => {
    const t = Math.min(1, Math.max(0, (px - xs) / drop))
    return baseY + (laneY - baseY) * t * t * (3 - 2 * t)
  }

  const parts = []

  // Periods (arcs, in the domain sense), nested by level.
  for (const a of s.arcs) {
    const y = a.level === 1 ? 30 : 62
    const x1 = x(a.start)
    const x2 = Math.min(x(a.end), xEnd)
    parts.push(
      `<g class="ht-period"><rect x="${f(x1)}" y="${y}" width="${f(x2 - x1 - 3)}" height="7" rx="1.5"/>` +
        `<text x="${f(x1)}" y="${y - 6}">${esc(a.name)}</text></g>`,
    )
  }

  // Causal links, arching over the baseline; height grows with the span.
  const links = []
  for (const l of s.links) {
    const c = events.get(l.cause)
    const e = events.get(l.effect)
    if (!c || !e) continue
    const x1 = x(c.timestamp)
    const x2 = x(e.timestamp)
    const h = Math.min(116, 14 + Math.abs(x2 - x1) * 0.42) * 1.33
    links.push(
      `<path class="ht-link ht-${l.type}" style="--d:${delay(x1)};opacity:${f(0.25 + l.confidence * 0.55)}" ` +
        `stroke-width="${f(0.7 + l.weight * 1.5)}" d="M${f(x1)} ${baseY}C${f(x1)} ${f(baseY - h)} ${f(x2)} ${f(baseY - h)} ${f(x2)} ${baseY}"/>`,
    )
  }
  parts.push(`<g class="ht-links">${links.join('')}</g>`)

  // The baseline.
  parts.push(`<path class="ht-base" pathLength="1" d="M${pad} ${baseY}H${xEnd}"/>`)

  // The branch: drawn as a sampled curve, then an open, dashed future.
  const lastBranchX = x(branchEvents[branchEvents.length - 1].timestamp)
  const solidTo = Math.max(lastBranchX + 24, xs + drop + 8)
  const pts = []
  for (let px = xs; px <= solidTo; px += 2) pts.push(`${f(px)} ${f(branchY(px))}`)
  parts.push(`<path class="ht-branch" pathLength="1" d="M${pts.join('L')}"/>`)
  parts.push(`<path class="ht-branch-open" d="M${f(solidTo)} ${laneY}H${xEnd}"/>`)

  // Events on the baseline, sized by significance.
  const dots = []
  for (const e of s.events) {
    const px = x(e.timestamp)
    const r = 2.5 + (e.significance ?? 0.5) * 4.5
    dots.push(
      `<circle class="ht-event" style="--d:${delay(px)}" cx="${f(px)}" cy="${baseY}" r="${f(r)}">` +
        `<title>${fmt(e.timestamp)}: ${esc(e.description)}</title></circle>`,
    )
  }
  for (const e of branchEvents.slice(1)) {
    const px = x(e.timestamp)
    const r = 2.5 + (e.significance ?? 0.5) * 4.5
    dots.push(
      `<circle class="ht-event ht-on-branch" cx="${f(px)}" cy="${f(branchY(px))}" r="${f(r)}">` +
        `<title>${fmt(e.timestamp)}: ${esc(e.description)}</title></circle>`,
    )
  }
  parts.push(`<g>${dots.join('')}</g>`)

  // The divergence: the branch's first event, at the moment the branch splits.
  const dm = 8
  parts.push(
    `<path class="ht-diverge" d="M${f(xs)} ${baseY - dm}L${f(xs + dm)} ${baseY}L${f(xs)} ${baseY + dm}L${f(xs - dm)} ${baseY}Z">` +
      `<title>Diverges ${fmt(split.timestamp)}: ${esc(split.description)}</title></path>`,
  )

  // Labels: the two lanes, and the events that tell the story of the fork.
  const label = (px, y, iso, text, cls = '') =>
    `<text class="ht-label ${cls}" x="${f(px)}" y="${y}"><tspan class="ht-date">${new Date(iso).getUTCFullYear()}</tspan> ${esc(text)}</text>`
  const first = events.get('firstrun')
  const act = events.get('act')
  parts.push(`<g class="ht-labels">`)
  parts.push(`<text class="ht-lane" x="${pad}" y="${baseY + 38}">${esc(s.graph.name)}</text>`)
  if (first) {
    const px = x(first.timestamp)
    parts.push(`<path class="ht-leader" d="M${f(px)} ${baseY + 10}V${baseY + 26}"/>`)
    parts.push(label(px - 4, baseY + 40, first.timestamp, first.description))
  }
  if (act) parts.push(label(xs + 40, baseY + 38, act.timestamp, act.description))
  const branchName = s.branch.name.split('—').pop().trim()
  parts.push(`<text class="ht-lane ht-lane-branch" x="${f(xs + 40)}" y="${laneY - 14}">${esc(branchName)}</text>`)
  branchEvents.forEach((e, i) => {
    parts.push(label(xs + 40, laneY + 28 + i * 21, e.timestamp, e.description, 'ht-label-branch'))
  })
  parts.push(`</g>`)

  // Axis.
  const ticks = []
  for (let y = 1835; y <= 1870; y += 5) {
    const px = xYear(y)
    ticks.push(`<path d="M${f(px)} ${H - 26}v6"/><text x="${f(px)}" y="${H - 6}">${y}</text>`)
  }
  parts.push(`<g class="ht-axis"><path d="M${pad} ${H - 26}H${xEnd}"/>${ticks.join('')}</g>`)

  const desc =
    `${s.graph.name}: ${s.events.length} events from ${new Date(s.events[0].timestamp).getUTCFullYear()} to ` +
    `${new Date(s.events[s.events.length - 1].timestamp).getUTCFullYear()}, joined by ${s.links.length} causal links. ` +
    `On ${fmt(split.timestamp)} a branch, ${branchName}, splits away: ${split.description.toLowerCase()} ` +
    `instead of ${act ? act.description.charAt(0).toLowerCase() + act.description.slice(1) : 'the original outcome'}.`

  return (
    `<svg class="hero-timeline" viewBox="0 0 ${W} ${H}" role="img" aria-labelledby="ht-title ht-desc" data-fork-x="${f(xs / W)}">` +
    `<title id="ht-title">A history that forks</title><desc id="ht-desc">${esc(desc)}</desc>` +
    parts.join('') +
    `</svg>`
  )
}
