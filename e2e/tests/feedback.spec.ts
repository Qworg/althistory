import { test, expect, type Page } from '@playwright/test'
import { installApiStub } from './support/api'

/**
 * In-app feedback (issue #49): opened from anywhere, it captures the screen
 * and the app's state, then files the report through the server or opens
 * GitHub's prefilled form. GitHub itself is never reached: the form's tab is
 * answered here.
 */

async function waitForTimeline(page: Page) {
  await expect(page.locator('svg[data-timeline-canvas]')).toBeVisible()
  await expect(page.locator('g[data-timeline-mark="event"]')).toHaveCount(3)
}

/** How varied the screenshot's pixels are: a blank or failed capture is near zero. */
async function screenshotVariety(page: Page): Promise<{ width: number; height: number; distinct: number }> {
  return page.evaluate(async () => {
    const img = document.querySelector<HTMLImageElement>('img[alt="The page as it was when you opened this"]')
    if (!img) return { width: 0, height: 0, distinct: 0 }
    await img.decode()
    const canvas = document.createElement('canvas')
    canvas.width = img.naturalWidth
    canvas.height = img.naturalHeight
    const context = canvas.getContext('2d')!
    context.drawImage(img, 0, 0)
    const data = context.getImageData(0, 0, canvas.width, canvas.height).data
    const colours = new Set<number>()
    for (let i = 0; i < data.length; i += 4 * 97) colours.add((data[i]! << 16) | (data[i + 1]! << 8) | data[i + 2]!)
    return { width: img.naturalWidth, height: img.naturalHeight, distinct: colours.size }
  })
}

test.describe('feedback', () => {
  test('files a report through the server with a real screenshot and the app state', async ({ page }) => {
    const state = await installApiStub(page, { feedbackServerFiling: true })
    await page.goto('/')
    await waitForTimeline(page)

    await page.getByRole('button', { name: /Send feedback/ }).click()
    const dialog = page.getByRole('dialog', { name: 'Send feedback' })
    await expect(dialog).toBeVisible()

    // The picture is of the page, not of a blank or of the dialog.
    const shot = await screenshotVariety(page)
    expect(shot.width).toBeGreaterThan(600)
    expect(shot.distinct).toBeGreaterThan(20)

    await dialog.getByLabel('Title').fill('The timeline goes blank')
    await dialog.getByLabel('Details').fill('After zooming out twice.')
    await dialog.getByRole('button', { name: 'Send report' }).click()

    await expect(dialog.getByText('Thank you. Your report is issue #101.')).toBeVisible()
    await expect(dialog.getByRole('link', { name: 'See it on GitHub' })).toHaveAttribute(
      'href',
      'https://github.com/owner/repo/issues/101',
    )

    const [report] = state.feedbackReports
    expect(report).toMatchObject({ kind: 'bug', title: 'The timeline goes blank' })
    expect(String(report!.screenshot)).toMatch(/^data:image\/(png|jpeg);base64,/)
    expect(String(report!.body)).toContain('After zooming out twice.')
    expect(String(report!.body)).toContain('(timeline view)')
    expect(String(report!.body)).not.toMatch(/X-API-Key|Bearer /)

    await dialog.getByRole('button', { name: 'Done' }).click()
    await expect(dialog).toHaveCount(0)
    expect(state.unhandled).toEqual([])
  })

  test('opens GitHub’s prefilled form with the screenshot on the clipboard when the server does not file', async ({
    page,
    context,
    browserName,
  }) => {
    test.skip(browserName !== 'chromium', 'clipboard permissions are Chromium’s')
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    const opened: string[] = []
    await context.route('https://github.com/**', (route) => {
      opened.push(route.request().url())
      return route.fulfill({ status: 200, contentType: 'text/html', body: '<title>GitHub</title>' })
    })
    const state = await installApiStub(page)
    await page.goto('/')
    await waitForTimeline(page)

    await page.keyboard.press('Shift+I')
    const dialog = page.getByRole('dialog', { name: 'Send feedback' })
    await expect(dialog).toBeVisible()
    await dialog.getByLabel('An idea').check()
    await dialog.getByLabel('Title').fill('Let me pin an event')

    const tab = context.waitForEvent('page')
    await dialog.getByRole('link', { name: /Continue on GitHub/ }).click()
    await (await tab).waitForLoadState()

    const url = new URL(opened[0]!)
    expect(url.origin + url.pathname).toBe('https://github.com/owner/repo/issues/new')
    expect(url.searchParams.get('title')).toBe('Let me pin an event')
    expect(url.searchParams.get('labels')).toBe('enhancement,feedback')
    expect(url.searchParams.get('body')).toContain('### Screenshot')
    expect(opened[0]!.length).toBeLessThanOrEqual(7500)

    await expect(dialog.getByText(/screenshot is on your clipboard: paste it/)).toBeVisible()
    const types = await page.evaluate(async () => (await navigator.clipboard.read()).flatMap((item) => item.types))
    expect(types).toContain('image/png')

    expect(state.feedbackReports).toEqual([])
    expect(state.unhandled).toEqual([])
  })

  test('on a phone it is in the More sheet, and the sheet is not in the picture', async ({ browser }) => {
    // A plain viewport, not mobile emulation, which widens the layout viewport and hides overflow.
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' })
    const page = await context.newPage()
    const state = await installApiStub(page)
    await page.goto('/')
    await waitForTimeline(page)

    await expect(page.getByRole('button', { name: /Send feedback/ })).toHaveCount(0)
    await page.getByRole('button', { name: 'More' }).click()
    await page.getByRole('button', { name: /Send feedback/ }).click()

    const dialog = page.getByRole('dialog', { name: 'Send feedback' })
    await expect(dialog).toBeVisible()
    // The sheet closed before the capture, so it is the only dialog left.
    await expect(page.locator('[aria-modal="true"]')).toHaveCount(1)

    const shot = await screenshotVariety(page)
    expect(shot.distinct).toBeGreaterThan(10)

    // Nothing in the dialog reaches past the phone's edge.
    const overflow = await page.evaluate(() =>
      Array.from(document.querySelectorAll('[role="dialog"] *'))
        .filter((el) => el.getBoundingClientRect().right > window.innerWidth + 0.5)
        .map((el) => el.tagName),
    )
    expect(overflow).toEqual([])
    expect(state.unhandled).toEqual([])
    await context.close()
  })

  test('the help dialog leads to feedback, and the report shows the page, not help', async ({ page }) => {
    await installApiStub(page)
    await page.goto('/')
    await waitForTimeline(page)

    await page.keyboard.press('?')
    const help = page.getByRole('dialog', { name: 'Help & reference' })
    // Shift+I is listed among the shortcuts.
    await expect(help.getByText('Send feedback: report a problem or suggest an idea')).toBeVisible()
    await help.getByRole('button', { name: 'Send feedback' }).click()

    await expect(page.getByRole('dialog', { name: 'Send feedback' })).toBeVisible()
    await expect(help).toHaveCount(0)
  })

  test('the picture shows the view as scrolled, the window or a panel, not its top', async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 390, height: 520 }, serviceWorkers: 'block' })
    const page = await context.newPage()
    await installApiStub(page)
    await page.goto('/')
    await waitForTimeline(page)
    // A panel that scrolls inside the page, as the inspector and dialogs do:
    // html-to-image clones it unscrolled, so the capture has to show it scrolled.
    await page.evaluate(() => {
      const panel = document.createElement('div')
      panel.id = 'probe-panel'
      panel.style.cssText = 'height:200px;overflow:auto;margin:8px'
      panel.innerHTML =
        '<div style="height:200px;background:#c00"></div><div style="height:200px;background:#06c"></div>'
      document.getElementById('main-view')!.prepend(panel)
    })
    await page.waitForTimeout(600)

    const scrolled = await page.evaluate(() => {
      document.getElementById('probe-panel')!.scrollTop = 200
      window.scrollTo(0, 60)
      const rect = document.getElementById('probe-panel')!.getBoundingClientRect()
      return {
        panel: document.getElementById('probe-panel')!.scrollTop,
        window: window.scrollY,
        // The middle of the panel, where it is in the window.
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
      }
    })
    expect(scrolled.panel).toBe(200)
    expect(scrolled.window).toBe(60)
    expect(scrolled.y).toBeLessThan(400)

    await page.keyboard.press('Shift+I')
    const picture = page.getByRole('img', { name: 'The page as it was when you opened this' })
    await expect(picture).toBeVisible()
    const captured = (await picture.getAttribute('src'))!

    // Where the panel is in view (the window's scroll), the picture shows its
    // second, blue, block (the panel's scroll), not its first, red, one.
    const colour = await page.evaluate(async ({ src, x, y }) => {
      const img = new Image()
      img.src = src
      await img.decode()
      const canvas = document.createElement('canvas')
      canvas.width = img.naturalWidth
      canvas.height = img.naturalHeight
      const context = canvas.getContext('2d')!
      context.drawImage(img, 0, 0)
      const scale = img.naturalWidth / window.innerWidth
      const [r, g, b] = context.getImageData(Math.round(x * scale), Math.round(y * scale), 1, 1).data
      return { r, g, b }
    }, { src: captured, x: scrolled.x, y: scrolled.y })
    expect(colour.b).toBeGreaterThan(150)
    expect(colour.r).toBeLessThan(80)

    // And the page is put back as it was.
    expect(await page.evaluate(() => [document.getElementById('probe-panel')!.scrollTop, window.scrollY])).toEqual([200, 60])
    await context.close()
  })
})
