import { test, expect, type Page } from '@playwright/test'

/**
 * #37 on the demo build, which has the Pages banner above the sticky header
 * (so the header is not yet stuck at scroll 0) and a real ripple of link
 * curves. After a selection below 1024px, the selected mark is above the
 * docked sheet, and so are its curves when the whole trace fits.
 *
 * Plain viewports, not `isMobile` emulation, which distorts layout.
 */

const VIEWPORTS = [
  { width: 390, height: 844 },
  { width: 600, height: 700 },
  { width: 768, height: 1024 },
  { width: 390, height: 667 },
]

interface Measure {
  markTop: number
  markBottom: number
  traceTop: number
  traceBottom: number
  curves: number
  sheetTop: number
  headerRest: number
}

async function resetScroll(page: Page) {
  await page.evaluate(() => {
    window.scrollTo(0, 0)
    document.querySelectorAll('*').forEach((el) => {
      if (el.scrollTop > 0) el.scrollTop = 0
    })
  })
}

async function settled(page: Page) {
  let last = -1
  for (let i = 0; i < 30; i += 1) {
    const y = await page.evaluate(() => {
      let total = window.scrollY
      document.querySelectorAll('*').forEach((el) => (total += el.scrollTop))
      return total
    })
    if (y === last) return
    last = y
    await page.waitForTimeout(80)
  }
}

async function measure(page: Page, id: string): Promise<Measure | null> {
  return page.evaluate((eventId) => {
    const mark = document.querySelector(`g[data-timeline-mark="event"][data-event-id="${eventId}"]`)
    const sheet = document.querySelector('aside[aria-label="Selection"]')
    const header = document.querySelector('header')
    if (!mark || !sheet || !header || getComputedStyle(sheet).position !== 'fixed') return null
    const m = (mark.querySelector('.event-hit-area') ?? mark).getBoundingClientRect()
    let traceTop = m.top
    let traceBottom = m.bottom
    const parts = document.querySelectorAll(
      'g[data-timeline-mark="event"][data-traced="true"], path.timeline-link[data-ripple]',
    )
    parts.forEach((p) => {
      const r = p.getBoundingClientRect()
      traceTop = Math.min(traceTop, r.top)
      traceBottom = Math.max(traceBottom, r.bottom)
    })
    return {
      markTop: m.top,
      markBottom: m.bottom,
      traceTop,
      traceBottom,
      curves: document.querySelectorAll('path.timeline-link[data-ripple]').length,
      sheetTop: sheet.getBoundingClientRect().top,
      headerRest: parseFloat(getComputedStyle(header).top || '0') + (header as HTMLElement).offsetHeight,
    }
  }, id)
}

for (const dark of [false, true]) {
  for (const viewport of VIEWPORTS) {
    test(`demo: selection clears the sheet at ${viewport.width}x${viewport.height} (${dark ? 'dark' : 'light'})`, async ({ browser }) => {
      test.setTimeout(180_000)
      const context = await browser.newContext({ viewport })
      const page = await context.newPage()
      await page.goto('./')
      await expect(page.locator('g[data-timeline-mark="event"]').first()).toBeVisible()
      await expect(page.getByRole('region', { name: 'About this demo' })).toBeVisible()
      if (dark) await page.evaluate(() => document.documentElement.classList.add('dark'))

      const ids = await page.locator('g[data-timeline-mark="event"]').evaluateAll((els) =>
        els.map((el) => el.getAttribute('data-event-id')!),
      )
      const hiddenMarks: string[] = []
      const cutCurves: string[] = []
      let withCurves = 0

      for (const id of ids) {
        await page.keyboard.press('Escape')
        await resetScroll(page)
        await page.waitForTimeout(100)
        await page.locator(`g[data-timeline-mark="event"][data-event-id="${id}"]`).focus()
        await page.keyboard.press('Enter')
        await expect(page.locator('aside[aria-label="Selection"]').first()).toBeVisible()
        await page.waitForTimeout(250)
        await settled(page)
        const m = await measure(page, id)
        if (!m) {
          console.log('NULL', id, await page.evaluate(() => ({ s: document.querySelectorAll('aside[aria-label="Selection"]').length, pos: [...document.querySelectorAll('aside[aria-label="Selection"]')].map((a) => getComputedStyle(a).position + ':' + (a as HTMLElement).offsetHeight) })))
          continue
        }
        const lo = m.headerRest + 12
        const hi = m.sheetTop - 12
        const markVisible = m.markTop >= lo - 1 && m.markBottom <= hi + 1
        if (!markVisible) { hiddenMarks.push(id); console.log('HIDDEN', id, JSON.stringify(m)) }
        if (m.curves > 0) {
          withCurves += 1
          const fits = m.traceBottom - m.traceTop <= hi - lo
          if (fits && (m.traceTop < lo - 1 || m.traceBottom > hi + 1)) { cutCurves.push(id); console.log('CUT', id, JSON.stringify(m)) }
        }
      }

      console.log(`${viewport.width}x${viewport.height} ${dark ? 'dark' : 'light'}: ${ids.length} selections, hidden marks ${hiddenMarks.length}, with curves ${withCurves}, curves cut though they fit ${cutCurves.length}`)
      expect(hiddenMarks).toEqual([])
      expect(cutCurves).toEqual([])
      await context.close()
    })
  }
}
