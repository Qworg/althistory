import { describe, it, expect } from 'vitest'
import { screen } from '@testing-library/react'
import { renderWithProviders } from '../../test/utils'
import { Navigation } from './Navigation'

const renderWithRouter = (component: React.ReactElement) => {
  return renderWithProviders(component)
}

describe('Navigation', () => {
  it('renders all navigation items', () => {
    renderWithRouter(<Navigation />)

    expect(screen.getByText('Timeline')).toBeInTheDocument()
    expect(screen.getByText('Causal Graph')).toBeInTheDocument()
    expect(screen.getByText('Actor Perspective')).toBeInTheDocument()
  })

  it('has proper navigation role', () => {
    renderWithRouter(<Navigation />)

    expect(screen.getByRole('navigation', { name: 'Main navigation' })).toBeInTheDocument()
  })

  it('shows icons for each navigation item', () => {
    renderWithRouter(<Navigation />)

    const timelineLink = screen.getByText('Timeline').closest('button')
    const causalGraphLink = screen.getByText('Causal Graph').closest('button')
    const actorPerspectiveLink = screen.getByText('Actor Perspective').closest('button')

    expect(timelineLink).toBeTruthy()
    expect(causalGraphLink).toBeTruthy()
    expect(actorPerspectiveLink).toBeTruthy()

    // Check that SVG icons are present
    expect(timelineLink?.querySelector('svg')).toBeTruthy()
    expect(causalGraphLink?.querySelector('svg')).toBeTruthy()
    expect(actorPerspectiveLink?.querySelector('svg')).toBeTruthy()
  })

  it('renders horizontal view switcher', () => {
    renderWithRouter(<Navigation />)

    const nav = screen.getByRole('navigation', { name: 'Main navigation' })
    expect(nav).toHaveClass('flex')
  })
})
