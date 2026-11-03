import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router'
import { renderWithProviders } from '../../test/utils'
import { MainLayout } from './MainLayout'
import { useGlobalStore } from '@/stores/globalStore'

// Mock window.innerWidth for responsive tests
const mockInnerWidth = (width: number) => {
  Object.defineProperty(window, 'innerWidth', {
    writable: true,
    configurable: true,
    value: width,
  })
  window.dispatchEvent(new Event('resize'))
}

const renderWithRouter = (component: React.ReactElement) => {
  return renderWithProviders(component)
}

describe('MainLayout', () => {
  beforeEach(() => {
    // Reset to desktop size
    mockInnerWidth(1200)
    // Mock addEventListener and removeEventListener
    vi.spyOn(window, 'addEventListener')
    vi.spyOn(window, 'removeEventListener')
  })

  afterEach(() => {
    useGlobalStore.setState(state => ({
      uiState: { ...state.uiState, filterPanelOpen: false }
    }))
  })

  it('starts with the filter rail closed', () => {
    useGlobalStore.setState({ uiState: useGlobalStore.getInitialState().uiState })
    renderWithRouter(
      <MainLayout>
        <div>Test Content</div>
      </MainLayout>
    )

    expect(screen.queryByLabelText('Filter panel')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Show Filters' })).toBeInTheDocument()
  })

  // The store's view mode used to be synced from the URL only inside the
  // top-bar ViewSwitcher, so in the default sidebar layout the toolbar kept
  // the timeline's actions on every view.
  describe('view mode follows the route in sidebar layout', () => {
    const renderShellAt = (path: string) => {
      const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
      })
      return render(
        <QueryClientProvider client={queryClient}>
          <MemoryRouter initialEntries={[path]}>
            <MainLayout>
              <div>View</div>
            </MainLayout>
          </MemoryRouter>
        </QueryClientProvider>
      )
    }

    afterEach(() => {
      useGlobalStore.setState({ viewMode: 'timeline' })
    })

    it('shows each view\'s toolbar actions after navigating with the sidebar links', async () => {
      const user = userEvent.setup()
      useGlobalStore.setState(state => ({
        viewMode: 'timeline',
        userPreferences: { ...state.userPreferences, layoutMode: 'sidebar' },
      }))
      renderShellAt('/timeline')

      const toolbar = screen.getByRole('toolbar', { name: 'View toolbar' })
      expect(within(toolbar).getByRole('button', { name: 'Create Event' })).toBeInTheDocument()

      const sidebar = screen.getByLabelText('Sidebar navigation')
      await user.click(within(sidebar).getByRole('link', { name: /Causal Graph/ }))

      // The causal view has no toolbar actions of its own (its canvas carries
      // the layout and link controls): only the shared ones remain.
      await waitFor(() => {
        expect(useGlobalStore.getState().viewMode).toBe('causal')
      })
      expect(within(toolbar).queryByRole('button', { name: 'Create Event' })).not.toBeInTheDocument()
      expect(within(toolbar).getByRole('button', { name: 'Graph' })).toBeInTheDocument()

      await user.click(within(sidebar).getByRole('link', { name: /Actor Perspective/ }))

      await waitFor(() => {
        expect(within(toolbar).getByRole('button', { name: 'Statistics' })).toBeInTheDocument()
      })
      expect(within(toolbar).queryByRole('button', { name: 'Create Event' })).not.toBeInTheDocument()
      expect(useGlobalStore.getState().viewMode).toBe('actor-perspective')
    })

    it('takes the view mode from the URL on first load, whatever the store held', async () => {
      useGlobalStore.setState({ viewMode: 'timeline' })
      renderShellAt('/causal-graph')

      await waitFor(() => {
        expect(useGlobalStore.getState().viewMode).toBe('causal')
      })
      expect(screen.queryByRole('button', { name: 'Create Event' })).not.toBeInTheDocument()
    })
  })

  describe('skip link', () => {
    it('is the first focusable element and moves focus to the view region', async () => {
      const user = userEvent.setup()
      renderWithRouter(
        <MainLayout>
          <button type="button">Inside the view</button>
        </MainLayout>
      )

      await user.tab()
      const skip = screen.getByRole('link', { name: 'Skip to view' })
      expect(skip).toHaveFocus()
      // Visually hidden until focused.
      expect(skip).toHaveClass('sr-only', 'focus:not-sr-only')

      await user.click(skip)
      const main = screen.getByRole('main')
      expect(main).toHaveAttribute('id', 'main-view')
      expect(main).toHaveAttribute('tabindex', '-1')
      expect(main).toHaveFocus()

      // The next Tab continues inside the view, past the header and toolbar.
      await user.tab()
      expect(screen.getByRole('button', { name: 'Inside the view' })).toHaveFocus()
    })
  })

  describe('phone layout (below lg)', () => {
    afterEach(() => {
      mockInnerWidth(1200)
    })

    it('keeps help and the user menu in the header and moves graph tools to the More sheet', async () => {
      const user = userEvent.setup()
      mockInnerWidth(390)
      renderWithRouter(
        <MainLayout>
          <div>View</div>
        </MainLayout>
      )

      const header = screen.getByRole('banner')
      expect(within(header).getByRole('button', { name: 'Help and keyboard shortcuts' })).toBeInTheDocument()
      expect(within(header).getByRole('button', { name: 'User menu' })).toBeInTheDocument()

      // The toolbar keeps the view's primary actions and the filter toggle...
      const toolbar = within(header).getByRole('toolbar', { name: 'View toolbar' })
      expect(within(toolbar).getByRole('button', { name: 'Fit to View' })).toBeInTheDocument()
      expect(within(toolbar).getByRole('button', { name: 'Show Filters' })).toBeInTheDocument()
      // ...and the graph tools and streaming are not on it.
      for (const name of ['Graph', 'Compare branches', 'Import', 'Ingest']) {
        expect(within(toolbar).queryByRole('button', { name })).not.toBeInTheDocument()
      }
      expect(within(header).queryByRole('status', { name: /streaming/i })).not.toBeInTheDocument()

      // They are in the bottom bar's More sheet.
      const more = within(screen.getByRole('navigation', { name: 'Mobile navigation' })).getByRole('button', { name: 'More' })
      expect(more).toHaveAttribute('aria-expanded', 'false')
      await user.click(more)
      const sheet = screen.getByRole('dialog', { name: 'More' })
      expect(more).toHaveAttribute('aria-expanded', 'true')
      for (const name of ['Branch or copy…', 'Copy progress', 'Copy history', 'Export', 'Versions', 'Compare branches', 'Import', 'Ingest']) {
        expect(within(sheet).getByRole('button', { name: new RegExp(`^${name}`) })).toBeInTheDocument()
      }
      expect(within(sheet).getByRole('status', { name: /streaming/i })).toBeInTheDocument()

      // Choosing an item closes the sheet and opens the tool.
      await user.click(within(sheet).getByRole('button', { name: /^Copy history/ }))
      expect(screen.queryByRole('dialog', { name: 'More' })).not.toBeInTheDocument()
      expect(screen.getByRole('dialog', { name: 'Copy history' })).toBeInTheDocument()
    })

    it('closes the More sheet on Escape and returns focus to the More button', async () => {
      const user = userEvent.setup()
      mockInnerWidth(390)
      renderWithRouter(
        <MainLayout>
          <div>View</div>
        </MainLayout>
      )

      const more = screen.getByRole('button', { name: 'More' })
      await user.click(more)
      expect(screen.getByRole('dialog', { name: 'More' })).toBeInTheDocument()

      await user.keyboard('{Escape}')
      expect(screen.queryByRole('dialog', { name: 'More' })).not.toBeInTheDocument()
      expect(more).toHaveFocus()
    })
  })

  it('renders children correctly', () => {
    renderWithRouter(
      <MainLayout>
        <div>Test Content</div>
      </MainLayout>
    )

    expect(screen.getByText('Test Content')).toBeInTheDocument()
  })

  it('renders header with title', () => {
    renderWithRouter(
      <MainLayout>
        <div>Test Content</div>
      </MainLayout>
    )

    expect(screen.getByText('althistory')).toBeInTheDocument()
  })

  it('has proper semantic structure', () => {
    renderWithRouter(
      <MainLayout>
        <div>Test Content</div>
      </MainLayout>
    )

    expect(screen.getByRole('banner')).toBeInTheDocument()
    expect(screen.getByRole('main')).toBeInTheDocument()
  })

  it('renders sidebar on desktop in sidebar mode', () => {
    renderWithRouter(
      <MainLayout>
        <div>Test Content</div>
      </MainLayout>
    )

    expect(screen.getByLabelText('Sidebar navigation')).toBeInTheDocument()
  })

  it('hides sidebar on mobile', async () => {
    renderWithRouter(
      <MainLayout>
        <div>Test Content</div>
      </MainLayout>
    )

    mockInnerWidth(800)

    await waitFor(() => {
      expect(screen.queryByLabelText('Sidebar navigation')).not.toBeInTheDocument()
    })
  })

  it('shows mobile bottom bar on mobile', async () => {
    renderWithRouter(
      <MainLayout>
        <div>Test Content</div>
      </MainLayout>
    )

    mockInnerWidth(800)

    await waitFor(() => {
      expect(screen.getByRole('navigation', { name: 'Mobile navigation' })).toBeInTheDocument()
    })
  })

  it('provides keyboard navigation support', () => {
    renderWithRouter(
      <MainLayout>
        <div>Test Content</div>
      </MainLayout>
    )

    const main = screen.getByRole('main')
    expect(main).toHaveAttribute('tabIndex', '-1')
  })

  it('sets up resize event listeners', () => {
    renderWithRouter(
      <MainLayout>
        <div>Test Content</div>
      </MainLayout>
    )

    expect(window.addEventListener).toHaveBeenCalledWith('resize', expect.any(Function))
  })

  it('renders user profile menu in sidebar on desktop sidebar mode', () => {
    renderWithRouter(
      <MainLayout>
        <div>Test Content</div>
      </MainLayout>
    )

    // In sidebar mode on desktop, user menu should be in sidebar only
    const userMenus = screen.getAllByLabelText('User menu')
    expect(userMenus).toHaveLength(1)
  })

  it('mounts the filter panel when the toolbar toggle is open', () => {
    useGlobalStore.setState(state => ({
      uiState: { ...state.uiState, filterPanelOpen: true }
    }))
    renderWithRouter(
      <MainLayout>
        <div>Test Content</div>
      </MainLayout>
    )

    expect(screen.getByLabelText('Filter panel')).toBeInTheDocument()
  })

  it('unmounts the filter panel when the toolbar toggle is closed', () => {
    useGlobalStore.setState(state => ({
      uiState: { ...state.uiState, filterPanelOpen: false }
    }))
    renderWithRouter(
      <MainLayout>
        <div>Test Content</div>
      </MainLayout>
    )

    expect(screen.queryByLabelText('Filter panel')).not.toBeInTheDocument()
  })

  describe('theme sync', () => {
    // A controllable stand-in for the OS appearance query
    const installColorScheme = (initiallyDark: boolean) => {
      const listeners = new Set<() => void>()
      const query = {
        matches: initiallyDark,
        media: '(prefers-color-scheme: dark)',
        addEventListener: (_: string, fn: () => void) => listeners.add(fn),
        removeEventListener: (_: string, fn: () => void) => listeners.delete(fn),
      }
      const original = window.matchMedia
      window.matchMedia = vi.fn(() => query) as unknown as typeof window.matchMedia
      return {
        setDark(dark: boolean) {
          query.matches = dark
          listeners.forEach(fn => fn())
        },
        restore() {
          window.matchMedia = original
        },
      }
    }

    afterEach(() => {
      document.documentElement.classList.remove('dark')
      useGlobalStore.setState(state => ({
        userPreferences: { ...state.userPreferences, theme: 'system' },
      }))
    })

    it('applies html.dark for an explicit dark theme, and removes it for light', async () => {
      const scheme = installColorScheme(false)
      useGlobalStore.setState(state => ({ userPreferences: { ...state.userPreferences, theme: 'dark' } }))
      renderWithRouter(<MainLayout><div /></MainLayout>)
      await waitFor(() => expect(document.documentElement).toHaveClass('dark'))

      useGlobalStore.setState(state => ({ userPreferences: { ...state.userPreferences, theme: 'light' } }))
      await waitFor(() => expect(document.documentElement).not.toHaveClass('dark'))
      scheme.restore()
    })

    it('follows the OS appearance live when the theme is system', async () => {
      const scheme = installColorScheme(false)
      useGlobalStore.setState(state => ({ userPreferences: { ...state.userPreferences, theme: 'system' } }))
      renderWithRouter(<MainLayout><div /></MainLayout>)
      expect(document.documentElement).not.toHaveClass('dark')

      scheme.setDark(true)
      expect(document.documentElement).toHaveClass('dark')

      scheme.setDark(false)
      expect(document.documentElement).not.toHaveClass('dark')
      scheme.restore()
    })
  })
})
