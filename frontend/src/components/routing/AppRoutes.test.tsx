import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router'
import { AppRoutes } from './AppRoutes'
import { Sidebar } from '@/components/layout/Sidebar'

vi.mock('@/components/views/TimelineView', () => ({ TimelineView: () => <div>Timeline view</div> }))
vi.mock('@/components/views/CausalGraphView', () => ({ CausalGraphView: () => <div>Causal view</div> }))
vi.mock('@/components/views/ActorPerspectiveView', () => ({ ActorPerspectiveView: () => <div>Actor view</div> }))

function Where() {
  const { pathname, search } = useLocation()
  return <output aria-label="location">{pathname + search}</output>
}

const renderAt = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <AppRoutes />
      <Where />
    </MemoryRouter>
  )

describe('AppRoutes', () => {
  it('sends "/" to "/timeline", so the Timeline navigation item is the active one', () => {
    renderAt('/')

    expect(screen.getByText('Timeline view')).toBeInTheDocument()
    expect(screen.getByLabelText('location')).toHaveTextContent(/^\/timeline$/)
  })

  it('marks the sidebar\'s Timeline item as the current page at "/"', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <Sidebar />
        <AppRoutes />
      </MemoryRouter>
    )

    expect(screen.getByRole('link', { name: /Timeline/ })).toHaveAttribute('aria-current', 'page')
  })

  it('keeps a shared link\'s filters through the redirect', () => {
    renderAt('/?startDate=1843&actors=Babbage')

    expect(screen.getByLabelText('location')).toHaveTextContent('/timeline?startDate=1843&actors=Babbage')
  })

  it('serves each view at its own path', () => {
    for (const [path, text] of [
      ['/timeline', 'Timeline view'],
      ['/causal-graph', 'Causal view'],
      ['/actor-perspective', 'Actor view'],
    ] as const) {
      const { unmount } = renderAt(path)
      expect(screen.getByText(text)).toBeInTheDocument()
      unmount()
    }
  })
})
