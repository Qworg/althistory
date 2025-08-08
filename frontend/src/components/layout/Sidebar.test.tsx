import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { BrowserRouter } from 'react-router'
import { Sidebar } from './Sidebar'

const renderWithRouter = (component: React.ReactElement) => {
  return render(
    <BrowserRouter>
      {component}
    </BrowserRouter>
  )
}

describe('Sidebar', () => {
  it('renders all navigation items when expanded', () => {
    renderWithRouter(<Sidebar isCollapsed={false} />)
    
    expect(screen.getByText('Timeline')).toBeInTheDocument()
    expect(screen.getByText('Causal Graph')).toBeInTheDocument()
    expect(screen.getByText('Actor Perspective')).toBeInTheDocument()
  })

  it('shows descriptions when expanded', () => {
    renderWithRouter(<Sidebar isCollapsed={false} />)
    
    expect(screen.getByText('View events chronologically')).toBeInTheDocument()
    expect(screen.getByText('Explore cause-effect relationships')).toBeInTheDocument()
    expect(screen.getByText('Focus on specific actors')).toBeInTheDocument()
  })

  it('hides text content when collapsed', () => {
    renderWithRouter(<Sidebar isCollapsed={true} />)
    
    expect(screen.queryByText('Timeline')).not.toBeInTheDocument()
    expect(screen.queryByText('View events chronologically')).not.toBeInTheDocument()
  })

  it('shows icons even when collapsed', () => {
    renderWithRouter(<Sidebar isCollapsed={true} />)
    
    const links = screen.getAllByRole('link')
    expect(links[0]).toHaveTextContent('📊')
    expect(links[1]).toHaveTextContent('🔗')
    expect(links[2]).toHaveTextContent('👤')
  })

  it('calls onToggleCollapse when toggle button is clicked', () => {
    const onToggle = vi.fn()
    renderWithRouter(<Sidebar onToggleCollapse={onToggle} />)
    
    const toggleButton = screen.getByLabelText('Collapse sidebar')
    fireEvent.click(toggleButton)
    
    expect(onToggle).toHaveBeenCalledOnce()
  })

  it('updates toggle button label when collapsed', () => {
    renderWithRouter(<Sidebar isCollapsed={true} />)
    
    expect(screen.getByLabelText('Expand sidebar')).toBeInTheDocument()
  })

  it('shows version information when expanded', () => {
    renderWithRouter(<Sidebar isCollapsed={false} />)
    
    expect(screen.getByText('Timeline Interface v1.0')).toBeInTheDocument()
  })

  it('hides version information when collapsed', () => {
    renderWithRouter(<Sidebar isCollapsed={true} />)
    
    expect(screen.queryByText('Timeline Interface v1.0')).not.toBeInTheDocument()
  })

  it('has proper semantic structure', () => {
    renderWithRouter(<Sidebar />)
    
    expect(screen.getByLabelText('Sidebar navigation')).toBeInTheDocument()
    expect(screen.getByRole('navigation')).toBeInTheDocument()
  })

  it('applies correct width classes based on collapsed state', () => {
    const { rerender } = renderWithRouter(<Sidebar isCollapsed={false} />)
    
    const sidebar = screen.getByLabelText('Sidebar navigation')
    expect(sidebar).toHaveClass('w-64')
    
    rerender(
      <BrowserRouter>
        <Sidebar isCollapsed={true} />
      </BrowserRouter>
    )
    
    expect(sidebar).toHaveClass('w-16')
  })

  it('provides tooltips for collapsed items', () => {
    renderWithRouter(<Sidebar isCollapsed={true} />)
    
    const timelineLink = screen.getAllByRole('link')[0]
    expect(timelineLink).toHaveAttribute('title', 'Timeline')
  })

  it('does not provide tooltips for expanded items', () => {
    renderWithRouter(<Sidebar isCollapsed={false} />)
    
    const timelineLink = screen.getAllByRole('link')[0]
    expect(timelineLink).not.toHaveAttribute('title')
  })
})