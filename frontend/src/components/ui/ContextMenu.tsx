import { Fragment, useEffect, useLayoutEffect, useRef, useCallback } from 'react'

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
  /**
   * What the menu acts on ("Babbage completes the full design…"), shown at
   * its top: at a cluster of overlapping marks the menu otherwise did not say
   * which one it was for.
   */
  title?: string
}

export function ContextMenu({ isOpen, position, items, onClose, title }: ContextMenuProps) {
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

  // Keep the menu inside the viewport. The menu has to be in the DOM to be
  // measured, so this runs after it mounts and before the browser paints;
  // measuring during render read a null ref on first open, so the clamp never
  // ran and a menu opened near the right edge spilled off it.
  useLayoutEffect(() => {
    const menu = menuRef.current
    if (!isOpen || !menu) return
    const rect = menu.getBoundingClientRect()
    const x = Math.max(8, Math.min(position.x, window.innerWidth - rect.width - 8))
    const y = Math.max(8, Math.min(position.y, window.innerHeight - rect.height - 8))
    menu.style.left = `${x}px`
    menu.style.top = `${y}px`
  }, [isOpen, position.x, position.y, items.length])

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

  return (
    <div
      ref={menuRef}
      role="menu"
      aria-label={title ? `Actions for ${title}` : 'Context menu'}
      className="fixed z-50 w-max min-w-[160px] max-w-[18rem] bg-card rounded-lg shadow-lg border border-line py-1 outline-none"
      style={{ left: position.x, top: position.y }}
      onKeyDown={handleKeyDown}
      tabIndex={-1}
    >
      {title && (
        <div aria-hidden="true" className="mb-1 truncate border-b border-line px-4 pb-1.5 pt-1 text-xs font-medium text-ink-muted" title={title}>
          {title}
        </div>
      )}
      {items.map((item, index) => (
        <Fragment key={item.id}>
          {/* A destructive item sits apart from the rest, so it is not one
              slip below "Branch from this event". */}
          {item.danger && index > 0 && !items[index - 1]?.danger && (
            <div role="separator" className="my-1 border-t border-line" />
          )}
          <button
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
                ? 'text-ink-muted opacity-60 cursor-not-allowed'
                : item.danger
                  ? 'text-danger hover:bg-danger/10 focus:bg-danger/10'
                  : 'text-ink hover:bg-subtle focus:bg-subtle'
              }
              focus:outline-none transition-colors
            `}
            tabIndex={item.disabled ? -1 : 0}
          >
            {item.label}
          </button>
        </Fragment>
      ))}
    </div>
  )
}
