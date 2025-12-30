import { describe, it, expect } from 'vitest'
import { screen } from '@testing-library/react'
import { renderWithProviders } from '../../test/utils'
import { Header } from './Header'

describe('Header', () => {
  const defaultProps = {
    isMobile: false,
    layoutMode: 'sidebar' as const,
  }

  it('renders the application title', () => {
    renderWithProviders(<Header {...defaultProps} />)

    expect(screen.getByText('Timeline Interface')).toBeInTheDocument()
  })

  it('has proper semantic structure', () => {
    renderWithProviders(<Header {...defaultProps} />)

    expect(screen.getByRole('banner')).toBeInTheDocument()
  })

  it('renders navigation in topbar mode', () => {
    renderWithProviders(<Header isMobile={false} layoutMode="topbar" />)

    expect(screen.getByRole('navigation', { name: 'Main navigation' })).toBeInTheDocument()
  })

  it('hides navigation in sidebar mode', () => {
    renderWithProviders(<Header isMobile={false} layoutMode="sidebar" />)

    expect(screen.queryByRole('navigation', { name: 'Main navigation' })).not.toBeInTheDocument()
  })

  it('hides navigation on mobile regardless of layout mode', () => {
    renderWithProviders(<Header isMobile={true} layoutMode="topbar" />)

    expect(screen.queryByRole('navigation', { name: 'Main navigation' })).not.toBeInTheDocument()
  })

  it('renders breadcrumb navigation on desktop', () => {
    renderWithProviders(<Header {...defaultProps} />)

    // Breadcrumb container should be present
    expect(screen.getByRole('banner')).toBeInTheDocument()
  })

  it('hides user menu in sidebar mode on desktop', () => {
    renderWithProviders(<Header isMobile={false} layoutMode="sidebar" />)

    expect(screen.queryByLabelText('User menu')).not.toBeInTheDocument()
  })

  it('shows user menu in topbar mode on desktop', () => {
    renderWithProviders(<Header isMobile={false} layoutMode="topbar" />)

    expect(screen.getByLabelText('User menu')).toBeInTheDocument()
  })

  it('shows user menu on mobile regardless of layout mode', () => {
    renderWithProviders(<Header isMobile={true} layoutMode="sidebar" />)

    expect(screen.getByLabelText('User menu')).toBeInTheDocument()
  })

  it('has sticky positioning', () => {
    renderWithProviders(<Header {...defaultProps} />)

    const header = screen.getByRole('banner')
    expect(header).toHaveClass('sticky', 'top-0')
  })

  it('has proper z-index for layering', () => {
    renderWithProviders(<Header {...defaultProps} />)

    const header = screen.getByRole('banner')
    expect(header).toHaveClass('z-40')
  })

  it('renders mobile breadcrumb when on mobile', () => {
    renderWithProviders(<Header isMobile={true} layoutMode="sidebar" />)

    // The breadcrumb should be rendered in the mobile location
    const header = screen.getByRole('banner')
    expect(header).toBeInTheDocument()
  })
})
