import { test, expect, type Page } from '@playwright/test'
import { installApiStub } from './support/api'

/**
 * Overlays on phones and desktops.
 *
 * #37: below 1024px the selection inspector is a bottom sheet. Selecting an
 * event must leave its mark visible above the sheet. Contexts here are plain
 * viewports, not `isMobile` emulation, which distorts layout.
 */

const EVENTS = ['evt-hastings', 'evt-stamford', 'evt-coronation']

/** Select an event the way a person does: a click on its dot, by coordinates. */
async function clickMark(page: Page, eventId: string) {
  const dot = page.locator(`g[data-timeline-mark="event"][data-event-id="${eventId}"] .event-hit-area`)
  const sheet = page.locator('aside[aria-label="Selection"]')
  for (let attempt = 0; attempt < 4; attempt += 1) {
    // Wait for the mark to stop moving (the first layout animates in).
    let box = await dot.boundingBox()
    for (let i = 0; i < 10 && box; i += 1) {
      await page.waitForTimeout(100)
      const next = await dot.boundingBox()
      const still = next && Math.abs(next.x - box.x) < 0.5 && Math.abs(next.y - box.y) < 0.5
      box = next
      if (still) break
    }
    if (!box) throw new Error(`no mark for ${eventId}`)
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
    try {
      await sheet.waitFor({ state: 'visible', timeout: 1500 })
      return
    } catch {
      // The click landed before the layout settled; try again.
    }
  }
}

/** What the point at the centre of the mark's hit circle lands on. */
async function markProbe(page: Page, eventId: string) {
  return page.evaluate((id) => {
    const mark = document.querySelector(`g[data-timeline-mark="event"][data-event-id="${id}"]`)
    const dot = mark?.querySelector('.event-hit-area')
    if (!mark || !dot) return null
    const r = dot.getBoundingClientRect()
    const x = r.left + r.width / 2
    const y = r.top + r.height / 2
    const hit = document.elementFromPoint(x, y)
    const sheet = document.querySelector('aside[aria-label="Selection"]')?.getBoundingClientRect()
    const header = document.querySelector('header')?.getBoundingClientRect()
    return {
      x,
      y,
      onMark: hit !== null && mark.contains(hit),
      sheetTop: sheet?.top ?? null,
      headerBottom: header?.bottom ?? 0,
      viewportHeight: window.innerHeight,
    }
  }, eventId)
}

// 390x844 and 768x1024 are the sizes the issue names; the shorter two are where
// the stub's single lane of marks really sits under the sheet (the sheet is up
// to 55% of the viewport), so they are the ones that fail without the scroll.
for (const viewport of [
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 390, height: 667 },
  { width: 600, height: 700 },
]) {
  test.describe(`docked inspector sheet at ${viewport.width}x${viewport.height}`, () => {
    test.use({ viewport })

    for (const id of EVENTS) {
      test(`selecting ${id} leaves its mark visible above the sheet`, async ({ page }) => {
        await installApiStub(page)
        await page.goto('/')
        await expect(page.locator('g[data-timeline-mark="event"]')).toHaveCount(3)

        await clickMark(page, id)
        const sheet = page.locator('aside[aria-label="Selection"]')
        await expect(sheet).toBeVisible()
        expect(await sheet.evaluate((el) => getComputedStyle(el).position)).toBe('fixed')

        await expect
          .poll(async () => {
            const probe = await markProbe(page, id)
            return probe !== null && probe.onMark && probe.sheetTop !== null && probe.y < probe.sheetTop && probe.y > probe.headerBottom
          }, { timeout: 5000 })
          .toBe(true)
      })
    }

    test('selecting with the keyboard also reveals the mark', async ({ page }) => {
      await installApiStub(page)
      await page.goto('/')
      const mark = page.locator('g[data-timeline-mark="event"][data-event-id="evt-coronation"]')
      await mark.focus()
      await page.keyboard.press('Enter')
      await expect(page.locator('aside[aria-label="Selection"]')).toBeVisible()
      await expect
        .poll(async () => {
          const probe = await markProbe(page, 'evt-coronation')
          return probe !== null && probe.onMark && probe.sheetTop !== null && probe.y < probe.sheetTop
        })
        .toBe(true)
    })

    test('does not smooth-scroll under prefers-reduced-motion', async ({ page }) => {
      await page.emulateMedia({ reducedMotion: 'reduce' })
      await installApiStub(page)
      await page.goto('/')
      await expect(page.locator('g[data-timeline-mark="event"]')).toHaveCount(3)
      await page.evaluate(() => {
        const original = window.scrollBy.bind(window)
        ;(window as unknown as { __behaviors: unknown[] }).__behaviors = []
        window.scrollBy = ((opts: ScrollToOptions) => {
          ;(window as unknown as { __behaviors: unknown[] }).__behaviors.push(opts.behavior)
          return original(opts)
        }) as typeof window.scrollBy
      })
      await clickMark(page, 'evt-coronation')
      await expect(page.locator('aside[aria-label="Selection"]')).toBeVisible()
      await page.waitForTimeout(500)
      const behaviors = await page.evaluate(() => (window as unknown as { __behaviors: unknown[] }).__behaviors)
      expect(behaviors).not.toContain('smooth')
    })
  })
}

test.describe('desktop inspector is a side panel', () => {
  test.use({ viewport: { width: 1280, height: 800 } })

  test('selecting an event does not scroll the page', async ({ page }) => {
    await installApiStub(page)
    await page.goto('/')
    await expect(page.locator('g[data-timeline-mark="event"]')).toHaveCount(3)
    await clickMark(page, 'evt-coronation')
    await expect(page.locator('aside[aria-label="Selection"]')).toBeVisible()
    await page.waitForTimeout(400)
    expect(await page.evaluate(() => window.scrollY)).toBe(0)
  })
})
