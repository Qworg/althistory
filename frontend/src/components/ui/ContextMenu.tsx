import { useEffect, useRef, useCallback } from 'react'

export interface ContextMenuItem {
  id: string
  label: string
  onClick: () => void
  disabled?: boolean
  danger?: boolean
}

export interface ContextMenuProps {
  isOpen: boolean
  position: { x: number; y: number }
  items: ContextMenuItem[]
  onClose: () => void
}

export function ContextMenu({ isOpen, position, items, onClose }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null)
  const focusedIndex = useRef<number>(-1)

  // Handle click outside
  useEffect(() => {
    if (!isOpen) return

    const handleClickOutside = (e: MouseEvent | TouchEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose()
      }
    }

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
      }
    }

    // Use capture to catch events before they bubble
    document.addEventListener('mousedown', handleClickOutside, true)
    document.addEventListener('touchstart', handleClickOutside, true)
    document.addEventListener('keydown', handleEscape)

    return () => {
      document.removeEventListener('mousedown', handleClickOutside, true)
      document.removeEventListener('touchstart', handleClickOutside, true)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [isOpen, onClose])

  // Adjust position to stay within viewport
  const getAdjustedPosition = useCallback(() => {
    if (!menuRef.current) return position

    const menuRect = menuRef.current.getBoundingClientRect()
    const viewportWidth = window.innerWidth
    const viewportHeight = window.innerHeight

    let { x, y } = position

    // Adjust if menu would go off right edge
    if (x + menuRect.width > viewportWidth) {
      x = viewportWidth - menuRect.width - 8
    }

    // Adjust if menu would go off bottom edge
    if (y + menuRect.height > viewportHeight) {
      y = viewportHeight - menuRect.height - 8
    }

    // Ensure menu doesn't go off left or top
    x = Math.max(8, x)
    y = Math.max(8, y)

    return { x, y }
  }, [position])

  // Handle keyboard navigation
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    const enabledItems = items.filter(item => !item.disabled)

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        focusedIndex.current = Math.min(focusedIndex.current + 1, enabledItems.length - 1)
        break
      case 'ArrowUp':
        e.preventDefault()
        focusedIndex.current = Math.max(focusedIndex.current - 1, 0)
        break
      case 'Enter':
        e.preventDefault()
        if (focusedIndex.current >= 0 && focusedIndex.current < enabledItems.length) {
          const item = enabledItems[focusedIndex.current]
          if (item) {
            item.onClick()
            onClose()
          }
        }
        break
      case 'Tab':
        e.preventDefault()
        onClose()
        break
    }

    // Update focus
    const buttons = menuRef.current?.querySelectorAll('button:not([disabled])')
    if (buttons && buttons[focusedIndex.current]) {
      (buttons[focusedIndex.current] as HTMLButtonElement).focus()
    }
  }, [items, onClose])

  if (!isOpen) return null

  const adjustedPosition = getAdjustedPosition()

  return (
    <div
      ref={menuRef}
      role="menu"
      aria-label="Context menu"
      className="fixed z-50 min-w-[160px] bg-white rounded-lg shadow-lg border border-gray-200 py-1 outline-none"
      style={{
        left: adjustedPosition.x,
        top: adjustedPosition.y,
      }}
      onKeyDown={handleKeyDown}
      tabIndex={-1}
    >
      {items.map((item) => (
        <button
          key={item.id}
          role="menuitem"
          disabled={item.disabled}
          onClick={() => {
            if (!item.disabled) {
              item.onClick()
              onClose()
            }
          }}
          className={`
            w-full px-4 py-2 text-left text-sm
            ${item.disabled
              ? 'text-gray-400 cursor-not-allowed'
              : item.danger
                ? 'text-red-600 hover:bg-red-50 focus:bg-red-50'
                : 'text-gray-700 hover:bg-gray-100 focus:bg-gray-100'
            }
            focus:outline-none transition-colors
          `}
          tabIndex={item.disabled ? -1 : 0}
        >
          {item.label}
        </button>
      ))}
    </div>
  )
}
