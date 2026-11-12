import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CreateGraphModal } from './CreateGraphModal'
import { GraphManagerModal } from './GraphManagerModal'
import { useGraphManagement, useGraphBranches, useGraphHeadVersion } from '@/hooks/useGraphs'
import type { Graph } from '@/types'

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
  calendar: { epochYear: 1000, eraLabel: 'AR', name: 'the Reckoning of Vael' },
}

const earth: Graph = { ...vael, id: 'earth', name: 'Earth', calendar: undefined }

describe('World calendar section: creating a graph', () => {
  const user = userEvent.setup()

  async function openForm() {
    const onCreate = vi.fn().mockResolvedValue(undefined)
    render(<CreateGraphModal isOpen onClose={vi.fn()} onCreate={onCreate} />)
    await user.type(screen.getByLabelText(/^Name/), 'The Vael Chronicle')
    return onCreate
  }

  it('sends no calendar unless one is added', async () => {
    const onCreate = await openForm()
    await user.click(screen.getByRole('button', { name: 'Create Graph' }))
    expect(onCreate).toHaveBeenCalledWith({ name: 'The Vael Chronicle', description: undefined })
  })

  it('previews the mapping as it is typed and sends the calendar', async () => {
    const onCreate = await openForm()
    await user.click(screen.getByRole('button', { name: 'Add a world calendar' }))
    const epoch = screen.getByLabelText(/Year 1 is stored year/)
    expect(epoch).toHaveFocus()

    await user.type(epoch, '1000')
    await user.type(screen.getByLabelText('Era label'), 'AR')
    await user.type(screen.getByLabelText('Calendar name'), ' the Reckoning of Vael ')

    const preview = document.getElementById('create-graph-calendar-preview')!
    expect(preview).toHaveTextContent('Stored year 1000 shows as 1 AR.')
    expect(preview).toHaveTextContent('stored 999 shows as 1 before AR')

    await user.click(screen.getByRole('button', { name: 'Create Graph' }))
    expect(onCreate).toHaveBeenCalledWith({
      name: 'The Vael Chronicle',
      description: undefined,
      calendar: { epochYear: 1000, eraLabel: 'AR', name: 'the Reckoning of Vael' },
    })
  })

  it("sends the world's month names, and holds the count error until twelve are typed or the form is sent", async () => {
    const onCreate = await openForm()
    await user.click(screen.getByRole('button', { name: 'Add a world calendar' }))
    await user.type(screen.getByLabelText(/Year 1 is stored year/), '1000')
    const months = screen.getByLabelText(/Month names/)

    await user.type(months, 'Thaw,Seedfall')
    expect(screen.getByText('2 of 12 named.')).toBeInTheDocument()
    expect(months).not.toHaveAttribute('aria-invalid')

    await user.clear(months)
    await user.type(months, 'Thaw,Seedfall,Greening,Highsun,Brine,Harvest,Ember,Ashfall,Gale,Dimming,Frost,Deepwinter')
    expect(document.getElementById('create-graph-calendar-preview')).toHaveTextContent('March 4 shows as Greening 4')

    await user.click(screen.getByRole('button', { name: 'Create Graph' }))
    expect(onCreate).toHaveBeenCalledWith({
      name: 'The Vael Chronicle',
      description: undefined,
      calendar: {
        epochYear: 1000,
        monthNames: ['Thaw', 'Seedfall', 'Greening', 'Highsun', 'Brine', 'Harvest', 'Ember', 'Ashfall', 'Gale', 'Dimming', 'Frost', 'Deepwinter'],
      },
    })
  })

  it('refuses eleven month names when the form is sent', async () => {
    const onCreate = await openForm()
    await user.click(screen.getByRole('button', { name: 'Add a world calendar' }))
    await user.type(screen.getByLabelText(/Year 1 is stored year/), '1000')
    await user.type(screen.getByLabelText(/Month names/), 'A,B,C,D,E,F,G,H,I,J,K')
    await user.click(screen.getByRole('button', { name: 'Create Graph' }))
    expect(onCreate).not.toHaveBeenCalled()
    expect(screen.getByLabelText(/Month names/)).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByText(/Name all 12 months, or none \(11 names given\)/)).toBeInTheDocument()
  })

  it('previews "Year N" without a label', async () => {
    await openForm()
    await user.click(screen.getByRole('button', { name: 'Add a world calendar' }))
    await user.type(screen.getByLabelText(/Year 1 is stored year/), '1000')
    expect(document.getElementById('create-graph-calendar-preview')).toHaveTextContent(
      'Stored year 1000 shows as Year 1.'
    )
  })

  it('refuses what the API would refuse, and says why', async () => {
    const onCreate = await openForm()
    await user.click(screen.getByRole('button', { name: 'Add a world calendar' }))

    // An empty year is only "missing" once the form is submitted.
    expect(screen.queryByText(/whole number/)).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Create Graph' }))
    expect(onCreate).not.toHaveBeenCalled()
    expect(screen.getByText(/whole number/)).toBeInTheDocument()

    const epoch = screen.getByLabelText(/Year 1 is stored year/)
    await user.type(epoch, '10000')
    expect(screen.getByText(/must be a stored year from 1 to 9999/)).toBeInTheDocument()
    expect(epoch).toHaveAttribute('aria-invalid', 'true')

    await user.clear(epoch)
    await user.type(epoch, '1000')
    await user.type(screen.getByLabelText('Era label'), 'A'.repeat(17))
    expect(screen.getByText(/at most 16 characters/)).toBeInTheDocument()
    await user.type(screen.getByLabelText('Calendar name'), 'n'.repeat(81))
    expect(screen.getByText(/at most 80 characters/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Create Graph' }))
    expect(onCreate).not.toHaveBeenCalled()
  })

  it('keeps focus in the section when it is added and removed', async () => {
    await openForm()
    await user.click(screen.getByRole('button', { name: 'Add a world calendar' }))
    expect(screen.getByLabelText(/Year 1 is stored year/)).toHaveFocus()
    // "Remove calendar" unmounts itself: focus goes to the button that replaces it, not <body>.
    await user.click(screen.getByRole('button', { name: 'Remove calendar' }))
    expect(screen.getByRole('button', { name: 'Add a world calendar' })).toHaveFocus()
  })

  it('sends nothing once the section is removed again', async () => {
    const onCreate = await openForm()
    await user.click(screen.getByRole('button', { name: 'Add a world calendar' }))
    await user.type(screen.getByLabelText(/Year 1 is stored year/), '0')
    await user.click(screen.getByRole('button', { name: 'Remove calendar' }))
    await user.click(screen.getByRole('button', { name: 'Create Graph' }))
    expect(onCreate).toHaveBeenCalledWith({ name: 'The Vael Chronicle', description: undefined })
  })
})

describe('World calendar section: editing a graph', () => {
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

  it("starts from the graph's calendar, previews its own first year, and leaves an unchanged one out", async () => {
    await edit('Vael')
    expect(screen.getByLabelText(/Year 1 is stored year/)).toHaveValue('1000')
    expect(screen.getByLabelText('Era label')).toHaveValue('AR')
    expect(screen.getByLabelText('Calendar name')).toHaveValue('the Reckoning of Vael')
    expect(document.getElementById('edit-graph-vael-calendar-preview')).toHaveTextContent(
      'Stored year 1311 shows as 312 AR.'
    )

    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(updateGraph).toHaveBeenCalledWith({
      id: 'vael',
      data: { name: 'Vael', description: undefined, status: 'active' },
    })
  })

  it('sends a changed calendar', async () => {
    await edit('Vael')
    const epoch = screen.getByLabelText(/Year 1 is stored year/)
    await user.clear(epoch)
    await user.type(epoch, '1300')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(updateGraph).toHaveBeenCalledWith({
      id: 'vael',
      data: expect.objectContaining({
        calendar: { epochYear: 1300, eraLabel: 'AR', name: 'the Reckoning of Vael' },
      }),
    })
  })

  it('sends null to remove the calendar', async () => {
    await edit('Vael')
    await user.click(screen.getByRole('button', { name: 'Remove calendar' }))
    expect(screen.getByText(/Saving removes the calendar/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(updateGraph).toHaveBeenCalledWith({
      id: 'vael',
      data: expect.objectContaining({ calendar: null }),
    })
  })

  it('adds a calendar to a graph without one', async () => {
    await edit('Earth')
    await user.click(screen.getByRole('button', { name: 'Add a world calendar' }))
    await user.type(screen.getByLabelText(/Year 1 is stored year/), '1000')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(updateGraph).toHaveBeenCalledWith({
      id: 'earth',
      data: expect.objectContaining({ calendar: { epochYear: 1000 } }),
    })
  })

  it('keeps the form open while the calendar is invalid', async () => {
    await edit('Vael')
    const epoch = screen.getByLabelText(/Year 1 is stored year/)
    await user.clear(epoch)
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(updateGraph).not.toHaveBeenCalled()
    expect(screen.getByText(/whole number/)).toBeInTheDocument()
  })
})
