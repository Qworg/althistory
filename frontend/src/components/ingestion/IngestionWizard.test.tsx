/**
 * IngestionWizard tests (Req 19).
 *
 * The API client is mocked at the method boundary so the assertions can read
 * the exact approve payload. Criteria 4 and 5 have dedicated tests that inspect
 * `apiClient.ingest.approve`'s arguments: criterion 5 asserts the sent id array
 * contains only the checked rows, and criterion 4 asserts the edited field value
 * is what is sent.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, within, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe } from 'vitest-axe'
import { renderWithProviders } from '@/test/utils'
import { IngestionWizard } from './IngestionWizard'
import { apiClient } from '@/services/api'
import type { ApproveIngestionRequest, ImportResult, IngestResponse } from '@/types'

vi.mock('@/services/api', () => ({
  apiClient: {
    ingest: {
      text: vi.fn(),
      url: vi.fn(),
      wikidata: vi.fn(),
      approve: vi.fn(),
      deleteJob: vi.fn(),
    },
  },
  APIError: class APIError extends Error {
    constructor(message: string) {
      super(message)
      this.name = 'APIError'
    }
  },
}))

const mockedText = vi.mocked(apiClient.ingest.text)
const mockedUrl = vi.mocked(apiClient.ingest.url)
const mockedWikidata = vi.mocked(apiClient.ingest.wikidata)
const mockedApprove = vi.mocked(apiClient.ingest.approve)
const mockedDeleteJob = vi.mocked(apiClient.ingest.deleteJob)

type User = ReturnType<typeof userEvent.setup>

function makePreview(): IngestResponse {
  return {
    jobId: 'job-1',
    status: 'review',
    estimatedPages: 1,
    validationIssues: [
      {
        entityTempId: 'evt-2',
        entityType: 'event',
        severity: 'warning',
        message: 'Low confidence',
      },
    ],
    extraction: {
      overallConfidence: 0.8,
      sources: [],
      events: [
        {
          tempId: 'evt-1',
          description: 'Battle of Hastings',
          actor: 'Harold',
          target: 'William',
          timestamp: '1066-10-14',
          confidence: 0.9,
          source: { type: 'wikipedia', extractedAt: '2024-01-01T00:00:00Z' },
          selected: true,
          edited: false,
        },
        {
          tempId: 'evt-2',
          description: 'Norman conquest begins',
          actor: 'William',
          target: 'England',
          timestamp: '1066-12-25',
          confidence: 0.6,
          source: { type: 'wikipedia', extractedAt: '2024-01-01T00:00:00Z' },
          selected: true,
          edited: false,
        },
      ],
      arcs: [
        {
          tempId: 'arc-1',
          name: 'Norman Conquest',
          description: 'The Norman conquest of England',
          start_time: '1066-10-14',
          end_time: '1072-01-01',
          level: 1,
          confidence: 0.7,
          source: { type: 'wikipedia', extractedAt: '2024-01-01T00:00:00Z' },
          selected: true,
          edited: false,
        },
      ],
      relationships: [],
    },
  }
}

/** A preview with relationships and an error on one of them. */
function makePreviewWithRelationships(): IngestResponse {
  const preview = makePreview()
  return {
    ...preview,
    validationIssues: [
      ...preview.validationIssues,
      {
        entityTempId: 'rel-1',
        entityType: 'relationship',
        severity: 'error',
        message: 'Effect precedes cause',
      },
    ],
    extraction: {
      ...preview.extraction,
      relationships: [
        {
          tempId: 'rel-1',
          causeEventTempId: 'evt-2',
          effectEventTempId: 'evt-1',
          weight: 0.7,
          confidence: 0.8,
          reasoning: 'Ordering looks reversed',
          source: { type: 'wikipedia', extractedAt: '2024-01-01T00:00:00Z' },
          selected: true,
        },
      ],
    },
  }
}

function makeImportResult(): ImportResult {
  return {
    success: true,
    graphId: 'graph-1',
    graphVersion: 2,
    imported: { events: 1, arcs: 1, relationships: 0, pressures: 0 },
    skipped: { events: 0, arcs: 0, relationships: 0, pressures: 0 },
    deleted: { events: 0, arcs: 0, relationships: 0, pressures: 0 },
    errors: [],
    warnings: [],
  }
}

/** Drives the wizard through the Text tab into the review step. */
async function extractFromText(user: User): Promise<void> {
  await user.click(screen.getByRole('tab', { name: 'Text' }))
  const panel = screen.getByRole('tabpanel')
  await user.type(
    within(panel).getByLabelText(/Text to extract/),
    'The Battle of Hastings was fought in 1066.'
  )
  await user.click(screen.getByRole('button', { name: /Extract events/ }))
  await screen.findByLabelText('Select event evt-1')
}

function firstApproveCall(): [string, ApproveIngestionRequest] {
  const call = mockedApprove.mock.calls[0]
  if (!call) throw new Error('apiClient.ingest.approve was not called')
  return call
}

describe('IngestionWizard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders tabs for Wikipedia, Wikidata and Text sources (Req 19.1)', () => {
    renderWithProviders(<IngestionWizard isOpen onClose={vi.fn()} />)

    expect(screen.getByRole('tab', { name: 'Wikipedia' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: 'Wikidata' })).toHaveAttribute('aria-selected', 'false')
    expect(screen.getByRole('tab', { name: 'Text' })).toHaveAttribute('aria-selected', 'false')
  })

  it('configures the Wikipedia URL and link-following options (Req 19.2)', async () => {
    const user = userEvent.setup()
    mockedUrl.mockResolvedValue(makePreview())

    renderWithProviders(<IngestionWizard isOpen onClose={vi.fn()} />)

    // The link-following inputs only exist once following is enabled.
    expect(screen.queryByLabelText(/Link depth/)).not.toBeInTheDocument()

    await user.type(
      screen.getByLabelText(/Wikipedia URL/),
      'https://en.wikipedia.org/wiki/Battle_of_Hastings'
    )
    await user.click(screen.getByLabelText(/Follow links/))

    const depth = screen.getByLabelText(/Link depth/)
    const filter = screen.getByLabelText(/Link filter/)
    const maxPages = screen.getByLabelText(/Max pages/)
    await user.clear(depth)
    await user.type(depth, '2')
    await user.type(filter, 'Battle.*')
    await user.clear(maxPages)
    await user.type(maxPages, '5')

    await user.click(screen.getByRole('button', { name: /Extract events/ }))

    await waitFor(() => expect(mockedUrl).toHaveBeenCalledTimes(1))
    expect(mockedUrl).toHaveBeenCalledWith({
      url: 'https://en.wikipedia.org/wiki/Battle_of_Hastings',
      strategy: 'wikipedia',
      options: { followLinks: true, linkDepth: 2, maxPages: 5, linkFilter: 'Battle.*' },
    })
  })

  it('submits the Wikidata source when its tab is selected (Req 19.1)', async () => {
    const user = userEvent.setup()
    mockedWikidata.mockResolvedValue(makePreview())

    renderWithProviders(<IngestionWizard isOpen onClose={vi.fn()} />)
    await user.click(screen.getByRole('tab', { name: 'Wikidata' }))

    const panel = screen.getByRole('tabpanel')
    await user.selectOptions(within(panel).getByLabelText(/Query type/), 'person-timeline')
    await user.type(within(panel).getByLabelText(/Person Wikidata ID/), 'Q42')
    await user.click(screen.getByRole('button', { name: /Extract events/ }))

    await waitFor(() => expect(mockedWikidata).toHaveBeenCalledTimes(1))
    expect(mockedWikidata).toHaveBeenCalledWith({
      queryType: 'person-timeline',
      parameters: { person: 'Q42' },
      limit: 25,
    })
  })

  it('shows extracted entities in an editable table with checkboxes (Req 19.3)', async () => {
    const user = userEvent.setup()
    mockedText.mockResolvedValue(makePreview())

    renderWithProviders(<IngestionWizard isOpen onClose={vi.fn()} />)
    await extractFromText(user)

    // A row starts ticked only at the preselect threshold (0.7): evt-2 (0.6)
    // waits for the reviewer.
    expect(screen.getByLabelText('Select event evt-1')).toBeChecked()
    expect(screen.getByLabelText('Select event evt-2')).not.toBeChecked()
    expect(screen.getByLabelText('Select arc arc-1')).toBeChecked()

    const description = screen.getByLabelText('Description for event evt-1')
    expect(description).toHaveValue('Battle of Hastings')
    await user.clear(description)
    await user.type(description, 'Changed in review')
    expect(description).toHaveValue('Changed in review')
  })

  it('sends the edited field value on approve (Req 19.4)', async () => {
    const user = userEvent.setup()
    mockedText.mockResolvedValue(makePreview())
    mockedApprove.mockResolvedValue(makeImportResult())

    renderWithProviders(<IngestionWizard isOpen onClose={vi.fn()} />)
    await extractFromText(user)

    const description = screen.getByLabelText('Description for event evt-1')
    await user.clear(description)
    await user.type(description, 'Edited before import')

    await user.click(screen.getByRole('button', { name: /Import selected/ }))
    await waitFor(() => expect(mockedApprove).toHaveBeenCalledTimes(1))

    const [jobId, request] = firstApproveCall()
    expect(jobId).toBe('job-1')
    // The edit is what gets sent: the field the reviewer changed carries the new
    // value, not the extractor's original text.
    expect(request.edits?.['evt-1']?.description).toBe('Edited before import')
  })

  it('approves only the checked entities (Req 19.5)', async () => {
    const user = userEvent.setup()
    mockedText.mockResolvedValue(makePreview())
    mockedApprove.mockResolvedValue(makeImportResult())

    renderWithProviders(<IngestionWizard isOpen onClose={vi.fn()} />)
    await extractFromText(user)

    // evt-2 (0.6) starts unticked and stays so: only evt-1 is approved.
    expect(screen.getByLabelText('Select event evt-2')).not.toBeChecked()

    await user.click(screen.getByRole('button', { name: /Import selected/ }))
    await waitFor(() => expect(mockedApprove).toHaveBeenCalledTimes(1))

    const [, request] = firstApproveCall()
    expect(request.approvedEventIds).toEqual(['evt-1'])
    expect(request.approvedEventIds).not.toContain('evt-2')
    // The still-checked arc is approved.
    expect(request.approvedArcIds).toEqual(['arc-1'])
  })

  it('flags an unticked whole entity type explicitly, defeating the backend empty-array fallback (Req 19.5)', async () => {
    const user = userEvent.setup()
    mockedText.mockResolvedValue(makePreview())
    mockedApprove.mockResolvedValue(makeImportResult())

    renderWithProviders(<IngestionWizard isOpen onClose={vi.fn()} />)
    await extractFromText(user)

    // Untick every event but keep the arc checked, so the approve button is
    // enabled while `approvedEventIds` will be empty. The backend maps an empty
    // array to "unspecified" and falls back to each event's stored `selected`
    // flag, so the request must also carry `selected: false` for both events.
    // evt-2 starts unticked (below the preselect threshold); untick evt-1.
    await user.click(screen.getByLabelText('Select event evt-1'))

    await user.click(screen.getByRole('button', { name: /Import selected/ }))
    await waitFor(() => expect(mockedApprove).toHaveBeenCalledTimes(1))

    const [, request] = firstApproveCall()
    expect(request.approvedEventIds).toEqual([])
    expect(request.edits?.['evt-1']?.selected).toBe(false)
    expect(request.edits?.['evt-2']?.selected).toBe(false)
    expect(request.approvedArcIds).toEqual(['arc-1'])
  })

  it('does not render when closed', () => {
    renderWithProviders(<IngestionWizard isOpen={false} onClose={vi.fn()} />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('discards the review job through the API when Discard is used', async () => {
    const user = userEvent.setup()
    mockedText.mockResolvedValue(makePreview())
    mockedDeleteJob.mockResolvedValue({ success: true })
    const onClose = vi.fn()

    renderWithProviders(<IngestionWizard isOpen onClose={onClose} />)
    await extractFromText(user)

    await user.click(screen.getByRole('button', { name: /Discard/ }))

    await waitFor(() => expect(mockedDeleteJob).toHaveBeenCalledWith('job-1'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('asks before Escape throws away a review with extracted rows and edits', async () => {
    const user = userEvent.setup()
    mockedText.mockResolvedValue(makePreview())
    mockedDeleteJob.mockResolvedValue({ success: true })
    const onClose = vi.fn()

    renderWithProviders(<IngestionWizard isOpen onClose={onClose} />)
    await extractFromText(user)
    await user.type(screen.getByLabelText('Description for event evt-1'), ' (edited)')

    await user.keyboard('{Escape}')

    const confirm = screen.getByRole('dialog', { name: 'Discard this review?' })
    expect(confirm).toHaveTextContent('Discard 2 extracted events, 1 arc and your edits?')
    expect(onClose).not.toHaveBeenCalled()
    // The question is read with the focused button.
    const keep = within(confirm).getByRole('button', { name: 'Keep reviewing' })
    expect(keep).toHaveFocus()
    expect(document.getElementById(keep.getAttribute('aria-describedby')!)).toHaveTextContent(/Nothing has been imported yet/)

    // Escape on the question closes only the question; the review is intact.
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: 'Discard this review?' })).not.toBeInTheDocument()
    expect((screen.getByLabelText('Description for event evt-1') as HTMLTextAreaElement).value).toContain(
      '(edited)'
    )
    expect(onClose).not.toHaveBeenCalled()

    // Confirming discards the job and closes.
    await user.click(screen.getByRole('button', { name: 'Close modal' }))
    await user.click(within(screen.getByRole('dialog', { name: 'Discard this review?' })).getByRole('button', { name: 'Discard review' }))
    await waitFor(() => expect(mockedDeleteJob).toHaveBeenCalledWith('job-1'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('closes the source step without asking', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()

    renderWithProviders(<IngestionWizard isOpen onClose={onClose} />)
    await user.keyboard('{Escape}')

    expect(onClose).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('dialog', { name: 'Discard this review?' })).not.toBeInTheDocument()
  })

  it('keeps one title across sources (the tab names the source) and puts "Extract events" in the footer', async () => {
    const user = userEvent.setup()
    renderWithProviders(<IngestionWizard isOpen onClose={vi.fn()} />)

    expect(screen.getByRole('dialog', { name: 'Bring in history' })).toBeInTheDocument()
    await user.click(screen.getByRole('tab', { name: 'Wikidata' }))
    expect(screen.getByRole('dialog', { name: 'Bring in history' })).toBeInTheDocument()
    await user.click(screen.getByRole('tab', { name: 'Text' }))
    expect(screen.getByRole('dialog', { name: 'Bring in history' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Text' })).toHaveAttribute('aria-selected', 'true')

    // One primary action, outside the tab panel, enabled once there is text.
    const extract = screen.getByRole('button', { name: 'Extract events' })
    expect(within(screen.getByRole('tabpanel')).queryByRole('button', { name: /Extract/ })).not.toBeInTheDocument()
    expect(extract).toBeDisabled()
    await user.type(screen.getByLabelText(/Text to extract/), 'Something happened in 1851.')
    expect(extract).toBeEnabled()
    expect(screen.getByLabelText(/Text to extract/)).toHaveAttribute('placeholder', expect.stringMatching(/^For example: /))
  })

  it('reports the import result to onIngestComplete after approval', async () => {
    const user = userEvent.setup()
    const importResult = makeImportResult()
    mockedText.mockResolvedValue(makePreview())
    mockedApprove.mockResolvedValue(importResult)
    const onIngestComplete = vi.fn()

    renderWithProviders(
      <IngestionWizard isOpen onClose={vi.fn()} onIngestComplete={onIngestComplete} />
    )
    await extractFromText(user)

    await user.click(screen.getByRole('button', { name: /Import selected/ }))

    await waitFor(() => expect(onIngestComplete).toHaveBeenCalledWith(importResult))
  })

  it('source step has no axe violations', async () => {
    const { container } = renderWithProviders(<IngestionWizard isOpen onClose={vi.fn()} />)
    expect(await axe(container)).toHaveNoViolations()
  })

  it('review step has no axe violations', async () => {
    const user = userEvent.setup()
    mockedText.mockResolvedValue(makePreview())

    const { container } = renderWithProviders(<IngestionWizard isOpen onClose={vi.fn()} />)
    await extractFromText(user)

    expect(await axe(container)).toHaveNoViolations()
  })

  it('validates Wikipedia URLs and blocks non-Wikipedia domains', async () => {
    const user = userEvent.setup()
    renderWithProviders(<IngestionWizard isOpen onClose={vi.fn()} />)

    await user.type(
      screen.getByLabelText(/Wikipedia URL/),
      'https://example.com/not-wikipedia'
    )
    expect(screen.getByRole('alert')).toHaveTextContent(/valid Wikipedia article URL/i)
    expect(screen.getByRole('button', { name: /Extract events/ })).toBeDisabled()
  })

  it('sorts rows in EntityReviewTable when column headers are clicked', async () => {
    const user = userEvent.setup()
    mockedText.mockResolvedValue(makePreview())

    renderWithProviders(<IngestionWizard isOpen onClose={vi.fn()} />)
    await extractFromText(user)

    const descHeaders = screen.getAllByRole('button', { name: /Description/i })
    await user.click(descHeaders[0]!)
    await user.click(descHeaders[0]!)

    expect(screen.getByLabelText('Description for event evt-1')).toBeInTheDocument()
  })

  it('names relationship events and shows the relationship row error in the table', async () => {
    const user = userEvent.setup()
    mockedText.mockResolvedValue(makePreviewWithRelationships())

    renderWithProviders(<IngestionWizard isOpen onClose={vi.fn()} />)
    await extractFromText(user)

    const relationshipCheckbox = screen.getByLabelText('Select relationship rel-1')
    const row = relationshipCheckbox.closest('tr')!
    expect(within(row).getByText('Norman conquest begins (William → England)')).toBeInTheDocument()
    expect(within(row).getByText('Battle of Hastings (Harold → William)')).toBeInTheDocument()
    expect(row).toHaveAttribute('data-invalid', 'true')
    expect(within(row).getByText('Effect precedes cause')).toBeInTheDocument()
  })

  it('lists validation issues by readable label and jumps to the row', async () => {
    const user = userEvent.setup()
    mockedText.mockResolvedValue(makePreviewWithRelationships())

    renderWithProviders(<IngestionWizard isOpen onClose={vi.fn()} />)
    await extractFromText(user)

    const eventIssue = screen.getByRole('button', {
      name: /Event “Norman conquest begins”: Low confidence/,
    })
    const relationshipIssue = screen.getByRole('button', {
      name: /Relationship “Norman conquest begins → Battle of Hastings”: Effect precedes cause/,
    })
    expect(screen.queryByText(/event evt-2:/)).not.toBeInTheDocument()

    await user.click(eventIssue)
    expect(screen.getByLabelText('Description for event evt-2')).toHaveFocus()

    await user.click(relationshipIssue)
    expect(screen.getByLabelText('Select relationship rel-1')).toHaveFocus()
  })

  it('selects events by confidence threshold', async () => {
    const user = userEvent.setup()
    mockedText.mockResolvedValue(makePreview())

    renderWithProviders(<IngestionWizard isOpen onClose={vi.fn()} />)
    await extractFromText(user)

    // Default threshold 0.7: evt-1 (0.9) stays, evt-2 (0.6) is deselected.
    await user.click(screen.getByRole('button', { name: /^Select 1 events with confidence/ }))

    expect(screen.getByLabelText('Select event evt-1')).toBeChecked()
    expect(screen.getByLabelText('Select event evt-2')).not.toBeChecked()
    expect(screen.getByRole('heading', { name: 'Events (1/2 selected)' })).toBeInTheDocument()
    // Other collections are untouched.
    expect(screen.getByLabelText('Select arc arc-1')).toBeChecked()
  })

  it('shows where the user is in the ingestion steps', async () => {
    const user = userEvent.setup()
    mockedText.mockResolvedValue(makePreview())

    renderWithProviders(<IngestionWizard isOpen onClose={vi.fn()} />)

    const progress = screen.getByRole('list', { name: 'Ingestion progress' })
    const current = () => progress.querySelector('[aria-current="step"]')
    expect(current()).toHaveTextContent('Source')

    await extractFromText(user)
    expect(current()).toHaveTextContent('Review')
  })
})
