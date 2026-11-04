import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { EmptyGraphState } from './EmptyGraphState'
import { OPEN_TOOLBAR_TOOL_EVENT, type ToolbarTool } from './toolbarTools'

describe('EmptyGraphState', () => {
  const opened: ToolbarTool[] = []
  const listener = (event: Event) => opened.push((event as CustomEvent<ToolbarTool>).detail)
  window.addEventListener(OPEN_TOOLBAR_TOOL_EVENT, listener)

  afterEach(() => {
    opened.length = 0
  })

  it('names the ways history gets into an empty graph, extraction first', () => {
    render(<EmptyGraphState kind="empty" />)

    expect(screen.getByRole('heading', { name: 'This graph has no history yet' })).toBeInTheDocument()
    const buttons = screen.getAllByRole('button').map(b => b.textContent)
    expect(buttons).toEqual(['Extract from text or Wikipedia', 'Create the first event', 'Import it'])
  })

  it('asks the toolbar to open the chosen dialog', () => {
    render(<EmptyGraphState kind="empty" />)

    fireEvent.click(screen.getByRole('button', { name: 'Extract from text or Wikipedia' }))
    fireEvent.click(screen.getByRole('button', { name: 'Create the first event' }))
    fireEvent.click(screen.getByRole('button', { name: 'Import it' }))

    expect(opened).toEqual(['ingest', 'create-event', 'import'])
  })

  it('tells a filtered-out view apart from an empty graph, and offers to clear the filters', () => {
    const onClearFilters = vi.fn()
    render(<EmptyGraphState kind="filtered" onClearFilters={onClearFilters} />)

    expect(screen.getByRole('heading', { name: 'No events match the filters' })).toBeInTheDocument()
    expect(screen.queryByText('This graph has no history yet')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }))
    expect(onClearFilters).toHaveBeenCalledTimes(1)
  })
})
