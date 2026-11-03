import { describe, it, expect, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe } from 'vitest-axe'
import { EntityReviewTable } from './EntityReviewTable'
import type { EntityReviewTableProps } from './EntityReviewTable'
import { buildEventLookup, reviewRowId } from './reviewLabels'
import type { ExtractedEvent, ExtractedRelationship } from '@/types'

const source = { type: 'text', extractedAt: '2024-01-01T00:00:00Z' } as const

const events: ExtractedEvent[] = [
  {
    tempId: 'temp-1',
    description: 'Battle of Hastings',
    actor: 'Harold',
    target: 'William',
    timestamp: '1066-10-14',
    confidence: 0.9,
    source,
    selected: true,
    edited: false,
  },
  {
    tempId: 'temp-2',
    description: 'Norman conquest begins',
    actor: 'William',
    target: 'England',
    timestamp: '1066-12-25',
    confidence: 0.4,
    source,
    selected: true,
    edited: false,
  },
]

const relationships: ExtractedRelationship[] = [
  {
    tempId: 'rel-1',
    causeEventTempId: 'temp-1',
    effectEventTempId: 'temp-2',
    weight: 0.8,
    confidence: 0.75,
    reasoning: 'Victory opened the way',
    source,
    selected: true,
  },
  {
    tempId: 'rel-2',
    causeEventTempId: 'temp-2',
    effectEventTempId: 'temp-missing',
    weight: 0.3,
    confidence: 0.5,
    reasoning: 'Dangling reference',
    source,
    selected: true,
  },
]

function renderTable(props: Partial<EntityReviewTableProps> = {}) {
  const handlers = {
    onToggleSelection: vi.fn(),
    onEdit: vi.fn(),
    onSelectAll: vi.fn(),
    onDeselectAll: vi.fn(),
    onSelectByConfidence: vi.fn(),
  }
  const result = render(
    <EntityReviewTable entityType="event" entities={events} {...handlers} {...props} />
  )
  return { ...result, handlers }
}

describe('EntityReviewTable', () => {
  it('names relationship cause and effect events instead of bare tempIds', () => {
    renderTable({
      entityType: 'relationship',
      entities: relationships,
      eventLookup: buildEventLookup(events),
    })

    const row = document.getElementById(reviewRowId('relationship', 'rel-1'))!
    expect(within(row).getByText('Battle of Hastings (Harold → William)')).toBeInTheDocument()
    expect(within(row).getByText('Norman conquest begins (William → England)')).toBeInTheDocument()
    // The full text is available on hover; the extraction's tempId means
    // nothing to a reviewer and is not shown.
    expect(within(row).getByTitle('Battle of Hastings (Harold → William)')).toBeInTheDocument()
    expect(within(row).queryByText('temp-1')).not.toBeInTheDocument()
  })

  it('says an event is missing, keeping its tempId only in the title', () => {
    renderTable({
      entityType: 'relationship',
      entities: relationships,
      eventLookup: { 'temp-2': events[1]! },
    })

    const row = document.getElementById(reviewRowId('relationship', 'rel-2'))!
    const missing = within(row).getByText('An event not in this extraction')
    expect(missing).toHaveAttribute('title', 'temp-missing')
    expect(within(row).queryByText('temp-missing')).not.toBeInTheDocument()
  })

  it('renders a relationship row error in its first cell and marks the row invalid', () => {
    renderTable({
      entityType: 'relationship',
      entities: relationships,
      eventLookup: buildEventLookup(events),
      issues: [
        {
          entityTempId: 'rel-2',
          entityType: 'relationship',
          severity: 'error',
          message: 'Effect event not found',
        },
      ],
    })

    const row = document.getElementById(reviewRowId('relationship', 'rel-2'))!
    expect(row).toHaveAttribute('data-invalid', 'true')
    const message = within(row).getByText('Effect event not found')
    const list = message.closest('ul')!
    expect(list.id).toBeTruthy()
    expect(within(row).getByLabelText('Select relationship rel-2')).toHaveAttribute(
      'aria-describedby',
      list.id
    )
    // The valid row is untouched.
    expect(document.getElementById(reviewRowId('relationship', 'rel-1'))).not.toHaveAttribute(
      'data-invalid'
    )
  })

  it('does not show an issue from another entity type that shares a tempId', () => {
    renderTable({
      issues: [
        { entityTempId: 'temp-1', entityType: 'arc', severity: 'error', message: 'Arc problem' },
      ],
    })

    expect(screen.queryByText('Arc problem')).not.toBeInTheDocument()
  })

  it('associates event row errors with the row inputs', () => {
    renderTable({
      issues: [
        { entityTempId: 'temp-2', entityType: 'event', severity: 'error', message: 'Bad timestamp' },
      ],
    })

    const input = screen.getByLabelText('Date for event temp-2')
    expect(input).toHaveAttribute('aria-invalid', 'true')
    const describedBy = (input.getAttribute('aria-describedby') ?? '').split(' ')
    expect(describedBy.map((id) => document.getElementById(id)?.textContent).join(' ')).toContain('Bad timestamp')
  })

  it('shows a compact editable date with the date in words, never a clipped ISO string', async () => {
    const user = userEvent.setup()
    const iso = [
      { ...events[0]!, timestamp: '1870-02-14T00:00:00.000Z' },
      { ...events[1]!, timestamp: '1870-02-14T09:30:00.000Z' },
    ]
    const { handlers } = renderTable({ entities: iso })

    const date = screen.getByLabelText('Date for event temp-1')
    expect(date).toHaveValue('1870-02-14')
    const reading = document.getElementById((date.getAttribute('aria-describedby') ?? '').split(' ')[0]!)
    expect(reading).toHaveTextContent('Feb 14, 1870')
    expect(screen.getByLabelText('Date for event temp-2')).toHaveValue('1870-02-14T09:30Z')
    expect(screen.getByText('Feb 14, 1870, 09:30 UTC')).toBeInTheDocument()

    // Typing is kept as typed, and an unreadable value is flagged in words.
    await user.clear(date)
    await user.type(date, '1870-13')
    expect(date).toHaveValue('1870-13')
    expect(date).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByText('Not a date: use YYYY-MM-DD')).toBeInTheDocument()
    expect(handlers.onEdit).toHaveBeenLastCalledWith('temp-1', { timestamp: '1870-13' })
  })

  it('edits descriptions in a wrapping box and keeps confidence in view', () => {
    renderTable()

    expect(screen.getByLabelText('Description for event temp-1').tagName).toBe('TEXTAREA')
    const table = screen.getByRole('table')
    expect(table).toHaveClass('table-fixed', 'w-full')
    expect(within(table).getByRole('button', { name: 'Confidence' })).toBeInTheDocument()
    // Source is no longer a column of its own; it sits under the confidence.
    expect(within(table).queryByRole('button', { name: 'Source' })).not.toBeInTheDocument()
    expect(within(table).getAllByText('Text').length).toBe(2)
  })

  it('selects rows at or above a confidence threshold', async () => {
    const user = userEvent.setup()
    const { handlers } = renderTable()

    const threshold = screen.getByLabelText(/Select rows with confidence/)
    expect(threshold).toHaveValue(0.7)

    // At 0.7 only the 0.9 event matches.
    await user.click(screen.getByRole('button', { name: /^Select 1 events with confidence/ }))
    expect(handlers.onSelectByConfidence).toHaveBeenCalledWith(0.7)

    await user.clear(threshold)
    await user.type(threshold, '0.3')
    await user.click(screen.getByRole('button', { name: /^Select 2 events with confidence/ }))
    expect(handlers.onSelectByConfidence).toHaveBeenLastCalledWith(0.3)
  })

  it('disables the threshold action for an out-of-range value', async () => {
    const user = userEvent.setup()
    const { handlers } = renderTable()

    const threshold = screen.getByLabelText(/Select rows with confidence/)
    await user.clear(threshold)
    await user.type(threshold, '2')

    const apply = screen.getByRole('button', { name: /events with confidence/ })
    expect(apply).toBeDisabled()
    expect(threshold).toHaveAttribute('aria-invalid', 'true')
    await user.click(apply)
    expect(handlers.onSelectByConfidence).not.toHaveBeenCalled()
  })

  it('omits the threshold control when no handler is given', () => {
    renderTable({ onSelectByConfidence: undefined })
    expect(screen.queryByLabelText(/Select rows with confidence/)).not.toBeInTheDocument()
  })

  it('has no axe violations with relationships and issues', async () => {
    const { container } = renderTable({
      entityType: 'relationship',
      entities: relationships,
      eventLookup: buildEventLookup(events),
      issues: [
        {
          entityTempId: 'rel-2',
          entityType: 'relationship',
          severity: 'error',
          message: 'Effect event not found',
        },
      ],
    })
    expect(await axe(container)).toHaveNoViolations()
  })
})
