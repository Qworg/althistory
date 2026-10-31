/**
 * Drives the real app through the walkthrough and captures each step.
 *
 * Every step waits for something the app renders from the seeded data (an
 * event count, a heading, a review table) rather than for a fixed delay, so a
 * capture that "succeeds" against a broken screen fails instead.
 */
import { chromium, type Browser, type Locator, type Page } from 'playwright'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { Manifest, Point, Rect, Shot } from '../manifest.js'
import { scenario } from '../seed/scenario.js'
import type { SeedResult } from '../seed/seed.js'

export const VIEWPORT = { width: 1600, height: 900 }
export const DEVICE_SCALE_FACTOR = 2

/** Pasted into the ingestion wizard; chosen to extract cleanly with the pattern reader. */
export const INGEST_TEXT =
  'On 14 February 1870, the Royal Society honoured Ada Lovelace with the Copley Medal. ' +
  'In March 1871, the Admiralty launched HMS Calculator. ' +
  'On 2 June 1872, the Prussian General Staff founded a programming academy in Berlin.'

/** The actor the actor-perspective step selects. */
export const FEATURED_ACTOR = 'Prussian General Staff'

/** The event the timeline step hovers. */
const FEATURED_EVENT = 'Bernoulli numbers'

interface TourContext {
  page: Page
  appUrl: string
  outDir: string
}

async function rectOf(locator: Locator, what: string): Promise<Rect> {
  const box = await locator.boundingBox()
  if (!box) throw new Error(`Capture: ${what} is not visible`)
  const round = (n: number) => Math.round(n * 10) / 10
  return { x: round(box.x), y: round(box.y), width: round(box.width), height: round(box.height) }
}

/** The smallest rectangle containing all of them. */
function union(...rects: Rect[]): Rect {
  const x = Math.min(...rects.map((r) => r.x))
  const y = Math.min(...rects.map((r) => r.y))
  const right = Math.max(...rects.map((r) => r.x + r.width))
  const bottom = Math.max(...rects.map((r) => r.y + r.height))
  return { x, y, width: right - x, height: bottom - y }
}

function centre(rect: Rect): Point {
  return { x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2) }
}

/** Remove focus rings and carets so they cannot leak into a picture. */
async function settle(page: Page): Promise<void> {
  await page.evaluate(async () => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
    await document.fonts.ready
  })
  // Two frames: one for React to commit, one for the browser to paint it.
  await page.evaluate(
    () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())))
  )
}

async function snap(
  ctx: TourContext,
  id: string,
  focus: Record<string, Rect>,
  pointer?: Point,
  options: { blur?: boolean; fullPage?: boolean } = {}
): Promise<Shot> {
  if (options.blur !== false) await settle(ctx.page)
  const file = `${id}.png`
  await ctx.page.screenshot({
    path: path.join(ctx.outDir, file),
    animations: 'disabled',
    caret: 'hide',
    fullPage: options.fullPage ?? false,
  })
  const size = options.fullPage
    ? await ctx.page.evaluate(() => ({
        width: document.documentElement.clientWidth,
        height: document.documentElement.scrollHeight,
      }))
    : { ...VIEWPORT }
  process.stderr.write(`[capture] ${id}\n`)
  return { id, file, size, focus, pointer }
}

async function openTimeline(ctx: TourContext): Promise<void> {
  await ctx.page.goto(`${ctx.appUrl}/`)
  const total = scenario.events.length
  await ctx.page.getByText(`${total} events, ${scenario.arcs.length} arcs`).waitFor()
  await ctx.page.locator('g[data-timeline-mark="event"]').nth(total - 1).waitFor()
  // The pressure panel loads separately; the scenario's clusters always yield
  // an economic pressure, so its chip is the sign the panel has data (the
  // text is lower case; the capital is CSS).
  await ctx.page.getByText('economic', { exact: true }).first().waitFor()
}

async function hideFilters(page: Page): Promise<void> {
  const hide = page.getByRole('button', { name: 'Hide Filters' })
  if (await hide.isVisible()) {
    await hide.click()
    await page.getByRole('button', { name: 'Show Filters' }).waitFor()
  }
}

// ---------------------------------------------------------------------------
// The steps, in walkthrough order.
// ---------------------------------------------------------------------------

async function overview(ctx: TourContext): Promise<Shot> {
  const { page } = ctx
  await openTimeline(ctx)
  await page.getByRole('heading', { name: 'Filters' }).waitFor()
  return snap(ctx, 'overview', {
    views: await rectOf(page.getByRole('navigation').first(), 'the view navigation'),
    // The toolbar is several button groups; its extent is first to last control.
    toolbar: union(
      await rectOf(page.getByRole('button', { name: 'Fit to View' }).first(), 'the first toolbar button'),
      await rectOf(page.getByRole('button', { name: 'Connect' }).first(), 'the last toolbar control')
    ),
    graphSelector: await rectOf(page.getByRole('button', { name: new RegExp(scenario.graph.name) }).first(), 'the graph selector'),
    timeline: await rectOf(page.locator('svg[role="img"]').first(), 'the timeline'),
    filters: await rectOf(page.getByRole('heading', { name: 'Filters' }).locator('xpath=ancestor::div[2]'), 'the filter panel'),
  })
}

async function timeline(ctx: TourContext): Promise<Shot> {
  const { page } = ctx
  await openTimeline(ctx)
  await hideFilters(page)
  const svg = page.locator('svg[role="img"]').first()
  const mark = page.locator(`g[data-timeline-mark="event"][aria-label*="${FEATURED_EVENT}"]`).first()
  const markRect = await rectOf(mark, 'the featured event mark')
  const pointer = centre(markRect)
  // Settle first: the hover is the point of this shot, so it is not blurred after.
  await settle(page)
  await page.mouse.move(pointer.x, pointer.y)
  const tooltip = page.getByText(new RegExp(FEATURED_EVENT)).last()
  await tooltip.waitFor()
  return snap(
    ctx,
    'timeline',
    {
      timeline: await rectOf(svg, 'the timeline'),
      arcs: await rectOf(page.locator('svg[role="img"] g[data-timeline-mark="arc"]').first().locator('xpath=..'), 'the arc lane').catch(() => rectOf(svg, 'the timeline')),
      mark: markRect,
      tooltip: await rectOf(tooltip.locator('xpath=..'), 'the tooltip'),
    },
    pointer,
    { blur: false }
  )
}

async function pressures(ctx: TourContext): Promise<Shot> {
  const { page } = ctx
  await openTimeline(ctx)
  await hideFilters(page)
  const heading = page.getByRole('heading', { name: 'Pressure Analysis' })
  await heading.waitFor()
  const panel = heading.locator('xpath=ancestor::div[contains(@class,"rounded")][1]')
  await panel.evaluate((el) => el.scrollIntoView({ block: 'start' }))
  await page.mouse.move(0, 0)
  return snap(ctx, 'pressures', {
    panel: await rectOf(panel, 'the pressure panel'),
  })
}

async function causalGraph(ctx: TourContext): Promise<Shot> {
  const { page } = ctx
  await page.goto(`${ctx.appUrl}/causal-graph`)
  await page.getByText(`${scenario.links.length} relationships`).waitFor()
  await hideFilters(page)
  const directed = page.getByRole('button', { name: /Directed Graph/ })
  await directed.click()
  // The layout animates; let it finish before fitting, or Fit frames the
  // half-way positions.
  await page.waitForTimeout(1500)
  await page.getByRole('button', { name: /Fit \(F\)/ }).click()
  await page.waitForTimeout(1000)
  // The graph canvas is taller than a 900px window, so this shot is the whole
  // page: the video pans down it and the README crops to the graph.
  const canvas = page.locator('.__________cytoscape_container.min-h-\\[400px\\]').first()
  await page.mouse.move(0, 0)
  return snap(
    ctx,
    'causal-graph',
    {
      graph: await rectOf(canvas, 'the causal graph canvas'),
      layouts: await rectOf(page.getByText('Graph Layout').locator('xpath=ancestor::div[contains(@class,"rounded")][1]'), 'the layout panel'),
      directed: await rectOf(directed, 'the Directed Graph button'),
      counts: await rectOf(page.getByText(`${scenario.links.length} relationships`), 'the relationship count'),
    },
    centre(await rectOf(directed, 'the Directed Graph button')),
    { fullPage: true }
  )
}

async function actorPerspective(ctx: TourContext): Promise<Shot> {
  const { page } = ctx
  await page.goto(`${ctx.appUrl}/actor-perspective`)
  const picker = page.getByRole('button', { name: /Search and select an actor/ })
  await picker.click()
  await page.getByText(FEATURED_ACTOR, { exact: true }).first().click()
  const stats = page.getByText(`Statistics for ${FEATURED_ACTOR}`)
  await stats.waitFor()
  await hideFilters(page)
  await page.mouse.move(0, 0)
  // Viewport only: the actor's own timeline further down currently renders
  // without its event marks, so it is left out of the pictures for now.
  return snap(ctx, 'actor', {
    picker: await rectOf(page.getByText('Select Actor').locator('xpath=..'), 'the actor picker'),
    stats: await rectOf(stats.locator('xpath=..'), 'the actor statistics'),
  })
}

async function ingest(ctx: TourContext): Promise<Shot[]> {
  const { page } = ctx
  await openTimeline(ctx)
  const ingestButton = page.getByRole('button', { name: 'Ingest', exact: true })
  await ingestButton.click()
  const dialog = page.getByRole('dialog')
  // `role=dialog` is the full-screen overlay; the visible panel is its child.
  const panel = dialog.locator(':scope > div.relative')
  await dialog.getByRole('tab', { name: 'Text' }).click()
  const textarea = dialog.locator('#ingest-text-body')
  await textarea.fill(INGEST_TEXT)
  const extract = dialog.getByRole('button', { name: /Extract/ })
  const pasted = await snap(
    ctx,
    'ingest-text',
    {
      dialog: await rectOf(panel, 'the ingestion dialog'),
      text: await rectOf(textarea, 'the text box'),
      extract: await rectOf(extract, 'the extract button'),
    },
    centre(await rectOf(extract, 'the extract button'))
  )

  await extract.click()
  const reviewHeading = dialog.getByRole('heading', { name: /^Events \(\d+\/\d+ selected\)$/ })
  await reviewHeading.waitFor()
  const table = dialog.locator('table').first()
  const review = await snap(ctx, 'ingest-review', {
    dialog: await rectOf(panel, 'the ingestion dialog'),
    table: await rectOf(table, 'the review table'),
  })
  return [pasted, review]
}

async function graphs(ctx: TourContext, seed: SeedResult): Promise<Shot> {
  const { page } = ctx
  await openTimeline(ctx)
  await hideFilters(page)
  const selector = page.getByRole('button', { name: new RegExp(scenario.graph.name) }).first()
  await selector.click()
  const branch = page.getByText(seed.branchName.slice(0, 20)).first()
  await branch.waitFor()
  const menu = branch.locator('xpath=ancestor::div[contains(@class,"absolute")][1]')
  return snap(
    ctx,
    'graphs',
    {
      selector: await rectOf(selector, 'the graph selector'),
      menu: await rectOf(menu, 'the graph menu'),
    },
    centre(await rectOf(selector, 'the graph selector'))
  )
}

export async function captureTour(appUrl: string, apiKey: string, seed: SeedResult, outDir: string): Promise<Manifest> {
  await rm(outDir, { recursive: true, force: true })
  await mkdir(outDir, { recursive: true })

  let browser: Browser | undefined
  try {
    browser = await chromium.launch()
    const context = await browser.newContext({
      viewport: VIEWPORT,
      deviceScaleFactor: DEVICE_SCALE_FACTOR,
      // Pinned so the pictures do not depend on who runs the script: an 1843
      // date renders in the machine's local-mean-time offset otherwise.
      locale: 'en-US',
      timezoneId: 'UTC',
      colorScheme: 'light',
      reducedMotion: 'reduce',
      // The production app-shell worker could answer from a stale cache.
      serviceWorkers: 'block',
    })
    // The key and the graph are handed to the app the way it stores them
    // itself, so no key is ever compiled into a build.
    await context.addInitScript(
      ([key, graphId]) => {
        localStorage.setItem('api_key', key)
        localStorage.setItem('active_graph_id', graphId)
      },
      [apiKey, seed.graphId] as const
    )
    const page = await context.newPage()
    page.setDefaultTimeout(20_000)
    const ctx: TourContext = { page, appUrl, outDir }

    const shots: Shot[] = [
      await overview(ctx),
      await timeline(ctx),
      await pressures(ctx),
      await causalGraph(ctx),
      await actorPerspective(ctx),
      ...(await ingest(ctx)),
      await graphs(ctx, seed),
    ]

    const manifest: Manifest = {
      generatedAt: new Date().toISOString(),
      viewport: VIEWPORT,
      deviceScaleFactor: DEVICE_SCALE_FACTOR,
      graphName: seed.graphName,
      shots: Object.fromEntries(shots.map((s) => [s.id, s])),
    }
    await writeFile(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
    return manifest
  } finally {
    await browser?.close()
  }
}
