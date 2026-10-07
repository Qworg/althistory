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
  await user.click(within(panel).getByRole('button', { name: /Extract Entities/ }))
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

    await user.click(screen.getByRole('button', { name: /Extract Entities/ }))

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
    await user.click(within(panel).getByRole('button', { name: /Extract Entities/ }))

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

    expect(screen.getByLabelText('Select event evt-1')).toBeChecked()
    expect(screen.getByLabelText('Select event evt-2')).toBeChecked()
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

    await user.click(screen.getByRole('button', { name: /Import Selected/ }))
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

    // Both events start checked; untick the second one.
    await user.click(screen.getByLabelText('Select event evt-2'))

    await user.click(screen.getByRole('button', { name: /Import Selected/ }))
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
    await user.click(screen.getByLabelText('Select event evt-1'))
    await user.click(screen.getByLabelText('Select event evt-2'))

    await user.click(screen.getByRole('button', { name: /Import Selected/ }))
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

    await user.click(screen.getByRole('button', { name: /Import Selected/ }))

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
})
