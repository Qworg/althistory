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

    expect(screen.getByText('althistory')).toBeInTheDocument()
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

    expect(screen.queryByLabelText('Settings')).not.toBeInTheDocument()
  })

  it('shows user menu in topbar mode on desktop', () => {
    renderWithProviders(<Header isMobile={false} layoutMode="topbar" />)

    expect(screen.getByLabelText('Settings')).toBeInTheDocument()
  })

  it('shows user menu on mobile regardless of layout mode', () => {
    renderWithProviders(<Header isMobile={true} layoutMode="sidebar" />)

    expect(screen.getByLabelText('Settings')).toBeInTheDocument()
  })

  it('shows the help button in every layout', () => {
    for (const props of [
      { isMobile: false, layoutMode: 'sidebar' as const },
      { isMobile: false, layoutMode: 'topbar' as const },
      { isMobile: true, layoutMode: 'sidebar' as const },
    ]) {
      const { unmount } = renderWithProviders(<Header {...props} />)
      const button = screen.getByRole('button', { name: /^Help: keyboard shortcuts/ })
      expect(button).toHaveAttribute('aria-haspopup', 'dialog')
      unmount()
    }
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

  describe('phone layout', () => {
    it('keeps the heading for screen readers but gives its width to the graph selector', () => {
      renderWithProviders(<Header isMobile={true} layoutMode="sidebar" />)

      const heading = screen.getByRole('heading', { level: 1, name: 'althistory' })
      expect(heading).toHaveClass('sr-only')
    })

    it('shows the wordmark on desktop', () => {
      renderWithProviders(<Header {...defaultProps} />)

      expect(screen.getByRole('heading', { level: 1, name: 'althistory' })).not.toHaveClass('sr-only')
    })

    it('gives help and the user menu 44px targets that do not shrink away', () => {
      renderWithProviders(<Header isMobile={true} layoutMode="sidebar" />)

      expect(screen.getByRole('button', { name: /^Help: keyboard shortcuts/ })).toHaveClass('h-11', 'w-11', 'shrink-0')
      expect(screen.getByRole('button', { name: 'Settings' })).toHaveClass('h-11', 'w-11')
    })

    it('uses the compact toolbar, with no breadcrumb (the bottom bar names the view)', () => {
      renderWithProviders(<Header isMobile={true} layoutMode="sidebar" />)

      const toolbar = screen.getByRole('toolbar', { name: 'View toolbar' })
      expect(toolbar).not.toHaveClass('flex-wrap')
      expect(screen.queryByRole('button', { name: 'Graph' })).not.toBeInTheDocument()
      expect(screen.queryByRole('navigation', { name: 'Breadcrumb' })).not.toBeInTheDocument()
    })
  })
})
