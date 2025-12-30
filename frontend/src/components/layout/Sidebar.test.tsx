import { describe, it, expect } from 'vitest'
import { screen } from '@testing-library/react'
import { renderWithProviders } from '../../test/utils'
import { Sidebar } from './Sidebar'

describe('Sidebar', () => {
  it('renders all navigation items', () => {
    renderWithProviders(<Sidebar />)

    expect(screen.getByText('Timeline')).toBeInTheDocument()
    expect(screen.getByText('Causal Graph')).toBeInTheDocument()
    expect(screen.getByText('Actor Perspective')).toBeInTheDocument()
  })

  it('shows descriptions for navigation items', () => {
    renderWithProviders(<Sidebar />)

    expect(screen.getByText('View events chronologically')).toBeInTheDocument()
    expect(screen.getByText('Explore cause-effect relationships')).toBeInTheDocument()
    expect(screen.getByText('Focus on specific actors')).toBeInTheDocument()
  })

  it('shows icons for each navigation item', () => {
    renderWithProviders(<Sidebar />)

    expect(screen.getByText('📊')).toBeInTheDocument()
    expect(screen.getByText('🔗')).toBeInTheDocument()
    expect(screen.getByText('👤')).toBeInTheDocument()
  })

  it('shows version information', () => {
    renderWithProviders(<Sidebar />)

    expect(screen.getByText('Timeline Interface v1.0')).toBeInTheDocument()
  })

  it('has proper semantic structure', () => {
    renderWithProviders(<Sidebar />)

    expect(screen.getByLabelText('Sidebar navigation')).toBeInTheDocument()
    expect(screen.getByRole('navigation')).toBeInTheDocument()
  })

  it('has fixed width', () => {
    renderWithProviders(<Sidebar />)

    const sidebar = screen.getByLabelText('Sidebar navigation')
    expect(sidebar).toHaveClass('w-64')
  })

  it('renders Views header', () => {
    renderWithProviders(<Sidebar />)

    expect(screen.getByText('Views')).toBeInTheDocument()
  })

  it('renders user profile menu', () => {
    renderWithProviders(<Sidebar />)

    expect(screen.getByLabelText('User menu')).toBeInTheDocument()
  })
})
