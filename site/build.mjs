#!/usr/bin/env node
/**
 * Builds the GitHub Pages site into an output directory (default `site/_site`).
 *
 *   node site/build.mjs [outDir] [--demo <dir>]
 *
 * The page is hand-written (`site/src/`); this script only assembles it:
 *
 * - copies `site/src/` as is;
 * - copies the screenshots and the walkthrough video from `docs/images/` and
 *   `docs/media/`, which `media/` generates from the running app, so the site
 *   shows the same pictures as the README and never keeps its own copies;
 * - draws the hero's forking timeline from `media/src/seed/scenario.ts`, the
 *   history those pictures are taken from, and puts it in place of the
 *   `<!-- hero:timeline -->` marker in `index.html` and in `social.html`, the
 *   1280×640 social preview card (`npm run social` in media/ screenshots it),
 *   and a screen-reader list of the same events in place of
 *   `<!-- hero:events -->`;
 * - draws the four feature "moments" in place of `<!-- moment:name -->`, in
 *   the hero's cyanotype style and from the same seed: a traced chain, a
 *   causal path, a branch beside its original, and a review table. Their
 *   text is HTML, so it reads at every width;
 * - with `--demo <dir>`, copies the in-browser demo (frontend
 *   `npm run build:demo`, output `frontend/dist-demo`) to `demo/`. Without it
 *   the page's "Try it" links have nothing to open, so CI always passes it.
 *
 * Needs Node 24 or later, which imports the TypeScript seed directly.
 */
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')
const args = process.argv.slice(2)
const demoFlag = args.indexOf('--demo')
const demo = demoFlag >= 0 ? resolve(args[demoFlag + 1] ?? '') : undefined
if (demoFlag >= 0) args.splice(demoFlag, 2)
const out = resolve(args[0] ?? join(here, '_site'))

const { scenario } = await import(join(root, 'media/src/seed/scenario.ts'))

rmSync(out, { recursive: true, force: true })
mkdirSync(out, { recursive: true })
cpSync(join(here, 'src'), out, { recursive: true })
cpSync(join(root, 'docs/images'), join(out, 'images'), { recursive: true })
cpSync(join(root, 'docs/media/walkthrough.mp4'), join(out, 'media/walkthrough.mp4'))
cpSync(join(root, 'docs/media/walkthrough.vtt'), join(out, 'media/walkthrough.vtt'))
cpSync(join(root, 'frontend/public/favicon.svg'), join(out, 'favicon.svg'))
writeFileSync(join(out, '.nojekyll'), '')
if (demo) {
  if (!existsSync(join(demo, 'index.html'))) throw new Error(`${demo} has no index.html; run npm run build:demo in frontend/`)
  cpSync(demo, join(out, 'demo'), { recursive: true })
} else {
  console.warn('no --demo given: the page links to demo/, which this build does not include')
}

// The page and the social card (social.html) both carry the timeline.
const marker = '<!-- hero:timeline -->'
// The demo's own event ids, so a hero card can open the demo on its event.
const recording = JSON.parse(readFileSync(join(root, 'frontend/src/demo/recording.json'), 'utf8'))
const demoIds = (graphId) =>
  new Map((recording.entities[graphId]?.events ?? []).map((e) => [e.description, e.id]))
const demoEventIds = { main: demoIds(recording.mainGraphId), branch: demoIds(recording.branchGraphId) }
for (const page of ['index.html', 'social.html', 'agents.html']) {
  const pagePath = join(out, page)
  let html = readFileSync(pagePath, 'utf8')
  if (page !== 'agents.html' && !html.includes(marker)) throw new Error(`${page} has no ${marker} marker`)
  html = html.replace(marker, () => heroTimeline(scenario)).replace('<!-- hero:events -->', () => heroEventList(scenario))
  html = html.replace(/<!-- moment:([a-z]+) -->/g, (_, name) => moment(name, scenario))
  writeFileSync(pagePath, html)
}

console.log(`site built in ${out}`)

/* ------------------------------------------------------------------------ */

/** The hero's events as a list, for screen readers (the drawing is one image). */
function heroEventList(s) {
  const fmt = (iso) =>
    new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
  const esc = (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const branchName = s.branch.name.split('—').pop().trim()
  const item = (e) => `<li>${fmt(e.timestamp)}: ${esc(e.description)} (${esc(e.actor)}, ${esc(e.target)})</li>`
  return (
    `<div class="sr-only"><h2>The events in ${esc(s.graph.name)}</h2><ol>${s.events.map(item).join('')}</ol>` +
    `<h3>In the branch ${esc(branchName)}</h3><ol>${s.branch.events.map(item).join('')}</ol></div>`
  )
}

/**
 * The forking timeline: the baseline history with its periods above, causal
 * links arching over the events, and the branch dropping away at the moment it
 * diverges. x is time throughout; the one exception is that events closer
 * than their marks are spread just far enough apart to tell apart (a few
 * weeks at this scale), and their links follow them.
 *
 * Each event carries its date, description and actors as data attributes;
 * site/src/main.js shows them on hover, tap or arrow key.
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
  const branchName = s.branch.name.split('—').pop().trim()
  const xs = x(split.timestamp)
  const xEnd = W - pad

  // The branch eases from the baseline down to its own lane; y as a function of
  // x keeps every branch event at its true date while sitting on the line.
  const drop = 26
  const branchY = (px) => {
    const t = Math.min(1, Math.max(0, (px - xs) / drop))
    return baseY + (laneY - baseY) * t * t * (3 - 2 * t)
  }

  // Where each baseline event is drawn. Events closer than their marks (the
  // census and the Great Exhibition, five weeks apart) are spread around their
  // centre just far enough to tell apart: a few weeks at this scale.
  const radius = (e) => 2.5 + (e.significance ?? 0.5) * 4.5
  const placed = s.events
    .map((e) => ({ key: e.key, x: x(e.timestamp), r: radius(e) }))
    .sort((a, b) => a.x - b.x)
  for (let pass = 0; pass < 6; pass++) {
    let moved = false
    for (let i = 0; i < placed.length; ) {
      let j = i
      while (j + 1 < placed.length && placed[j + 1].x - placed[j].x < placed[j].r + placed[j + 1].r + 2) j++
      if (j > i) {
        const group = placed.slice(i, j + 1)
        const offsets = [0]
        for (let k = 1; k < group.length; k++) offsets.push(offsets[k - 1] + group[k - 1].r + group[k].r + 2)
        const shift = group.reduce((t, g) => t + g.x, 0) / group.length - offsets.reduce((t, o) => t + o, 0) / group.length
        group.forEach((g, k) => (g.x = offsets[k] + shift))
        moved = true
      }
      i = j + 1
    }
    if (!moved) break
  }
  const at = new Map(placed.map((p) => [p.key, p.x]))
  const px = (key) => at.get(key)

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
    if (!events.has(l.cause) || !events.has(l.effect)) continue
    const x1 = px(l.cause)
    const x2 = px(l.effect)
    const h = Math.min(116, 14 + Math.abs(x2 - x1) * 0.42) * 1.33
    links.push(
      `<path class="ht-link ht-${l.type}" data-from="${l.cause}" data-to="${l.effect}" style="--d:${delay(x1)};opacity:${f(0.25 + l.confidence * 0.55)}" ` +
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
  for (let p = xs; p <= solidTo; p += 2) pts.push(`${f(p)} ${f(branchY(p))}`)
  parts.push(`<path class="ht-branch" pathLength="1" d="M${pts.join('L')}"/>`)
  parts.push(`<path class="ht-branch-open" d="M${f(solidTo)} ${laneY}H${xEnd}"/>`)

  // Every event, in date order, with what main.js shows when it is selected.
  const who = (e) => `${e.actor} → ${e.target}`
  const marks = [
    ...s.events.map((e) => ({ e, cx: px(e.key), cy: baseY, r: radius(e), branch: false })),
    ...branchEvents.slice(1).map((e) => ({ e, cx: x(e.timestamp), cy: branchY(x(e.timestamp)), r: radius(e), branch: true })),
  ]
  // The divergence: the branch's first event, drawn where the branch has
  // just left the baseline, so it reads as the branch's and never sits on
  // the original history's events of the same weeks.
  const dm = 8
  let dx = xs
  while (branchY(dx) < baseY + 17 && dx < xs + drop) dx += 0.5
  const dy = branchY(dx)
  marks.push({ e: split, cx: dx, cy: dy, r: dm, branch: true, diverge: true })
  marks.sort((a, b) => a.e.timestamp.localeCompare(b.e.timestamp))
  // Each lane counts its own events: "4 of 19" in the history, "Branch, 1 of
  // 2" in the branch. Selecting one offers to open its history in the demo.
  const baseCount = marks.filter((m) => !m.branch).length
  const branchCount = marks.length - baseCount
  let nBase = 0
  let nBranch = 0
  for (const m of marks) {
    m.pos = m.branch ? `Branch, ${++nBranch} of ${branchCount}` : `${++nBase} of ${baseCount}`
  }

  const dots = []
  for (const m of marks) {
    if (m.diverge) continue
    const cls = m.branch ? 'ht-event ht-on-branch' : 'ht-event'
    const style = m.branch ? '' : ` style="--d:${delay(m.cx)}"`
    dots.push(`<circle class="${cls}"${style} data-key="${m.e.key}" cx="${f(m.cx)}" cy="${f(m.cy)}" r="${f(m.r)}"/>`)
  }
  parts.push(`<g>${dots.join('')}</g>`)
  parts.push(
    `<path class="ht-diverge" d="M${f(dx)} ${f(dy - dm)}L${f(dx + dm)} ${f(dy)}L${f(dx)} ${f(dy + dm)}L${f(dx - dm)} ${f(dy)}Z"/>`,
  )

  // The selection ring, and generous hit areas (a dot is a few pixels wide)
  // carrying each event's text for main.js.
  parts.push(`<circle class="ht-ring" cx="-40" cy="-40" r="11"/>`)
  parts.push(
    `<g class="ht-hits">` +
      marks
        .map(
          (m, i) =>
            `<circle class="ht-hit" cx="${f(m.cx)}" cy="${f(m.cy)}" r="${f(Math.max(12, m.r + 5))}" data-i="${i}" data-key="${m.e.key}"` +
            ` data-date="${fmt(m.e.timestamp)}" data-text="${esc(m.e.description)}" data-who="${esc(who(m.e))}"` +
            ` data-pos="${m.pos}" data-graph="${esc(m.branch ? branchName : s.graph.name)}"` +
            ` data-start="${m.branch ? 'branch' : 'main'}"` +
            ` data-event="${esc(demoEventIds[m.branch ? 'branch' : 'main'].get(m.e.description) ?? '')}"` +
            `${m.branch ? ' data-branch=""' : ''}/>`,
        )
        .join('') +
      `</g>`,
  )

  // Labels: the two lanes, and the events that tell the story of the fork.
  // The branch's own labels wait for the branch to be drawn.
  const label = (lx, y, iso, text, cls = '', note = '') =>
    `<text class="ht-label ${cls}" x="${f(lx)}" y="${y}"><tspan class="ht-date">${new Date(iso).getUTCFullYear()}</tspan> ` +
    `${note ? `<tspan class="ht-note">${esc(note)}</tspan> ` : ''}${esc(text)}</text>`
  const first = events.get('firstrun')
  const act = events.get('act')
  parts.push(`<g class="ht-labels">`)
  parts.push(`<text class="ht-lane" x="${pad}" y="${baseY + 38}">${esc(s.graph.name)}</text>`)
  if (first) {
    const fx = px('firstrun')
    parts.push(`<path class="ht-leader ht-first" d="M${f(fx)} ${baseY + 10}V${baseY + 26}"/>`)
    parts.push(label(fx - 4, baseY + 40, first.timestamp, first.description, 'ht-first'))
  }
  // The original history's answer to the same question the branch answers
  // below it, worded so the two read as a pair and the label cannot be taken
  // for the branch's: it sits right of the fork, over the branch.
  if (act) parts.push(label(xs + 40, baseY + 38, act.timestamp, 'Parliament licenses the engines', '', 'Original:'))
  parts.push(`</g>`)
  parts.push(`<g class="ht-labels ht-labels-branch">`)
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
    `On ${fmt(split.timestamp)} a branch, ${branchName}, splits away. In it, “${split.description}”` +
    (act ? `, where the original history has “${act.description}”.` : '.')

  return (
    `<svg class="hero-timeline" viewBox="0 0 ${W} ${H}" role="img" aria-labelledby="ht-title ht-desc" data-fork-x="${f(xs / W)}">` +
    `<title id="ht-title">A history that forks</title><desc id="ht-desc">${esc(desc)}</desc>` +
    parts.join('') +
    `</svg>`
  )
}

/* --------------------------------------------------------------- moments --- */

/**
 * The feature moments: small drawings of what each feature does, from the
 * seed, in the hero's cyanotype. Lines and marks are SVG; anything to be read
 * is HTML beside or under it, so nothing shrinks to illegibility on a phone.
 */
function moment(name, s) {
  const draw = { trace: momentTrace, path: momentPath, branch: momentBranch, review: momentReview }[name]
  if (!draw) throw new Error(`No moment called "${name}"`)
  return draw(s)
}

// Function declarations, not consts: the page loop above runs before the
// rest of the module is evaluated, and only declarations are hoisted.
function escHtml(t) {
  return String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
function yearOf(iso) {
  const d = new Date(iso)
  const start = Date.UTC(d.getUTCFullYear(), 0, 1)
  return d.getUTCFullYear() + (d.getTime() - start) / (Date.UTC(d.getUTCFullYear() + 1, 0, 1) - start)
}
function longDate(iso) {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
}
function r1(n) {
  return Math.round(n * 10) / 10
}

/** Everything an event led to, following the links forward. */
function downstreamOf(s, key) {
  const seen = new Set()
  const queue = [key]
  while (queue.length) {
    const from = queue.shift()
    for (const l of s.links) {
      if (l.cause === from && !seen.has(l.effect)) {
        seen.add(l.effect)
        queue.push(l.effect)
      }
    }
  }
  return seen
}

/** See it in time: Note G selected, and everything it led to still lit. */
function momentTrace(s) {
  const key = 'noteg'
  const picked = s.events.find((e) => e.key === key)
  const lit = downstreamOf(s, key)
  const W = 480
  const H = 150
  const base = 112
  const from = yearOf(s.events[0].timestamp) - 1
  const to = yearOf(s.events[s.events.length - 1].timestamp) + 1
  const x = (iso) => 14 + ((yearOf(iso) - from) / (to - from)) * (W - 28)
  const at = new Map(s.events.map((e) => [e.key, x(e.timestamp)]))
  const links = s.links
    .map((l) => {
      const x1 = at.get(l.cause)
      const x2 = at.get(l.effect)
      if (x1 === undefined || x2 === undefined) return ''
      const on = (l.cause === key || lit.has(l.cause)) && lit.has(l.effect)
      const h = Math.min(92, 10 + Math.abs(x2 - x1) * 0.5)
      return `<path class="mt-link ht-${l.type}${on ? ' is-lit' : ''}" d="M${r1(x1)} ${base}C${r1(x1)} ${r1(base - h * 1.33)} ${r1(x2)} ${r1(base - h * 1.33)} ${r1(x2)} ${base}"/>`
    })
    .join('')
  const dots = s.events
    .map((e) => {
      const cls = e.key === key ? 'mt-dot is-picked' : lit.has(e.key) ? 'mt-dot is-lit' : 'mt-dot'
      return `<circle class="${cls}" cx="${r1(at.get(e.key))}" cy="${base}" r="${e.key === key ? 6.5 : 4.5}"/>`
    })
    .join('')
  const ring = `<circle class="mt-ring" cx="${r1(at.get(key))}" cy="${base}" r="11"/>`
  return (
    `<figure class="moment moment-trace">` +
    `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${escHtml(`The Engine Age with ${picked.description} selected: the ${lit.size} later events it led to stay lit, the rest fade.`)}">` +
    `<path class="mt-base" d="M8 ${base}H${W - 8}"/>${links}${dots}${ring}</svg>` +
    `<div class="m-axis" aria-hidden="true"><span>${new Date(s.events[0].timestamp).getUTCFullYear()}</span><span>${new Date(s.events[s.events.length - 1].timestamp).getUTCFullYear()}</span></div>` +
    `<figcaption><span class="m-date">${longDate(picked.timestamp)}</span> ${escHtml(picked.description)}. <strong>Led to ${lit.size} later events</strong>; everything else falls back.</figcaption>` +
    `</figure>`
  )
}

/** Follow the causes: one path from 1834 to 1859, each link typed and weighted. */
function momentPath(s) {
  const keys = ['design', 'noteg', 'firstrun', 'admiralty', 'census', 'clerks']
  const events = new Map(s.events.map((e) => [e.key, e]))
  const steps = keys.map((key, i) => {
    const e = events.get(key)
    if (!e) throw new Error(`momentPath: the seed has no event "${key}"`)
    const next = keys[i + 1]
    const link = next ? s.links.find((l) => l.cause === key && l.effect === next) : undefined
    if (next && !link) throw new Error(`momentPath: the seed has no link ${key} → ${next}`)
    return { e, link }
  })
  const items = steps
    .map(
      ({ e, link }) =>
        `<li><span class="m-date">${new Date(e.timestamp).getUTCFullYear()}</span> ${escHtml(e.description)}` +
        (link
          ? `<span class="mp-link mp-${link.type}" style="--w:${r1(1 + link.weight * 3)}px">${link.type}, weight ${link.weight}</span>`
          : '') +
        `</li>`
    )
    .join('')
  return (
    `<figure class="moment moment-path"><ol class="mp-chain">${items}</ol>` +
    `<figcaption>One path through the graph, ${steps.length - 1} links long. The line says how one event led to the next: solid is direct, dashed indirect, dotted contributory, and thicker is stronger.</figcaption></figure>`
  )
}

/** Change one thing: the branch, with its original ghosted beneath. */
function momentBranch(s) {
  const W = 480
  const H = 170
  const branchY = 62
  const ghostY = 128
  const from = 1854
  const to = 1870
  const x = (iso) => 20 + ((yearOf(iso) - from) / (to - from)) * (W - 40)
  const split = s.branch.events[0]
  const xs = x(split.timestamp)
  const shown = s.events.filter((e) => yearOf(e.timestamp) >= from && yearOf(e.timestamp) <= to)
  const dot = (e, y, cls, r = 5) => `<circle class="${cls}" cx="${r1(x(e.timestamp))}" cy="${y}" r="${r}"/>`
  const ghost = shown.map((e) => dot(e, ghostY, 'mb-ghost', 4)).join('')
  const shared = shown.map((e) => dot(e, branchY, 'mb-shared')).join('')
  const own = s.branch.events.slice(1).map((e) => dot(e, branchY, 'mb-own', 5.5)).join('')
  const dm = 7
  const diamond = `<path class="mb-diverge" d="M${r1(xs)} ${branchY - dm}L${r1(xs + dm)} ${branchY}L${r1(xs)} ${branchY + dm}L${r1(xs - dm)} ${branchY}Z"/>`
  const branchName = s.branch.name.split('—').pop().trim()
  return (
    `<figure class="moment moment-branch">` +
    `<div class="mb-stage">` +
    `<span class="mb-lane mb-lane-branch" style="top:${r1((branchY / H) * 100)}%">${escHtml(branchName)}</span>` +
    `<span class="mb-lane mb-lane-ghost" style="top:${r1((ghostY / H) * 100)}%">${escHtml(s.graph.name)}, the original</span>` +
    `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${escHtml(`${branchName} drawn over the original history, which shows faintly beneath; they part on ${longDate(split.timestamp)}.`)}">` +
    `<path class="mb-split" d="M${r1(xs)} 10V${H - 8}"/>` +
    `<path class="mb-line-ghost" d="M12 ${ghostY}H${W - 12}"/><path class="mb-line" d="M12 ${branchY}H${W - 12}"/>` +
    `${ghost}${shared}${own}${diamond}</svg></div>` +
    `<div class="m-axis" aria-hidden="true"><span>${from}</span><span>${to}</span></div>` +
    `<figcaption>They part on <span class="m-date">${longDate(split.timestamp)}</span>, when ${escHtml(split.description)}. The branch's own events are amber.</figcaption>` +
    `</figure>`
  )
}

/**
 * Bring in history: the review step for the walkthrough's example text (the
 * same three sentences media/src/capture/tour.ts pastes into the app).
 */
function reviewRows() {
  return [
  { text: 'The Royal Society honoured Ada Lovelace with the Copley Medal', who: 'Royal Society → Ada Lovelace', date: '1870-02-14', confidence: 0.9 },
  { text: 'The Admiralty launched HMS Calculator', who: 'Admiralty → Calculator', date: '1871-03-01', confidence: 0.8 },
  { text: 'The Prussian General Staff founded a programming academy in Berlin', who: 'Prussian General Staff → Berlin', date: '1872-06-02', confidence: 0.9 },
  ]
}

function momentReview() {
  const check = '<svg class="mr-check" viewBox="0 0 16 16" aria-hidden="true"><rect x="1.5" y="1.5" width="13" height="13" rx="3"/><path d="M4.5 8.2l2.3 2.3 4.7-5"/></svg>'
  const REVIEW_ROWS = reviewRows()
  const rows = REVIEW_ROWS.map(
    (r) =>
      `<tr><td>${check}</td><td><span class="mr-text">${escHtml(r.text)}</span><span class="mr-who">${escHtml(r.who)}</span></td>` +
      `<td class="m-date">${r.date}</td><td class="mr-conf">${r.confidence.toFixed(1)}</td></tr>`
  ).join('')
  return (
    `<figure class="moment moment-review"><table class="mr-table">` +
    `<caption>Review: ${REVIEW_ROWS.length} of ${REVIEW_ROWS.length} events kept</caption>` +
    `<thead><tr><th scope="col"><span class="sr-only">Keep</span></th><th scope="col">Event</th><th scope="col">Date</th><th scope="col">Confidence</th></tr></thead>` +
    `<tbody>${rows}</tbody></table>` +
    `<figcaption>Three sentences of pasted text, read into events. Nothing is written until you keep them.</figcaption></figure>`
  )
}
