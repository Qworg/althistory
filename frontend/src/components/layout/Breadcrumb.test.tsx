import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { Breadcrumb } from './Breadcrumb'

const renderAt = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Breadcrumb />
    </MemoryRouter>
  )

describe('Breadcrumb', () => {
  it('has no Home crumb, since "/" is the timeline', () => {
    renderAt('/timeline')

    expect(screen.queryByText('Home')).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Home' })).not.toBeInTheDocument()
  })

  it('shows the timeline as the current page at "/"', () => {
    renderAt('/')

    const nav = screen.getByRole('navigation', { name: 'Breadcrumb' })
    expect(nav).toBeInTheDocument()
    expect(screen.getByText('Timeline')).toHaveAttribute('aria-current', 'page')
    expect(nav.querySelectorAll('a')).toHaveLength(0)
  })

  it('renders breadcrumb for timeline page', () => {
    renderAt('/timeline')

    expect(screen.getByRole('navigation', { name: 'Breadcrumb' })).toBeInTheDocument()
    expect(screen.getByText('Timeline')).toBeInTheDocument()
  })

  it('renders breadcrumb for causal graph page', () => {
    renderAt('/causal-graph')

    expect(screen.getByText('Causal Graph')).toHaveAttribute('aria-current', 'page')
  })

  it('renders breadcrumb for actor perspective page', () => {
    renderAt('/actor-perspective')

    expect(screen.getByText('Actor Perspective')).toHaveAttribute('aria-current', 'page')
  })

  it('shows current page as non-clickable text', () => {
    renderAt('/timeline')

    const currentPage = screen.getByText('Timeline')
    expect(currentPage).toHaveAttribute('aria-current', 'page')
    expect(currentPage.closest('a')).toBeNull()
  })

  it('has no separator for a single crumb', () => {
    renderAt('/timeline')

    const nav = screen.getByRole('navigation', { name: 'Breadcrumb' })
    expect(nav.querySelectorAll('svg[aria-hidden="true"]')).toHaveLength(0)
  })

  it('links ancestors and separates crumbs on nested paths', () => {
    renderAt('/graphs/branch-a')

    const nav = screen.getByRole('navigation', { name: 'Breadcrumb' })
    expect(nav.querySelectorAll('li')).toHaveLength(2)
    expect(nav.querySelectorAll('svg[aria-hidden="true"]')).toHaveLength(1)
    expect(screen.getByRole('link', { name: 'Graphs' })).toHaveAttribute('href', '/graphs')
    expect(screen.getByText('Branch-a')).toHaveAttribute('aria-current', 'page')
  })

  it('has proper semantic structure', () => {
    renderAt('/timeline')

    const nav = screen.getByRole('navigation', { name: 'Breadcrumb' })
    expect(nav.querySelector('ol')).toBeInTheDocument()
    expect(nav.querySelectorAll('li')).toHaveLength(1)
  })

  it('handles unknown routes gracefully', () => {
    renderAt('/unknown-route')

    expect(screen.getByText('Unknown-route')).toBeInTheDocument()
  })
})