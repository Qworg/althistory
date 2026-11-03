import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { BranchFromEventDialog } from './BranchFromEventDialog'
import { useActiveGraph, useBranchGraph, useSwitchGraph } from '@/hooks/useGraphs'
import type { Event, Graph } from '@/types'

vi.mock('@/hooks/useGraphs')

const activeGraph: Graph = {
  id: 'graph-main',
  name: 'The Engine Age',
  description: 'Babbage builds the engine',
  status: 'active',
  version: 4,
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-02T00:00:00Z',
  metadata: { eventCount: 12, arcCount: 4, relationshipCount: 8, pressureCount: 3 },
}

const branch: Graph = {
  ...activeGraph,
  id: 'graph-branch',
  name: 'The Engine Age — what if: Parliament bans the engines',
  parentGraphId: 'graph-main',
}

const event: Event = {
  id: 'evt-1868-ban',
  description: 'Parliament bans the engines',
  actor: 'Parliament',
  target: 'Calculating Offices',
  timestamp: '1868-03-02T00:00:00.000Z',
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:00:00Z',
}

const mutateAsync = vi.fn()
const switchMutate = vi.fn()

function mockHooks({ isPending = false }: { isPending?: boolean } = {}) {
  vi.mocked(useActiveGraph).mockReturnValue({ data: activeGraph } as unknown as ReturnType<typeof useActiveGraph>)
  vi.mocked(useBranchGraph).mockReturnValue({ mutateAsync, isPending } as unknown as ReturnType<typeof useBranchGraph>)
  vi.mocked(useSwitchGraph).mockReturnValue({ mutate: switchMutate } as unknown as ReturnType<typeof useSwitchGraph>)
}

describe('BranchFromEventDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mutateAsync.mockResolvedValue(branch)
    mockHooks()
  })

  it('renders nothing when closed or without an event', () => {
    const { rerender } = render(<BranchFromEventDialog event={event} isOpen={false} onClose={vi.fn()} />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    rerender(<BranchFromEventDialog event={null} isOpen onClose={vi.fn()} />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('is a modal dialog titled for the action, showing the point of divergence', () => {
    render(<BranchFromEventDialog event={event} isOpen onClose={vi.fn()} />)

    const dialog = screen.getByRole('dialog', { name: 'Branch from this event' })
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    const divergence = screen.getByRole('region', { name: 'Point of divergence' })
    expect(divergence).toHaveTextContent('Parliament bans the engines')
    // UTC date, not shifted by the viewer's time zone
    expect(divergence).toHaveTextContent('Mar 2, 1868')
    expect(divergence).toHaveTextContent('Parliament')
    // The internal event id is not shown to people.
    expect(divergence).not.toHaveTextContent('evt-1868-ban')
    expect(dialog).not.toHaveTextContent('evt-1868-ban')
  })

  it('prefills an editable name and a description recording the divergence', () => {
    render(<BranchFromEventDialog event={event} isOpen onClose={vi.fn()} />)

    expect(screen.getByLabelText('Branch name')).toHaveValue(
      'The Engine Age — what if: Parliament bans the engines'
    )
    const description = screen.getByLabelText(/Description/) as HTMLTextAreaElement
    expect(description.value).toContain('Parliament bans the engines')
    expect(description.value).toContain('Mar 2, 1868')
    expect(description.value).toBe('Counterfactual branch diverging at “Parliament bans the engines” (Mar 2, 1868).')
    expect(description.value).not.toContain('evt-1868-ban')
  })

  it('updates the suggested name when the graph name arrives late, but never over typing', async () => {
    const user = userEvent.setup()
    vi.mocked(useActiveGraph).mockReturnValue({ data: undefined } as unknown as ReturnType<typeof useActiveGraph>)
    const { rerender } = render(<BranchFromEventDialog event={event} isOpen onClose={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Create branch' })).toBeDisabled()

    mockHooks()
    rerender(<BranchFromEventDialog event={event} isOpen onClose={vi.fn()} />)
    expect(screen.getByLabelText('Branch name')).toHaveValue(
      'The Engine Age — what if: Parliament bans the engines'
    )

    await user.clear(screen.getByLabelText('Branch name'))
    await user.type(screen.getByLabelText('Branch name'), 'Mine')
    rerender(<BranchFromEventDialog event={event} isOpen onClose={vi.fn()} />)
    expect(screen.getByLabelText('Branch name')).toHaveValue('Mine')
  })

  it('starts over for a different point of divergence', async () => {
    const user = userEvent.setup()
    const { rerender } = render(<BranchFromEventDialog event={event} isOpen onClose={vi.fn()} />)
    await user.clear(screen.getByLabelText('Branch name'))
    await user.type(screen.getByLabelText('Branch name'), 'Mine')

    const other = { ...event, id: 'evt-1843', description: 'Babbage completes the engine' }
    rerender(<BranchFromEventDialog event={other} isOpen onClose={vi.fn()} />)

    expect(screen.getByLabelText('Branch name')).toHaveValue(
      'The Engine Age — what if: Babbage completes the engine'
    )
  })

  it('explains that the baseline is untouched', () => {
    render(<BranchFromEventDialog event={event} isOpen onClose={vi.fn()} />)

    expect(screen.getByText(/stays exactly as it is/)).toBeInTheDocument()
    expect(screen.getByText(/change history from\s+this event onward/)).toBeInTheDocument()
  })

  it('truncates a long event description in the suggested name', () => {
    const long = { ...event, description: 'A '.repeat(5) + 'very long account of what happened '.repeat(10) }
    render(<BranchFromEventDialog event={long} isOpen onClose={vi.fn()} />)

    const name = (screen.getByLabelText('Branch name') as HTMLInputElement).value
    expect(name.startsWith('The Engine Age — what if: ')).toBe(true)
    expect(name.length).toBeLessThanOrEqual(100)
    expect(name.endsWith('…')).toBe(true)
  })

  it('branches the active graph with the edited name and description', async () => {
    const user = userEvent.setup()
    render(<BranchFromEventDialog event={event} isOpen onClose={vi.fn()} />)

    const name = screen.getByLabelText('Branch name')
    await user.clear(name)
    await user.type(name, '  Clerks Prevail  ')
    const description = screen.getByLabelText(/Description/)
    await user.clear(description)
    await user.type(description, 'The ban passes.')
    await user.click(screen.getByRole('button', { name: 'Create branch' }))

    expect(mutateAsync).toHaveBeenCalledTimes(1)
    expect(mutateAsync).toHaveBeenCalledWith({
      id: 'graph-main',
      data: { branchName: 'Clerks Prevail', description: 'The ban passes.' },
    })
  })

  it('cannot be submitted without a name', async () => {
    const user = userEvent.setup()
    render(<BranchFromEventDialog event={event} isOpen onClose={vi.fn()} />)

    await user.clear(screen.getByLabelText('Branch name'))

    expect(screen.getByRole('button', { name: 'Create branch' })).toBeDisabled()
    expect(screen.getByText('Give the branch a name.')).toBeInTheDocument()
  })

  it('offers to switch to the new branch, then switches and closes', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<BranchFromEventDialog event={event} isOpen onClose={onClose} />)

    await user.click(screen.getByRole('button', { name: 'Create branch' }))

    expect(await screen.findByRole('status')).toHaveTextContent('The Engine Age is unchanged')
    await user.click(screen.getByRole('button', { name: 'Switch to branch' }))

    expect(switchMutate).toHaveBeenCalledWith('graph-branch')
    expect(onClose).toHaveBeenCalled()
  })

  it('can stay on the baseline after branching', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<BranchFromEventDialog event={event} isOpen onClose={onClose} />)

    await user.click(screen.getByRole('button', { name: 'Create branch' }))
    await user.click(await screen.findByRole('button', { name: 'Stay on The Engine Age' }))

    expect(switchMutate).not.toHaveBeenCalled()
    expect(onClose).toHaveBeenCalled()
  })

  it('reports a failure, keeps the form, and allows a retry', async () => {
    const user = userEvent.setup()
    mutateAsync.mockRejectedValueOnce(new Error('Branch name is required'))
    render(<BranchFromEventDialog event={event} isOpen onClose={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: 'Create branch' }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent("Couldn't create the branch: Branch name is required.")
    expect(alert).toHaveTextContent('Nothing was changed')
    expect(screen.queryByRole('button', { name: 'Switch to branch' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Create branch' }))
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
    expect(mutateAsync).toHaveBeenCalledTimes(2)
  })

  it('closes on Escape', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<BranchFromEventDialog event={event} isOpen onClose={onClose} />)

    await user.keyboard('{Escape}')

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('does not close on Escape while the branch is being created', async () => {
    const user = userEvent.setup()
    mockHooks({ isPending: true })
    const onClose = vi.fn()
    render(<BranchFromEventDialog event={event} isOpen onClose={onClose} />)

    expect(screen.getByRole('button', { name: 'Creating branch…' })).toBeDisabled()
    await user.keyboard('{Escape}')

    expect(onClose).not.toHaveBeenCalled()
  })
})
