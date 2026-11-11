import { test, expect } from '@playwright/test'

/**
 * Guards for the site's pages. Both of these once shipped broken and passed
 * review by eye: a cascade change turned the terminal text the same colour as
 * its panel in light mode, and a grid column grew to fit a long command so
 * the page scrolled sideways on a phone.
 */

const PAGES = ['./', './agents.html']

for (const colorScheme of ['light', 'dark'] as const) {
  for (const pagePath of PAGES) {
    test(`code panels are readable: ${pagePath} (${colorScheme})`, async ({ browser }) => {
      const context = await browser.newContext({ colorScheme })
      const page = await context.newPage()
      await page.goto(pagePath, { waitUntil: 'networkidle' })

      const findings = await page.evaluate(() => {
        const rgb = (value: string) => (value.match(/[\d.]+/g) ?? []).map(Number)
        const luminance = ([r = 0, g = 0, b = 0]: number[]) => {
          const channel = (c: number) => {
            const s = c / 255
            return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
          }
          return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
        }
        const background = (element: Element): number[] => {
          for (let node: Element | null = element; node; node = node.parentElement) {
            const parts = rgb(getComputedStyle(node).backgroundColor)
            if (parts.length >= 3 && (parts[3] ?? 1) > 0) return parts
          }
          return [255, 255, 255]
        }
        const results: Array<{ text: string; ratio: number }> = []
        for (const element of document.querySelectorAll('.code pre code, .code pre code *')) {
          const own = [...element.childNodes].some((n) => n.nodeType === Node.TEXT_NODE && n.textContent?.trim())
          if (!own) continue
          const a = luminance(rgb(getComputedStyle(element).color))
          const b = luminance(background(element))
          const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
          results.push({ text: (element.textContent ?? '').trim().slice(0, 40), ratio: Math.round(ratio * 100) / 100 })
        }
        return results
      })

      expect(findings.length).toBeGreaterThan(0)
      const unreadable = findings.filter((f) => f.ratio < 4.5)
      expect(unreadable).toEqual([])
      await context.close()
    })
  }
}

for (const pagePath of PAGES) {
  // A plain context, not mobile emulation: a mobile layout viewport widens to
  // fit the content, which hides exactly the overflow this looks for.
  test(`no sideways scrolling at 390px: ${pagePath}`, async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } })
    const page = await context.newPage()
    await page.goto(pagePath, { waitUntil: 'networkidle' })

    const layout = await page.evaluate(() => {
      const width = document.documentElement.clientWidth
      // Content inside a scroll or clip container (the hero timeline, the code
      // panels) may be wider than the screen; the page itself may not.
      const contained = (element: Element) => {
        for (let node = element.parentElement; node && node !== document.body; node = node.parentElement) {
          if (getComputedStyle(node).overflowX !== 'visible') return true
        }
        return false
      }
      const past = [...document.body.querySelectorAll('*')]
        .filter((element) => {
          const box = element.getBoundingClientRect()
          return box.width > 1 && box.right > width + 1 && !contained(element)
        })
        .map((element) => `${element.tagName.toLowerCase()}.${[...element.classList].join('.')}`)
      return { scrollWidth: document.documentElement.scrollWidth, width, past: past.slice(0, 10) }
    })

    expect(layout.past).toEqual([])
    expect(layout.scrollWidth).toBeLessThanOrEqual(layout.width)
    await context.close()
  })
}

test('on a phone the hero shows what selecting does, once', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })
  const page = await context.newPage()
  await page.goto('./', { waitUntil: 'networkidle' })
  await page.locator('.hero-scroll').evaluate((el) => el.scrollIntoView({ block: 'center' }))
  // The demonstration selects an event a moment after the timeline is in
  // view, without speaking and without taking focus, then lets go.
  await expect(page.locator('.ht-tip.is-on')).toBeVisible({ timeout: 8000 })
  await expect(page.locator('.ht-live')).toHaveText('')
  expect(await page.evaluate(() => document.activeElement === document.body)).toBe(true)
  await expect(page.locator('.ht-tip.is-on')).toHaveCount(0, { timeout: 6000 })
  await context.close()
})

test('the hero demonstration never runs with reduced motion', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' })
  const page = await context.newPage()
  await page.goto('./', { waitUntil: 'networkidle' })
  await page.waitForTimeout(5000)
  await expect(page.locator('.ht-tip.is-on')).toHaveCount(0)
  await context.close()
})
