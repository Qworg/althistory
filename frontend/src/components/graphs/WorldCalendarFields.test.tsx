import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CreateGraphModal } from './CreateGraphModal'
import { GraphManagerModal } from './GraphManagerModal'
import { useGraphManagement, useGraphBranches, useGraphHeadVersion } from '@/hooks/useGraphs'
import type { Graph } from '@/types'
import { VAEL } from '@/test/fixtures/worldCalendars'

vi.mock('@/hooks/useGraphs')

const vael: Graph = {
  id: 'vael',
  name: 'Vael',
  status: 'active',
  version: 2,
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-02T00:00:00Z',
  metadata: {
    eventCount: 3,
    arcCount: 0,
    relationshipCount: 0,
    pressureCount: 0,
    temporalRange: { start: '1311-03-04T00:00:00Z', end: '1320-01-01T00:00:00Z' },
  },
  // Stored in the earlier form, as graphs made before calendar sets were.
  calendar: { epochYear: 1000, eraLabel: 'AR', name: 'the Reckoning of Vael' } as unknown as Graph['calendar'],
}

const earth: Graph = { ...vael, id: 'earth', name: 'Earth', calendar: undefined }

describe('World calendars section: creating a graph', () => {
  const user = userEvent.setup()

  async function openForm() {
    const onCreate = vi.fn().mockResolvedValue(undefined)
    render(<CreateGraphModal isOpen onClose={vi.fn()} onCreate={onCreate} />)
    await user.type(screen.getByLabelText(/^Name/), 'The Vael Chronicle')
    return onCreate
  }

  /** The calendar set the form sent. */
  const sent = (onCreate: ReturnType<typeof vi.fn>) => onCreate.mock.calls[0]![0].calendar

  it('sends no calendar unless one is added', async () => {
    const onCreate = await openForm()
    await user.click(screen.getByRole('button', { name: 'Create Graph' }))
    expect(onCreate).toHaveBeenCalledWith({ name: 'The Vael Chronicle', description: undefined })
  })

  it('starts from the Gregorian shape, and sends the months, festivals, eras and day it is changed to', async () => {
    const onCreate = await openForm()
    await user.click(screen.getByRole('button', { name: 'Add a world calendar' }))
    const day = screen.getByLabelText('Length of the world’s day')
    expect(day).toHaveFocus()
    expect(day).toHaveValue('24')
    await user.clear(day)
    await user.type(day, '30')

    const name = screen.getByLabelText('Calendar name')
    await user.clear(name)
    await user.type(name, 'the Reckoning of the Rising')
    const first = screen.getByLabelText('Month 1 name')
    await user.clear(first)
    await user.type(first, 'Lowtide')
    await user.click(screen.getByRole('button', { name: 'Add festival days' }))
    await user.type(screen.getByLabelText('Festival 13 name'), 'The Drowned Days')
    const festivalDays = screen.getByLabelText('The Drowned Days: days')
    await user.clear(festivalDays)
    await user.type(festivalDays, '4')
    await user.type(screen.getByLabelText('Era 1 label'), 'AR')

    await user.click(screen.getByRole('button', { name: 'Create Graph' }))
    const calendar = sent(onCreate)
    expect(calendar.dayLength).toBe(30 * 3600)
    const [definition] = calendar.calendars
    expect(definition.name).toBe('the Reckoning of the Rising')
    expect(definition.parts[0]).toEqual({ name: 'Lowtide', days: 31 })
    expect(definition.parts[12]).toEqual({ name: 'The Drowned Days', days: 4, intercalary: true })
    expect(definition.eras).toEqual([{ label: 'AR', from: 1 }])
    expect(calendar.primary).toBe(definition.id)
  })

  it('keeps the leap rules on their month when a month before it is removed', async () => {
    const onCreate = await openForm()
    await user.click(screen.getByRole('button', { name: 'Add a world calendar' }))
    await user.click(screen.getByRole('button', { name: 'Remove Jan' }))
    await user.click(screen.getByRole('button', { name: 'Create Graph' }))
    const [definition] = sent(onCreate).calendars
    expect(definition.parts[0].name).toBe('Feb')
    expect(definition.leapRules.map((rule: { part: number }) => rule.part)).toEqual([0, 0, 0])
  })

  it('refuses what the API would refuse, says why, and sends nothing', async () => {
    const onCreate = await openForm()
    await user.click(screen.getByRole('button', { name: 'Add a world calendar' }))
    const days = screen.getByLabelText('Jan: days')
    await user.clear(days)
    await user.type(days, 'many')
    expect(screen.getByText('Must be a whole number from 1 to 1000.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Create Graph' }))
    expect(onCreate).not.toHaveBeenCalled()
    expect(days).toHaveAttribute('aria-invalid', 'true')
  })

  it('keeps several calendars, and the one dates are shown in', async () => {
    const onCreate = await openForm()
    await user.click(screen.getByRole('button', { name: 'Add a world calendar' }))
    await user.click(screen.getByRole('button', { name: 'Add another calendar' }))
    await user.selectOptions(screen.getByLabelText('Dates are shown in'), 'Calendar 2')
    await user.click(screen.getByRole('button', { name: 'Create Graph' }))
    const calendar = sent(onCreate)
    expect(calendar.calendars).toHaveLength(2)
    expect(calendar.primary).toBe(calendar.calendars[1].id)
  })

  it('takes a whole set pasted as JSON', async () => {
    const onCreate = await openForm()
    await user.click(screen.getByRole('button', { name: 'Add a world calendar' }))
    await user.click(screen.getByRole('button', { name: 'Edit as JSON' }))
    const json = screen.getByLabelText(/The calendars as JSON/)
    await user.clear(json)
    await user.click(json)
    await user.paste(JSON.stringify(VAEL))
    await user.click(screen.getByRole('button', { name: 'Use this JSON' }))
    await user.click(screen.getByRole('button', { name: 'Create Graph' }))
    expect(sent(onCreate)).toEqual(VAEL)
  })

  it('says what is wrong with pasted JSON, and keeps the form as it was', async () => {
    await openForm()
    await user.click(screen.getByRole('button', { name: 'Add a world calendar' }))
    await user.click(screen.getByRole('button', { name: 'Edit as JSON' }))
    const json = screen.getByLabelText(/The calendars as JSON/)
    await user.clear(json)
    await user.type(json, 'not json')
    await user.click(screen.getByRole('button', { name: 'Use this JSON' }))
    expect(screen.getByText('That is not JSON.')).toBeInTheDocument()
  })

  it('keeps focus in the section when it is added and removed, and sends nothing once removed', async () => {
    const onCreate = await openForm()
    await user.click(screen.getByRole('button', { name: 'Add a world calendar' }))
    expect(screen.getByLabelText('Length of the world’s day')).toHaveFocus()
    await user.click(screen.getByRole('button', { name: 'Remove the calendars' }))
    expect(screen.getByRole('button', { name: 'Add a world calendar' })).toHaveFocus()
    await user.click(screen.getByRole('button', { name: 'Create Graph' }))
    expect(onCreate).toHaveBeenCalledWith({ name: 'The Vael Chronicle', description: undefined })
  })
})

describe('World calendars section: editing a graph', () => {
  const user = userEvent.setup()
  const updateGraph = vi.fn()

  beforeEach(() => {
    updateGraph.mockReset()
    vi.mocked(useGraphManagement).mockReturnValue({
      activeGraphId: 'vael',
      activeGraph: vael,
      graphs: [vael, earth],
      updateGraph,
    } as unknown as ReturnType<typeof useGraphManagement>)
    vi.mocked(useGraphHeadVersion).mockReturnValue(null)
    vi.mocked(useGraphBranches).mockReturnValue({ data: [], isLoading: false } as unknown as ReturnType<
      typeof useGraphBranches
    >)
  })

  async function edit(name: string) {
    render(<GraphManagerModal isOpen onClose={vi.fn()} />)
    const row = screen.getByRole('heading', { level: 4, name }).closest('[data-graph-row]') as HTMLElement
    await user.click(row)
    await user.click(within(row).getByRole('button', { name: 'Edit' }))
    return row
  }

  it("starts from the graph's calendar (stored in the earlier form), previews its history, and leaves it out unchanged", async () => {
    await edit('Vael')
    expect(screen.getByLabelText('Calendar name')).toHaveValue('the Reckoning of Vael')
    expect(screen.getByLabelText('Era 1 label')).toHaveValue('AR')
    expect(screen.getByText(/The history begins on/)).toHaveTextContent('The history begins on Mar 4, 312 AR')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(updateGraph).toHaveBeenCalledWith({
      id: 'vael',
      data: { name: 'Vael', description: undefined, status: 'active' },
    })
  })

  it('sends a changed calendar as a set', async () => {
    await edit('Vael')
    const label = screen.getByLabelText('Era 1 label')
    await user.clear(label)
    await user.type(label, 'NR')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    const data = updateGraph.mock.calls[0]![0].data
    expect(data.calendar.version).toBe(2)
    expect(data.calendar.calendars[0].eras).toEqual([{ label: 'NR', from: 1 }])
  })

  it('sends null to remove the calendars', async () => {
    await edit('Vael')
    await user.click(screen.getByRole('button', { name: 'Remove the calendars' }))
    expect(screen.getByText(/Saving removes the calendars/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(updateGraph).toHaveBeenCalledWith({ id: 'vael', data: expect.objectContaining({ calendar: null }) })
  })

  it('adds a calendar to a graph without one', async () => {
    await edit('Earth')
    await user.click(screen.getByRole('button', { name: 'Add a world calendar' }))
    await user.click(screen.getByRole('button', { name: 'Save' }))
    const data = updateGraph.mock.calls[0]![0].data
    expect(data.calendar.calendars).toHaveLength(1)
  })

  it('keeps the form open while the calendar is invalid', async () => {
    await edit('Vael')
    const day = screen.getByLabelText('Length of the world’s day')
    await user.clear(day)
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(updateGraph).not.toHaveBeenCalled()
    expect(screen.getByText(/A day must last a whole number of seconds/)).toBeInTheDocument()
  })
})
