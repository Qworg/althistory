import { describe, it, expect, afterEach } from 'vitest'
import { act, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from '../../test/utils'
import { Sidebar } from './Sidebar'
import { useGlobalStore } from '@/stores/globalStore'

describe('Sidebar', () => {
  afterEach(() => {
    act(() => useGlobalStore.getState().setSidebarCollapsed(false))
  })

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

    expect(screen.getByTestId('sidebar-icon-timeline').querySelector('svg')).toBeInTheDocument()
    expect(screen.getByTestId('sidebar-icon-causal-graph').querySelector('svg')).toBeInTheDocument()
    expect(screen.getByTestId('sidebar-icon-actor-perspective').querySelector('svg')).toBeInTheDocument()
  })

  it('shows version information', () => {
    renderWithProviders(<Sidebar />)

    // One compact row with the user menu; the full name is its tooltip.
    expect(screen.getByText('v1.0')).toHaveAttribute('title', 'althistory v1.0')
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

  it('renders a Views heading for the outline', () => {
    renderWithProviders(<Sidebar />)

    expect(screen.getByText('Views')).toBeInTheDocument()
  })

  it('renders user profile menu', () => {
    renderWithProviders(<Sidebar />)

    expect(screen.getByLabelText('Settings')).toBeInTheDocument()
  })

  describe('collapsing to an icon rail', () => {
    it('starts expanded, with the toggle saying so', () => {
      renderWithProviders(<Sidebar />)

      const toggle = screen.getByRole('button', { name: 'Collapse sidebar' })
      expect(toggle).toHaveAttribute('aria-expanded', 'true')
      expect(screen.getByLabelText('Sidebar navigation')).toHaveClass('w-64')
    })

    it('collapses to a narrow rail whose links keep their view names', async () => {
      const user = userEvent.setup()
      renderWithProviders(<Sidebar />)

      await user.click(screen.getByRole('button', { name: 'Collapse sidebar' }))

      const sidebar = screen.getByLabelText('Sidebar navigation')
      expect(sidebar).toHaveClass('w-14')
      expect(sidebar).not.toHaveClass('w-64')
      // Labels and descriptions are gone visually...
      expect(screen.queryByText('View events chronologically')).not.toBeInTheDocument()
      expect(screen.queryByText('v1.0')).not.toBeInTheDocument()
      // ...but every link is still named, with a tooltip, and keeps its icon.
      for (const name of ['Timeline', 'Causal Graph', 'Actor Perspective']) {
        const link = screen.getByRole('link', { name })
        expect(link).toHaveAttribute('title', name)
      }
      expect(screen.getByTestId('sidebar-icon-causal-graph').querySelector('svg')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Settings' })).toBeInTheDocument()

      const toggle = screen.getByRole('button', { name: 'Expand sidebar' })
      expect(toggle).toHaveAttribute('aria-expanded', 'false')
    })

    it('remembers the choice as a user preference and expands again', async () => {
      const user = userEvent.setup()
      renderWithProviders(<Sidebar />)

      await user.click(screen.getByRole('button', { name: 'Collapse sidebar' }))
      expect(useGlobalStore.getState().userPreferences.sidebarCollapsed).toBe(true)

      await user.click(screen.getByRole('button', { name: 'Expand sidebar' }))
      expect(useGlobalStore.getState().userPreferences.sidebarCollapsed).toBe(false)
      expect(screen.getByText('View events chronologically')).toBeInTheDocument()
    })

    it('renders collapsed when the preference was saved collapsed', () => {
      useGlobalStore.getState().setSidebarCollapsed(true)
      renderWithProviders(<Sidebar />)

      expect(screen.getByLabelText('Sidebar navigation')).toHaveClass('w-14')
      expect(screen.getByRole('button', { name: 'Expand sidebar' })).toBeInTheDocument()
    })
  })
})
