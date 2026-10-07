import { test, expect } from '@playwright/test'
import { installApiStub } from './support/api'

/**
 * Flow 3: open the ingestion wizard (Req 19) and reach the review table.
 *
 * The wizard is new and, until this suite, had never run in a browser: the unit
 * suite imports it and mocks the API client, so it never proved that the modal,
 * the source form, the POST and the review table are wired together. This test
 * drives the whole path and then completes the import to exercise the approve
 * endpoint too.
 */
test.describe('ingestion wizard', () => {
  test('opens from the toolbar, extracts, reviews and imports entities', async ({ page }) => {
    const state = await installApiStub(page)

    await page.goto('/')
    await expect(page.getByText('3 events, 1 arcs')).toBeVisible()

    await page.getByRole('button', { name: 'Ingest' }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByRole('heading', { name: 'Ingest from Web' })).toBeVisible()

    await expect(dialog.getByRole('tab', { name: 'Wikipedia' })).toHaveAttribute(
      'aria-selected',
      'true',
    )

    await dialog
      .getByLabel(/Wikipedia URL/)
      .fill('https://en.wikipedia.org/wiki/Battle_of_Hastings')
    await dialog.getByRole('button', { name: /Extract Entities/ }).click()

    // Review step: the extraction is rendered as an editable table.
    await expect(dialog.getByRole('heading', { name: 'Events (2/2 selected)' })).toBeVisible()
    await expect(dialog.getByRole('heading', { name: 'Arcs (1/1 selected)' })).toBeVisible()
    await expect(dialog.getByLabel('Select event evt-1')).toBeChecked()
    await expect(dialog.getByLabel('Description for event evt-1')).toHaveValue('Battle of Hastings')
    await expect(dialog.getByLabel('Actor for event evt-1')).toHaveValue('Harold Godwinson')
    await expect(dialog.getByText('1 validation issue')).toBeVisible()

    expect(state.ingestedVia).toEqual(['/ingest/url'])

    // Complete the import; the approve payload must carry the selection.
    await dialog.getByRole('button', { name: /Import Selected \(3\)/ }).click()
    await expect(dialog.getByRole('heading', { name: 'Import complete' })).toBeVisible()
    await expect(
      dialog.getByText('Imported 2 events, 1 arcs and 0 relationships.'),
    ).toBeVisible()

    expect(state.approveCalls).toHaveLength(1)
    expect(state.approveCalls[0]).toMatchObject({
      approvedEventIds: ['evt-1', 'evt-2'],
      approvedArcIds: ['arc-1'],
    })
    expect(state.unhandled).toEqual([])
  })
})
