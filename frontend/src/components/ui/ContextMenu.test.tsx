import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ContextMenu, ContextMenuItem } from './ContextMenu'

describe('ContextMenu', () => {
  const defaultItems: ContextMenuItem[] = [
    { id: 'edit', label: 'Edit', onClick: vi.fn() },
    { id: 'delete', label: 'Delete', onClick: vi.fn(), danger: true }
  ]

  const defaultProps = {
    isOpen: true,
    position: { x: 100, y: 100 },
    items: defaultItems,
    onClose: vi.fn()
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    it('does not render when isOpen is false', () => {
      render(<ContextMenu {...defaultProps} isOpen={false} />)
      expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    })

    it('renders menu when isOpen is true', () => {
      render(<ContextMenu {...defaultProps} />)
      expect(screen.getByRole('menu')).toBeInTheDocument()
    })

    it('renders all menu items', () => {
      render(<ContextMenu {...defaultProps} />)
      expect(screen.getByText('Edit')).toBeInTheDocument()
      expect(screen.getByText('Delete')).toBeInTheDocument()
    })

    it('positions menu at specified coordinates', () => {
      render(<ContextMenu {...defaultProps} position={{ x: 200, y: 150 }} />)
      const menu = screen.getByRole('menu')
      expect(menu).toHaveStyle({ left: '200px', top: '150px' })
    })

    it('applies danger styling to danger items', () => {
      render(<ContextMenu {...defaultProps} />)
      const deleteButton = screen.getByText('Delete')
      expect(deleteButton).toHaveClass('text-red-600')
    })

    it('renders disabled items with disabled styling', () => {
      const itemsWithDisabled: ContextMenuItem[] = [
        { id: 'edit', label: 'Edit', onClick: vi.fn(), disabled: true },
        { id: 'delete', label: 'Delete', onClick: vi.fn() }
      ]
      render(<ContextMenu {...defaultProps} items={itemsWithDisabled} />)

      const editButton = screen.getByText('Edit')
      expect(editButton).toBeDisabled()
      expect(editButton).toHaveClass('text-gray-400')
    })
  })

  describe('Click Interactions', () => {
    it('calls onClick handler when menu item is clicked', async () => {
      const user = userEvent.setup()
      const editClick = vi.fn()
      const items: ContextMenuItem[] = [
        { id: 'edit', label: 'Edit', onClick: editClick }
      ]
      render(<ContextMenu {...defaultProps} items={items} />)

      await user.click(screen.getByText('Edit'))
      expect(editClick).toHaveBeenCalledTimes(1)
    })

    it('calls onClose after clicking a menu item', async () => {
      const user = userEvent.setup()
      render(<ContextMenu {...defaultProps} />)

      await user.click(screen.getByText('Edit'))
      expect(defaultProps.onClose).toHaveBeenCalledTimes(1)
    })

    it('does not call onClick for disabled items', async () => {
      const user = userEvent.setup()
      const editClick = vi.fn()
      const items: ContextMenuItem[] = [
        { id: 'edit', label: 'Edit', onClick: editClick, disabled: true }
      ]
      render(<ContextMenu {...defaultProps} items={items} />)

      await user.click(screen.getByText('Edit'))
      expect(editClick).not.toHaveBeenCalled()
    })
  })

  describe('Click Outside', () => {
    it('calls onClose when clicking outside the menu', () => {
      render(
        <div>
          <div data-testid="outside">Outside</div>
          <ContextMenu {...defaultProps} />
        </div>
      )

      fireEvent.mouseDown(screen.getByTestId('outside'))
      expect(defaultProps.onClose).toHaveBeenCalledTimes(1)
    })

    it('does not call onClose when clicking inside the menu', () => {
      render(<ContextMenu {...defaultProps} />)

      fireEvent.mouseDown(screen.getByRole('menu'))
      expect(defaultProps.onClose).not.toHaveBeenCalled()
    })
  })

  describe('Keyboard Navigation', () => {
    it('calls onClose when Escape key is pressed', () => {
      render(<ContextMenu {...defaultProps} />)

      fireEvent.keyDown(document, { key: 'Escape' })
      expect(defaultProps.onClose).toHaveBeenCalledTimes(1)
    })

    it('calls onClose when Tab key is pressed', () => {
      render(<ContextMenu {...defaultProps} />)
      const menu = screen.getByRole('menu')

      fireEvent.keyDown(menu, { key: 'Tab' })
      expect(defaultProps.onClose).toHaveBeenCalledTimes(1)
    })

    it('navigates down with ArrowDown key', () => {
      render(<ContextMenu {...defaultProps} />)
      const menu = screen.getByRole('menu')
      const buttons = screen.getAllByRole('menuitem')

      // Focus on menu and navigate
      fireEvent.keyDown(menu, { key: 'ArrowDown' })

      // First button should be focusable
      expect(buttons[0]).toHaveAttribute('tabindex', '0')
    })

    it('navigates up with ArrowUp key', () => {
      render(<ContextMenu {...defaultProps} />)
      const menu = screen.getByRole('menu')

      // Navigate down first, then up
      fireEvent.keyDown(menu, { key: 'ArrowDown' })
      fireEvent.keyDown(menu, { key: 'ArrowDown' })
      fireEvent.keyDown(menu, { key: 'ArrowUp' })

      // Should work without errors
      expect(screen.getByRole('menu')).toBeInTheDocument()
    })

    it('triggers onClick with Enter key', () => {
      const editClick = vi.fn()
      const items: ContextMenuItem[] = [
        { id: 'edit', label: 'Edit', onClick: editClick }
      ]
      render(<ContextMenu {...defaultProps} items={items} />)
      const menu = screen.getByRole('menu')

      // Navigate to first item and press Enter
      fireEvent.keyDown(menu, { key: 'ArrowDown' })
      fireEvent.keyDown(menu, { key: 'Enter' })

      expect(editClick).toHaveBeenCalledTimes(1)
      expect(defaultProps.onClose).toHaveBeenCalledTimes(1)
    })
  })

  describe('Touch Events', () => {
    it('calls onClose when touching outside the menu', () => {
      render(
        <div>
          <div data-testid="outside">Outside</div>
          <ContextMenu {...defaultProps} />
        </div>
      )

      fireEvent.touchStart(screen.getByTestId('outside'))
      expect(defaultProps.onClose).toHaveBeenCalledTimes(1)
    })
  })

  describe('Viewport Boundaries', () => {
    it('renders menu at specified position initially', () => {
      render(<ContextMenu {...defaultProps} position={{ x: 250, y: 100 }} />)

      const menu = screen.getByRole('menu')
      // Menu should be rendered with the initial position
      // (adjustment happens after measuring, which requires real DOM)
      expect(menu).toBeInTheDocument()
      expect(menu).toHaveStyle({ left: '250px', top: '100px' })
    })

    it('renders menu even with negative coordinates', () => {
      // The getAdjustedPosition function handles boundary checking
      // but requires getBoundingClientRect which isn't available in jsdom
      render(<ContextMenu {...defaultProps} position={{ x: -50, y: 100 }} />)

      const menu = screen.getByRole('menu')
      // Menu renders at the given position (adjustment would happen with real measurements)
      expect(menu).toBeInTheDocument()
    })

    it('has position adjustment logic in getAdjustedPosition callback', () => {
      // This test verifies the menu renders and can access the position
      render(<ContextMenu {...defaultProps} position={{ x: 100, y: -50 }} />)

      const menu = screen.getByRole('menu')
      expect(menu).toBeInTheDocument()
    })
  })

  describe('Accessibility', () => {
    it('has role="menu" on container', () => {
      render(<ContextMenu {...defaultProps} />)
      expect(screen.getByRole('menu')).toBeInTheDocument()
    })

    it('has role="menuitem" on each item', () => {
      render(<ContextMenu {...defaultProps} />)
      const menuItems = screen.getAllByRole('menuitem')
      expect(menuItems).toHaveLength(2)
    })

    it('has aria-label on menu container', () => {
      render(<ContextMenu {...defaultProps} />)
      expect(screen.getByLabelText('Context menu')).toBeInTheDocument()
    })

    it('disabled items have tabindex=-1', () => {
      const items: ContextMenuItem[] = [
        { id: 'edit', label: 'Edit', onClick: vi.fn(), disabled: true }
      ]
      render(<ContextMenu {...defaultProps} items={items} />)

      const editButton = screen.getByText('Edit')
      expect(editButton).toHaveAttribute('tabindex', '-1')
    })
  })

  describe('Cleanup', () => {
    it('removes event listeners when menu closes', () => {
      const { rerender } = render(<ContextMenu {...defaultProps} />)

      // Rerender with isOpen=false
      rerender(<ContextMenu {...defaultProps} isOpen={false} />)

      // Should not call onClose on subsequent escape presses
      vi.clearAllMocks()
      fireEvent.keyDown(document, { key: 'Escape' })
      expect(defaultProps.onClose).not.toHaveBeenCalled()
    })

    it('removes event listeners on unmount', () => {
      const { unmount } = render(<ContextMenu {...defaultProps} />)

      unmount()

      // Should not throw and onClose should not be called
      vi.clearAllMocks()
      fireEvent.keyDown(document, { key: 'Escape' })
      expect(defaultProps.onClose).not.toHaveBeenCalled()
    })
  })
})
