import { test, expect, type Page } from '@playwright/test'
import { installApiStub } from './support/api'

/**
 * Visual-regression baselines (Playwright `toHaveScreenshot`).
 *
 * READ THIS BEFORE TRUSTING A GREEN RUN
 * -------------------------------------
 * A screenshot baseline is a picture of one browser build rendering with one
 * OS font stack. The snapshot filename Playwright generates embeds that pair
 * (`*-chromium-linux.png`), so these baselines are only meaningful for the
 * chromium build running on Linux -- which is what the single project in
 * `playwright.config.ts` selects. On Windows/macOS, or a different chromium
 * build, the fonts and rasteriser differ and the comparison will likely fail
 * even when the UI is unchanged. That is a property of screenshot testing, not
 * a bug in the app, and it is why:
 *   - the covered views are deliberately few (the timeline and the review
 *     step of the ingestion wizard), and
 *   - the CI e2e job excludes the `@visual` tag (`--grep-invert @visual`);
 *     visual checks are advisory and are run locally.
 *
 * A handful of views is NOT visual coverage of the app. It locks layout for two
 * screens at one viewport; everything else can still regress visually.
 *
 * REGENERATING
 * ------------
 * `npm run test:update-snapshots` (in `e2e/`) rewrites the baselines from the
 * current machine. Only do that after reviewing the diff, and never to make a
 * red run green without understanding why it changed.
 */

/** Remove focus so a focus ring or text caret cannot perturb the image. */
async function blurActiveElement(page: Page): Promise<void> {
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur()
    }
  })
}

test.describe('visual regression', () => {
  test('timeline view @visual', async ({ page }) => {
    await installApiStub(page)
    await page.goto('/')

    await expect(page.getByText('3 events, 1 arcs')).toBeVisible()
    await expect(page.locator('g[data-timeline-mark="event"]')).toHaveCount(3)

    // The filter panel is open by default and is a flex sibling of the main
    // pane, so it narrows (and partly covers) the timeline. Hide it so the
    // baseline shows the whole timeline rather than the panel over it.
    await page.getByRole('button', { name: 'Hide Filters' }).click()
    await expect(page.getByRole('button', { name: 'Show Filters' })).toBeVisible()

    const svg = page.locator('svg[role="img"]')
    await expect(svg).toBeVisible()
    await blurActiveElement(page)

    await expect(svg).toHaveScreenshot('timeline-view.png')
  })

  test('ingestion wizard review table @visual', async ({ page }) => {
    await installApiStub(page)
    await page.goto('/')
    await expect(page.getByRole('heading', { name: 'Timeline View' })).toBeVisible()

    await page.getByRole('button', { name: 'Ingest' }).click()
    const dialog = page.getByRole('dialog')
    await dialog
      .getByLabel(/Wikipedia URL/)
      .fill('https://en.wikipedia.org/wiki/Battle_of_Hastings')
    await dialog.getByRole('button', { name: /Extract Entities/ }).click()
    await expect(dialog.getByRole('heading', { name: 'Events (2/2 selected)' })).toBeVisible()

    await blurActiveElement(page)
    await expect(dialog).toHaveScreenshot('ingestion-review.png')
  })
})
