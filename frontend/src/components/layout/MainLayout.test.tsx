import { describe, it, expect, beforeEach, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '../../test/utils'
import { MainLayout } from './MainLayout'

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

    expect(screen.getByText('Timeline Interface')).toBeInTheDocument()
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
})
