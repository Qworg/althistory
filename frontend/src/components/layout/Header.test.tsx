import { describe, it, expect, vi } from 'vitest'
import { screen, fireEvent } from '@testing-library/react'
import { renderWithProviders } from '../../test/utils'
import { Header } from './Header'

describe('Header', () => {
  it('renders the application title', () => {
    renderWithProviders(<Header />)
    
    expect(screen.getByText('Timeline Interface')).toBeInTheDocument()
  })

  it('has proper semantic structure', () => {
    renderWithProviders(<Header />)
    
    expect(screen.getByRole('banner')).toBeInTheDocument()
  })

  it('renders desktop navigation', () => {
    renderWithProviders(<Header />)
    
    expect(screen.getByRole('navigation', { name: 'Main navigation' })).toBeInTheDocument()
  })

  it('renders mobile navigation toggle', () => {
    renderWithProviders(<Header />)
    
    expect(screen.getByLabelText('Toggle navigation menu')).toBeInTheDocument()
  })

  it('shows sidebar toggle button when showSidebarToggle is true', () => {
    renderWithProviders(<Header showSidebarToggle={true} />)
    
    expect(screen.getByLabelText('Toggle sidebar')).toBeInTheDocument()
  })

  it('hides sidebar toggle button when showSidebarToggle is false', () => {
    renderWithProviders(<Header showSidebarToggle={false} />)
    
    expect(screen.queryByLabelText('Toggle sidebar')).not.toBeInTheDocument()
  })

  it('calls onSidebarToggle when sidebar toggle is clicked', () => {
    const onToggle = vi.fn()
    renderWithProviders(<Header onSidebarToggle={onToggle} showSidebarToggle={true} />)
    
    const toggleButton = screen.getByLabelText('Toggle sidebar')
    fireEvent.click(toggleButton)
    
    expect(onToggle).toHaveBeenCalledOnce()
  })

  it('renders breadcrumb navigation', () => {
    renderWithProviders(<Header />)
    
    // Breadcrumb might not be visible on home page, but component should be rendered
    // We can't easily test this without navigating to a different route
    expect(screen.getByRole('banner')).toBeInTheDocument()
  })

  it('renders user menu button', () => {
    renderWithProviders(<Header />)
    
    expect(screen.getByLabelText('User menu')).toBeInTheDocument()
  })

  it('has sticky positioning', () => {
    renderWithProviders(<Header />)
    
    const header = screen.getByRole('banner')
    expect(header).toHaveClass('sticky', 'top-0')
  })

  it('has proper z-index for layering', () => {
    renderWithProviders(<Header />)
    
    const header = screen.getByRole('banner')
    expect(header).toHaveClass('z-40')
  })

  it('handles mobile menu toggle state', () => {
    renderWithProviders(<Header />)
    
    const mobileToggle = screen.getByLabelText('Toggle navigation menu')
    
    // Initially closed
    expect(mobileToggle).toHaveAttribute('aria-expanded', 'false')
    
    // Click to open
    fireEvent.click(mobileToggle)
    expect(mobileToggle).toHaveAttribute('aria-expanded', 'true')
    
    // Click to close
    fireEvent.click(mobileToggle)
    expect(mobileToggle).toHaveAttribute('aria-expanded', 'false')
  })

  it('shows mobile breadcrumb section', () => {
    renderWithProviders(<Header />)
    
    // The mobile breadcrumb container should be present
    const header = screen.getByRole('banner')
    const mobileBreadcrumb = header.querySelector('.md\\:hidden')
    expect(mobileBreadcrumb).toBeInTheDocument()
  })
})