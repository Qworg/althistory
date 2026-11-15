/**
 * Records the real API's answers for the in-browser demo (frontend/src/demo).
 *
 *   npm run demo:record                 build, seed, walk the app, write the recording
 *   npm run demo:record -- --skip-build reuse the last backend/frontend build
 *
 * The demo on GitHub Pages has no backend. Rather than re-implement the API in
 * the browser, it replays what the real one said: this script brings up the
 * same private stack as the screenshots (`stack.ts`), seeds the same history
 * (`seed/`), walks the app through every screen for each graph (the main
 * history, its branch and the invented world, Vael) while letting
 * each request through to the real backend, and keeps every answer. It also
 * reads each graph's events, arcs and causal links directly, as the starting
 * state of the demo's in-memory store, so edits in the demo have something
 * real to edit.
 *
 * Output: frontend/src/demo/recording.json (committed, like the screenshots).
 */
import { chromium, type Page, type Request } from 'playwright'
import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { paths } from '../paths.js'
import { scenario, world } from '../seed/scenario.js'
import { seed, type SeedResult } from '../seed/seed.js'
import { buildProduct, startStack, type Stack } from '../stack.js'
import { FEATURED_ACTOR } from '../capture/tour.js'

const OUT = path.join(paths.repoRoot, 'frontend/src/demo/recording.json')

interface Recorded {
  status: number
  body: unknown
}

function log(message: string): void {
  process.stderr.write(`[demo] ${message}\n`)
}

/** The recording's key for a request; the demo's adapter computes the same one. */
export function requestKey(method: string, pathname: string, search: string, graphId: string): string {
  const params = new URLSearchParams(search)
  params.sort()
  const query = params.toString()
  return `${method.toUpperCase()} ${pathname}${query ? `?${query}` : ''} @${graphId}`
}

async function direct(stack: Stack, pathname: string, graphId: string): Promise<unknown> {
  const res = await fetch(`${stack.apiUrl}/api${pathname}`, {
    headers: { 'x-api-key': stack.apiKey, 'x-graph-id': graphId },
  })
  if (!res.ok) throw new Error(`GET ${pathname} for ${graphId} -> ${res.status}`)
  const json = (await res.json()) as { data?: unknown }
  return json && typeof json === 'object' && 'data' in json ? json.data : json
}

async function walk(page: Page, appUrl: string, graphName: string, eventCount: number): Promise<void> {
  log(`walking ${graphName}`)
  await page.goto(`${appUrl}/timeline`)
  if (eventCount > 0) {
    await page.locator('g[data-timeline-mark="event"]').nth(eventCount - 1).waitFor()
  }
  await page.waitForLoadState('networkidle')

  // Select every event: the inspector loads what it caused.
  const marks = page.locator('g[data-timeline-mark="event"] .event-marker')
  for (let i = 0; i < (await marks.count()); i++) {
    await marks.nth(i).click({ force: true })
    await page.waitForLoadState('networkidle')
  }
  await page.keyboard.press('Escape')

  const pressures = page.getByRole('button', { name: 'Pressure Analysis' })
  if (await pressures.count()) {
    if ((await pressures.getAttribute('aria-expanded')) !== 'true') await pressures.click()
    await page.waitForLoadState('networkidle')
  }
  const filters = page.getByRole('button', { name: 'Show Filters' })
  if (await filters.count()) {
    await filters.click()
    await page.waitForLoadState('networkidle')
  }

  // Compare branches, on the toolbar; Versions, Statistics and Export, in its
  // Graph menu.
  const compare = page.getByRole('button', { name: 'Compare branches', exact: true }).first()
  if (await compare.count()) {
    await compare.click().catch(() => undefined)
    await page.waitForLoadState('networkidle')
    await page.keyboard.press('Escape')
  }
  for (const item of ['Versions', 'Statistics', 'Export']) {
    await page.getByRole('button', { name: 'Graph', exact: true }).first().click()
    const entry = page.getByRole('menuitem', { name: item, exact: true }).first()
    if (await entry.count()) {
      await entry.click().catch(() => undefined)
      await page.waitForLoadState('networkidle')
    }
    await page.keyboard.press('Escape')
    await page.keyboard.press('Escape')
  }

  await page.goto(`${appUrl}/causal-graph`)
  await page.waitForLoadState('networkidle')
  const suggest = page.getByRole('button', { name: /Suggest Links/ }).first()
  if (await suggest.count()) {
    await suggest.click().catch(() => undefined)
    await page.waitForLoadState('networkidle')
    await page.keyboard.press('Escape')
  }

  await page.goto(`${appUrl}/actor-perspective`)
  await page.waitForLoadState('networkidle')
  const picker = page.getByRole('button', { name: /Search and select an actor/ })
  if ((await picker.count()) && eventCount > 0) {
    await picker.click()
    const actor = page.getByText(FEATURED_ACTOR, { exact: true }).first()
    if (await actor.count()) await actor.click()
    await page.waitForLoadState('networkidle')
  }

  // The graph picker, and the graph manager behind it.
  await page.goto(`${appUrl}/timeline`)
  await page.waitForLoadState('networkidle')
  const selector = page.getByRole('button', { name: new RegExp(graphName.slice(0, 14)) }).first()
  await selector.click()
  await page.waitForLoadState('networkidle')
  const manage = page.getByRole('button', { name: 'Manage' }).first()
  if (await manage.count()) {
    await manage.click()
    await page.waitForLoadState('networkidle')
    for (const tab of await page.getByRole('dialog').getByRole('tab').all()) {
      await tab.click().catch(() => undefined)
      await page.waitForLoadState('networkidle')
    }
  }
  await page.keyboard.press('Escape')
}

async function record(stack: Stack, seeded: SeedResult): Promise<void> {
  const responses: Record<string, Recorded> = {}
  const unrecorded = new Set<string>()
  let activeGraph = seeded.graphId

  const browser = await chromium.launch()
  try {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      locale: 'en-US',
      timezoneId: 'UTC',
      serviceWorkers: 'block',
    })
    await context.addInitScript(
      ([key, graphId]) => {
        localStorage.setItem('api_key', key)
        localStorage.setItem('active_graph_id', graphId)
      },
      [stack.apiKey, seeded.graphId] as const
    )

    await context.route('**/api/**', async (route) => {
      const request: Request = route.request()
      const url = new URL(request.url())
      const pathname = url.pathname.replace(/^\/api/, '')
      const method = request.method()
      const graph = (await request.headerValue('x-graph-id')) ?? activeGraph
      let response
      let text: string
      try {
        response = await route.fetch()
        text = await response.text()
      } catch {
        // The page moved on (or closed) while this request was in flight.
        return route.abort().catch(() => undefined)
      }
      // Reads are replayed; a write is answered by the demo's own store, so
      // only the reads-by-POST (inference) are worth keeping.
      const isRead = method === 'GET' || pathname.startsWith('/inference/')
      if (isRead && response.status() < 500) {
        let body: unknown = null
        try {
          body = text ? JSON.parse(text) : null
        } catch {
          body = text
        }
        const key = requestKey(method, pathname, url.search, graph)
        // The first answer is the seeded state; keep it.
        responses[key] ??= { status: response.status(), body }
      } else if (!isRead) {
        unrecorded.add(`${method} ${pathname}`)
      }
      if (method === 'POST' && /^\/graphs\/[^/]+\/activate$/.test(pathname) && response.ok()) {
        activeGraph = pathname.split('/')[2]
      }
      await route.fulfill({ response, body: text }).catch(() => undefined)
    })

    const page = await context.newPage()
    page.setDefaultTimeout(20_000)

    await walk(page, stack.appUrl, seeded.graphName, scenario.events.length)

    // Switch to the branch through the picker, as a visitor would, and walk it.
    await page.goto(`${stack.appUrl}/timeline`)
    await page.getByRole('button', { name: new RegExp(seeded.graphName.slice(0, 14)) }).first().click()
    await page.getByText(seeded.branchName.slice(0, 20)).first().click()
    await page.waitForLoadState('networkidle')
    activeGraph = seeded.branchId
    const branchEvents = (await direct(stack, '/events', seeded.branchId)) as unknown[]
    await walk(page, stack.appUrl, seeded.branchName, branchEvents.length)

    // And back, so the switch the other way is recorded too.
    await page.getByRole('button', { name: new RegExp(seeded.branchName.slice(0, 14)) }).first().click()
    await page.getByText(seeded.graphName, { exact: true }).first().click()
    await page.waitForLoadState('networkidle')

    // The invented world, through the picker too, then back to the main line.
    await page.goto(`${stack.appUrl}/timeline`)
    await page.getByRole('button', { name: new RegExp(seeded.graphName.slice(0, 14)) }).first().click()
    await page.getByText(seeded.world.graphName, { exact: true }).first().click()
    await page.waitForLoadState('networkidle')
    activeGraph = seeded.world.graphId
    await walk(page, stack.appUrl, seeded.world.graphName, world.events.length)
    await page.getByRole('button', { name: new RegExp(seeded.world.graphName) }).first().click()
    await page.getByText(seeded.graphName, { exact: true }).first().click()
    await page.waitForLoadState('networkidle')
    await context.unrouteAll({ behavior: 'ignoreErrors' })
  } finally {
    await browser.close()
  }

  const entities: Record<string, { events: unknown; arcs: unknown; relationships: unknown }> = {}
  for (const graphId of [seeded.graphId, seeded.branchId, seeded.world.graphId]) {
    entities[graphId] = {
      events: await direct(stack, '/events', graphId),
      arcs: await direct(stack, '/arcs', graphId),
      relationships: await direct(stack, '/causal/relationships', graphId),
    }
  }

  const recording = {
    // The scenario's name, not a date: the file changes when the data does.
    scenario: scenario.graph.name,
    mainGraphId: seeded.graphId,
    branchGraphId: seeded.branchId,
    worldGraphId: seeded.world.graphId,
    entities,
    responses: Object.fromEntries(Object.entries(responses).sort(([a], [b]) => a.localeCompare(b))),
  }
  await writeFile(OUT, normalise(JSON.stringify(recording, null, 1), seeded) + '\n')
  log(`recorded ${Object.keys(responses).length} responses into ${path.relative(paths.repoRoot, OUT)}`)
  if (unrecorded.size) log(`writes seen and not recorded: ${[...unrecorded].join(', ')}`)
}

/**
 * Every run mints new random ids, which would rewrite the whole file each
 * time. Name the seeded entities after their scenario keys, and number the
 * rest in order of appearance, so a re-recording only changes what changed.
 */
function normalise(json: string, seeded: SeedResult): string {
  const names = new Map<string, string>([
    [seeded.graphId, 'graph_engine_age'],
    [seeded.branchId, 'graph_clerks_prevail'],
    [seeded.world.graphId, 'graph_vael'],
    ...Object.entries(seeded.eventIds).map(([key, id]) => [id, `event_${key}`] as [string, string]),
    ...Object.entries(seeded.arcIds).map(([key, id]) => [id, `arc_${key}`] as [string, string]),
    ...Object.entries(seeded.world.eventIds).map(([key, id]) => [id, `event_vael_${key}`] as [string, string]),
    ...Object.entries(seeded.world.arcIds).map(([key, id]) => [id, `arc_vael_${key}`] as [string, string]),
  ])
  const counters = new Map<string, number>()
  return json.replace(/\b([a-z]+)_\d{13}_[a-z0-9]{6,12}\b/g, (id, prefix: string) => {
    let name = names.get(id)
    if (!name) {
      const n = (counters.get(prefix) ?? 0) + 1
      counters.set(prefix, n)
      name = `${prefix}_${n}`
      names.set(id, name)
    }
    return name
  })
}

async function main(): Promise<void> {
  if (!process.argv.includes('--skip-build')) await buildProduct()
  const stack = await startStack()
  const stop = () => void stack.stop().finally(() => process.exit(130))
  process.once('SIGINT', stop)
  process.once('SIGTERM', stop)
  try {
    log('seeding')
    const seeded = await seed(stack.apiUrl, stack.apiKey)
    await record(stack, seeded)
  } finally {
    await stack.stop()
  }
}

main().catch((err: unknown) => {
  process.stderr.write(`${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`)
  process.exit(1)
})
