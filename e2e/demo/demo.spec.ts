import { test, expect, type Page } from '@playwright/test'

/**
 * The GitHub Pages demo: the real frontend, with its API answered in the
 * browser from a recording of the real backend (frontend/src/demo).
 */

const COUNTS = '19 events · 4 arcs · 24 links'

/** Fails the test on any request that leaves the page's own origin. */
function forbidNetwork(page: Page, baseURL: string): string[] {
  const outside: string[] = []
  page.on('request', (request) => {
    const url = request.url()
    if (!url.startsWith(baseURL) && !url.startsWith('data:')) outside.push(url)
  })
  return outside
}

test('boots with the seeded history and nothing leaves the page', async ({ page, baseURL }) => {
  const outside = forbidNetwork(page, baseURL!)
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))

  await page.goto('./')
  await expect(page.getByRole('region', { name: 'About this demo' })).toBeVisible()
  await expect(page.getByText(COUNTS)).toBeVisible()
  await expect(page.locator('g[data-timeline-mark="event"]')).toHaveCount(19)

  for (const view of ['causal-graph', 'actor-perspective', 'timeline']) {
    await page.goto(`./#/${view}`)
    await expect(page.getByRole('main')).toBeVisible()
  }
  await expect(page.getByText(COUNTS)).toBeVisible()
  expect(outside).toEqual([])
  expect(errors).toEqual([])
})

test('an edit lasts for the tab, and Start over undoes it', async ({ page }) => {
  await page.goto('./')
  await expect(page.getByText(COUNTS)).toBeVisible()

  await page.getByRole('button', { name: 'Create Event' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel(/Description/).fill('The engines reach Calcutta')
  await dialog.getByLabel(/Actor/).fill('East India Company')
  await dialog.getByLabel(/Target/).fill('Calcutta')
  await dialog.getByLabel(/^Date/).fill('1857-03-01 09:00')
  await dialog.getByRole('button', { name: 'Save' }).click()
  await expect(dialog).toHaveCount(0)

  await expect(page.getByText('20 events · 4 arcs · 24 links')).toBeVisible()
  await expect(page.locator('g[data-timeline-mark="event"][aria-label*="The engines reach Calcutta"]')).toBeVisible()

  await page.reload()
  await expect(page.getByText('20 events · 4 arcs · 24 links')).toBeVisible()

  // Start over is a fresh visit from the landing page: the edit is gone, and
  // the demo opens on the branch.
  await page.getByRole('button', { name: 'Start over' }).click()
  await expect(page.getByText('21 events · 4 arcs · 25 links')).toBeVisible()
  await expect(page.locator('g[data-timeline-mark="event"][aria-label*="The engines reach Calcutta"]')).toHaveCount(0)
})

test('the landing page link opens on the branch', async ({ page }) => {
  await page.goto('./?start=branch')
  await expect(page.getByText('21 events · 4 arcs · 25 links')).toBeVisible()
  await expect(page.getByText(/Branch of\s*The Engine Age/)).toBeVisible()
  // The parameter is consumed, so a reload keeps whatever the visitor chose.
  expect(new URL(page.url()).searchParams.has('start')).toBe(false)
})

test('a link from the landing page can open a view of the branch', async ({ page }) => {
  await page.goto('./?start=branch#/causal-graph')
  await expect(page).toHaveURL(/#\/causal-graph$/)
  await expect(page.getByRole('main')).toBeVisible()
  await page.goto('./#/timeline')
  await expect(page.getByText('21 events · 4 arcs · 25 links')).toBeVisible()
})

test('a link can switch graphs in a tab that already has edits', async ({ page }) => {
  await page.goto('./?start=branch')
  await expect(page.getByText('21 events · 4 arcs · 25 links')).toBeVisible()
  await page.goto('./?start=main')
  await expect(page.getByText(COUNTS)).toBeVisible()
})

test('on a phone, a branch opens at its divergence', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })
  const phone = await context.newPage()
  await phone.goto('./?start=branch')
  await expect(phone.getByText(/21 events/).first()).toBeVisible()
  // The divergence (12 Jul 1860) is on screen, and the first event (1834) is not.
  const inView = async (label: RegExp) => {
    const box = await phone.locator('g[data-timeline-mark="event"]').evaluateAll(
      (marks, source) => {
        const pattern = new RegExp(source)
        const mark = marks.find((m) => pattern.test(m.getAttribute('aria-label') ?? ''))
        if (!mark) return null
        const r = mark.getBoundingClientRect()
        return { left: r.left, right: r.right }
      },
      label.source
    )
    return box !== null && box.right > 0 && box.left < 390
  }
  await expect.poll(() => inView(/Parliament bans/)).toBe(true)
  expect(await inView(/Babbage completes the full design/)).toBe(false)
  await context.close()
})

test('a link can open the demo on one event, selected', async ({ page }) => {
  // The landing page's hero cards link this way.
  await page.goto('./?start=main#/timeline?event=event_noteg')
  const inspector = page.getByRole('region', { name: 'Selection inspector' })
  await expect(inspector).toContainText('Ada Lovelace publishes Note G')
  await expect(page).toHaveURL(/#\/timeline$/)
})

test('forks the history in the browser', async ({ page }) => {
  await page.goto('./')
  await expect(page.getByText(COUNTS)).toBeVisible()

  await page.getByRole('button', { name: 'Graph', exact: true }).first().click()
  await page.getByRole('menuitem', { name: /^Branch or copy/ }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Branch name').fill('The Engine Stays Secret')
  await dialog.getByRole('button', { name: 'Create branch' }).click()
  await dialog.getByRole('button', { name: 'Switch to branch' }).click()
  await expect(page.getByText(/Branch of\s*The Engine Age/)).toBeVisible()
  await expect(page.getByText(COUNTS)).toBeVisible()

  // Change the branch, and it diverges from the history it came from.
  await page.getByRole('button', { name: 'Create Event' }).click()
  const create = page.getByRole('dialog')
  await create.getByLabel(/Description/).fill('Babbage burns the plans')
  await create.getByLabel(/Actor/).fill('Charles Babbage')
  await create.getByLabel(/Target/).fill('Analytical Engine')
  await create.getByLabel(/^Date/).fill('1842-02-01 09:00')
  await create.getByRole('button', { name: 'Save' }).click()
  await expect(page.getByText('20 events · 4 arcs · 24 links')).toBeVisible()
  await expect(page.getByText(/diverges/).first()).toBeVisible()
})

test('switches to the branch', async ({ page }) => {
  await page.goto('./')
  await expect(page.getByText(COUNTS)).toBeVisible()
  await page.getByRole('button', { name: /The Engine Age/ }).first().click()
  await page.getByText('Clerks Prevail').first().click()
  await expect(page.getByText('21 events · 4 arcs · 25 links')).toBeVisible()
  await expect(page.getByText(/Branch of\s*The Engine Age/)).toBeVisible()
})

test('a feature that needs the server says so', async ({ page }) => {
  await page.goto('./')
  await expect(page.getByText(COUNTS)).toBeVisible()
  await page.getByRole('button', { name: 'Bring in history', exact: true }).click()
  await page.getByRole('menuitem', { name: /^Extract from text or Wikipedia/ }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('tab', { name: 'Text' }).click()
  await dialog.getByRole('textbox').first().fill('On 14 February 1870, the Royal Society honoured Ada Lovelace with the Copley Medal.')
  await dialog.getByRole('button', { name: /Extract/ }).click()
  await expect(dialog.getByText(/needs the althistory server/)).toBeVisible()
})

/* -------------------------------------------------------- invented world --- */

const WORLD_COUNTS = '9 events · 3 arcs · 9 links'

/** The labels on the timeline's time axis. */
const axisLabels = (page: Page) =>
  page.locator('svg text.font-mono-code').evaluateAll((texts) => texts.map((t) => t.textContent ?? ''))

test('a link opens on the invented world, in its own years', async ({ page }) => {
  await page.goto('./?start=world')
  await expect(page.getByText(WORLD_COUNTS)).toBeVisible()
  await expect(page.getByRole('button', { name: /^Vael/ }).first()).toBeVisible()
  expect(new URL(page.url()).searchParams.has('start')).toBe(false)

  // Stored 1000-03-04 is the world's year 1; stored 1162 is 163 AR.
  const marks = page.locator('g[data-timeline-mark="event"]')
  await expect(marks).toHaveCount(9)
  await expect(page.locator('g[data-timeline-mark="event"][aria-label*="the first salt-king"]')).toHaveAttribute('aria-label', /at Mar 4, 1 AR\b/)
  await expect(page.locator('g[data-timeline-mark="event"][aria-label*="Siege of Hollow Isle"]')).toHaveAttribute('aria-label', /at Sep 1, 163 AR\b/)
  // The axis counts in the same years, and never shows a Gregorian one.
  await expect.poll(async () => (await axisLabels(page)).filter((l) => /^\d+ AR$/.test(l)).length).toBeGreaterThan(2)
  expect((await axisLabels(page)).filter((l) => /^1\d{3}$/.test(l))).toEqual([])

  // An event's details are in world years too.
  await page.locator('g[data-timeline-mark="event"][aria-label*="the first salt-king"] .event-marker').click({ force: true })
  const inspector = page.getByRole('region', { name: 'Selection inspector' })
  await expect(inspector).toContainText('Mar 4, 1 AR')

  // The causal graph opens on the world too (its labels are drawn on a canvas).
  await page.goto('./#/causal-graph')
  await expect(page.getByText('9 events · 9 links')).toBeVisible()
})

test('the graph picker shows the world in its own years', async ({ page }) => {
  await page.goto('./?start=main')
  await expect(page.getByText(COUNTS)).toBeVisible()
  await page.getByRole('button', { name: /The Engine Age/ }).first().click()
  const vael = page.getByRole('button', { name: /^Vael/ })
  await expect(vael).toContainText('1 AR–173 AR')
  await vael.click()
  await expect(page.getByText(WORLD_COUNTS)).toBeVisible()
  await expect(page.locator('g[data-timeline-mark="event"][aria-label*="Siege of Hollow Isle"]')).toHaveAttribute('aria-label', /163 AR/)
})

test('a branch of the world keeps its calendar', async ({ page }) => {
  await page.goto('./?start=world')
  await expect(page.getByText(WORLD_COUNTS)).toBeVisible()

  await page.getByRole('button', { name: 'Graph', exact: true }).first().click()
  await page.getByRole('menuitem', { name: /^Branch or copy/ }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Branch name').fill('The Last King Lives')
  await dialog.getByRole('button', { name: 'Create branch' }).click()
  await dialog.getByRole('button', { name: 'Switch to branch' }).click()
  await expect(page.getByText(/Branch of\s*Vael/)).toBeVisible()
  await expect(page.getByText(WORLD_COUNTS)).toBeVisible()
  await expect(page.locator('g[data-timeline-mark="event"][aria-label*="Siege of Hollow Isle"]')).toHaveAttribute('aria-label', /at Sep 1, 163 AR\b/)
  await expect.poll(async () => (await axisLabels(page)).filter((l) => /^\d+ AR$/.test(l)).length).toBeGreaterThan(2)

  // And after a reload, from the demo's saved state.
  await page.reload()
  await expect(page.getByText(/Branch of\s*Vael/)).toBeVisible()
  await expect(page.locator('g[data-timeline-mark="event"][aria-label*="the first salt-king"]')).toHaveAttribute('aria-label', /at Mar 4, 1 AR\b/)
})
