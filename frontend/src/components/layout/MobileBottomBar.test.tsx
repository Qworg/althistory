import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { MobileBottomBar } from './MobileBottomBar'
import { useMoreSheetStore } from './moreSheetStore'

const renderAt = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <MobileBottomBar />
    </MemoryRouter>
  )

describe('MobileBottomBar', () => {
  it('links to the three views', () => {
    renderAt('/timeline')

    const nav = screen.getByRole('navigation', { name: 'Mobile navigation' })
    expect(nav).toHaveClass('bg-card', 'border-line')
    expect(screen.getByRole('link', { name: 'Timeline' })).toHaveAttribute('href', '/timeline')
    expect(screen.getByRole('link', { name: 'Causal' })).toHaveAttribute('href', '/causal-graph')
    expect(screen.getByRole('link', { name: 'Actors' })).toHaveAttribute('href', '/actor-perspective')
  })

  it('draws each view with a decorative stroke icon', () => {
    renderAt('/timeline')

    for (const link of screen.getAllByRole('link')) {
      const icon = link.querySelector('svg')
      expect(icon).toHaveAttribute('aria-hidden', 'true')
      expect(icon).toHaveAttribute('stroke', 'currentColor')
      expect(icon).toHaveAttribute('fill', 'none')
    }
  })

  it('marks the current view', () => {
    renderAt('/causal-graph')

    expect(screen.getByRole('link', { name: 'Causal' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: 'Timeline' })).not.toHaveAttribute('aria-current')
  })

  describe('More', () => {
    afterEach(() => useMoreSheetStore.setState({ isOpen: false }))

    it('opens and closes the More sheet, announcing its state', () => {
      renderAt('/timeline')

      const more = screen.getByRole('button', { name: 'More' })
      expect(more).toHaveAttribute('aria-haspopup', 'dialog')
      expect(more).toHaveAttribute('aria-expanded', 'false')

      fireEvent.click(more)
      expect(useMoreSheetStore.getState().isOpen).toBe(true)
      expect(more).toHaveAttribute('aria-expanded', 'true')

      fireEvent.click(more)
      expect(useMoreSheetStore.getState().isOpen).toBe(false)
    })

    it('sits under the header, so the dialogs the header opens cover it', () => {
      renderAt('/timeline')

      expect(screen.getByRole('navigation', { name: 'Mobile navigation' })).toHaveClass('z-30')
    })
  })
})
