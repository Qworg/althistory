import { describe, it, expect } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TimelineLegend } from './TimelineLegend'

const base = { counts: { events: 19, arcs: 4, links: 24 }, hasLinks: true, isTracing: false, undoKey: 'Ctrl+Z' }

describe('TimelineLegend', () => {
  it('keeps one line visible and folds the key behind a disclosure', async () => {
    const user = userEvent.setup()
    render(<TimelineLegend {...base} linkTypes={['direct']} tiers={['firm']} />)
    const key = screen.getByRole('button', { name: 'Key' })
    expect(key).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('list', { name: 'Causal links' })).not.toBeInTheDocument()
    expect(screen.getByText(/19 events · 4 arcs · 24 links/)).toBeInTheDocument()

    await user.click(key)
    const links = screen.getByRole('list', { name: 'Causal links' })
    // Only what the canvas draws.
    expect(within(links).getByText('direct (solid)')).toBeInTheDocument()
    expect(within(links).queryByText('indirect (dashed)')).not.toBeInTheDocument()
    expect(within(screen.getByRole('list', { name: 'Event confidence' })).queryByText('speculative')).not.toBeInTheDocument()
  })

  it('names the trace colours while a trace is on', () => {
    render(<TimelineLegend {...base} isTracing />)
    expect(screen.getByText('causes')).toBeInTheDocument()
    expect(screen.getByText('what it set in motion')).toBeInTheDocument()
  })

  it('tells pressure types apart by shape as well as colour', async () => {
    const user = userEvent.setup()
    render(<TimelineLegend {...base} pressureTypes={['economic', 'social', 'political', 'environmental']} />)
    await user.click(screen.getByRole('button', { name: 'Key' }))
    const list = screen.getByRole('list', { name: 'Pressures on arcs' })
    const shapes = ['economic', 'social', 'political', 'environmental'].map(
      (type) => list.querySelector(`[data-pressure-type="${type}"]`)?.tagName.toLowerCase()
    )
    expect(shapes).toEqual(['circle', 'rect', 'path', 'path'])
    const [, , political, environmental] = ['economic', 'social', 'political', 'environmental'].map(
      (type) => list.querySelector(`[data-pressure-type="${type}"]`)?.getAttribute('d')
    )
    expect(political).not.toEqual(environmental)
  })
})
