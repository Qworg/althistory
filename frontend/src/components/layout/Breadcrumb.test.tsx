import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { BrowserRouter, MemoryRouter } from 'react-router'
import { Breadcrumb } from './Breadcrumb'

const renderWithRouter = (component: React.ReactElement, initialEntries?: string[]) => {
  if (initialEntries) {
    return render(
      <MemoryRouter initialEntries={initialEntries}>
        {component}
      </MemoryRouter>
    )
  }
  return render(
    <BrowserRouter>
      {component}
    </BrowserRouter>
  )
}

describe('Breadcrumb', () => {
  it('does not render on home page', () => {
    renderWithRouter(<Breadcrumb />, ['/'])
    
    expect(screen.queryByRole('navigation', { name: 'Breadcrumb' })).not.toBeInTheDocument()
  })

  it('renders breadcrumb for timeline page', () => {
    renderWithRouter(<Breadcrumb />, ['/timeline'])
    
    expect(screen.getByRole('navigation', { name: 'Breadcrumb' })).toBeInTheDocument()
    expect(screen.getByText('Home')).toBeInTheDocument()
    expect(screen.getByText('Timeline')).toBeInTheDocument()
  })

  it('renders breadcrumb for causal graph page', () => {
    renderWithRouter(<Breadcrumb />, ['/causal-graph'])
    
    expect(screen.getByText('Home')).toBeInTheDocument()
    expect(screen.getByText('Causal Graph')).toBeInTheDocument()
  })

  it('renders breadcrumb for actor perspective page', () => {
    renderWithRouter(<Breadcrumb />, ['/actor-perspective'])
    
    expect(screen.getByText('Home')).toBeInTheDocument()
    expect(screen.getByText('Actor Perspective')).toBeInTheDocument()
  })

  it('makes home link clickable', () => {
    renderWithRouter(<Breadcrumb />, ['/timeline'])
    
    const homeLink = screen.getByText('Home')
    expect(homeLink.closest('a')).toHaveAttribute('href', '/')
  })

  it('shows current page as non-clickable text', () => {
    renderWithRouter(<Breadcrumb />, ['/timeline'])
    
    const currentPage = screen.getByText('Timeline')
    expect(currentPage).toHaveAttribute('aria-current', 'page')
    expect(currentPage.closest('a')).toBeNull()
  })

  it('includes proper separators between breadcrumb items', () => {
    renderWithRouter(<Breadcrumb />, ['/timeline'])
    
    const nav = screen.getByRole('navigation', { name: 'Breadcrumb' })
    const separators = nav.querySelectorAll('svg[aria-hidden="true"]')
    expect(separators).toHaveLength(1)
  })

  it('has proper semantic structure', () => {
    renderWithRouter(<Breadcrumb />, ['/timeline'])
    
    const nav = screen.getByRole('navigation', { name: 'Breadcrumb' })
    const list = nav.querySelector('ol')
    const items = nav.querySelectorAll('li')
    
    expect(list).toBeInTheDocument()
    expect(items).toHaveLength(2) // Home + Timeline
  })

  it('handles unknown routes gracefully', () => {
    renderWithRouter(<Breadcrumb />, ['/unknown-route'])
    
    expect(screen.getByText('Home')).toBeInTheDocument()
    expect(screen.getByText('Unknown-route')).toBeInTheDocument()
  })
})