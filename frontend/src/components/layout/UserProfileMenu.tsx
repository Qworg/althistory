import { useState, useRef, useEffect } from 'react'
import { useGlobalStore } from '@/stores/globalStore'
import { ApiKeyDashboard } from '@/components/api-keys/ApiKeyDashboard'
import { useHelpStore } from '@/components/help/helpStore'
import { LayoutMode } from '@/types'

interface UserProfileMenuProps {
  variant?: 'header' | 'sidebar'
  /** Sidebar variant only: icon-only trigger for the collapsed icon rail. */
  compact?: boolean
  /** Header variant only: a 44px trigger for the phone layout. */
  touch?: boolean
}

export function UserProfileMenu({ variant = 'header', compact = false, touch = false }: UserProfileMenuProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [showApiKeys, setShowApiKeys] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const { userPreferences, setUserPreferences } = useGlobalStore()
  const openHelp = useHelpStore((state) => state.openHelp)

  const { layoutMode, theme } = userPreferences

  // Close menu on outside click
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [isOpen])

  // Close menu on Escape key
  useEffect(() => {
    function handleEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setIsOpen(false)
      }
    }

    if (isOpen) {
      document.addEventListener('keydown', handleEscape)
      return () => document.removeEventListener('keydown', handleEscape)
    }
  }, [isOpen])

  const handleLayoutChange = (newLayout: LayoutMode) => {
    setUserPreferences({ layoutMode: newLayout })
  }

  const handleThemeChange = (newTheme: 'light' | 'dark' | 'system') => {
    setUserPreferences({ theme: newTheme })
  }

  const highContrast = Boolean(userPreferences.accessibility?.highContrast)

  const handleToggleHighContrast = () => {
    setUserPreferences({
      accessibility: {
        highContrast: !highContrast,
        reducedMotion: Boolean(userPreferences.accessibility?.reducedMotion),
        screenReaderOptimized: Boolean(userPreferences.accessibility?.screenReaderOptimized),
      },
    })
  }

  const isSidebarVariant = variant === 'sidebar'
  // The collapsed rail is too narrow for the label, so only the icon shows.
  const isRail = isSidebarVariant && compact

  // Dropdown position classes based on variant
  const dropdownPositionClasses = isSidebarVariant
    ? 'bottom-full left-0 mb-2' // Opens upward for sidebar
    : 'top-full right-0 mt-2' // Opens downward for header

  return (
    <div ref={menuRef} className={`relative ${isSidebarVariant ? 'w-full' : ''}`}>
      {/* Trigger button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`
          ${isRail
            ? 'w-full flex items-center justify-center p-2 rounded-lg text-ink-secondary hover:text-ink hover:bg-subtle transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-selected'
            : isSidebarVariant
            ? 'w-full flex items-center gap-2.5 px-2 py-1.5 rounded-lg text-left text-ink-secondary hover:text-ink hover:bg-subtle transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-selected'
            : `${touch ? 'inline-flex h-11 w-11 items-center justify-center' : 'p-2'} rounded-md text-ink-muted hover:text-ink hover:bg-subtle focus:outline-none focus:ring-2 focus:ring-selected`
          }
        `}
        aria-expanded={isOpen}
        aria-haspopup="true"
        aria-label="Settings"
        title={isRail ? 'Settings' : undefined}
      >
        {/* Sliders: this menu holds preferences, and there is no account to
            show (it was labelled "User" over a person icon, with no user). */}
        <svg className="h-5 w-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h9m4 0h3M4 12h3m4 0h9M4 18h11m4 0h1" />
          <circle cx="15" cy="6" r="2" />
          <circle cx="9" cy="12" r="2" />
          <circle cx="17" cy="18" r="2" />
        </svg>
        {isSidebarVariant && !isRail && (
          <span className="flex-1 min-w-0 truncate text-sm font-medium">Settings</span>
        )}
        {isSidebarVariant && !isRail && (
          <svg
            className={`h-4 w-4 text-ink-muted transition-transform ${isOpen ? 'rotate-180' : ''}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            aria-hidden="true"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
          </svg>
        )}
      </button>

      {/* Dropdown menu */}
      {isOpen && (
        <div
          className={`
            absolute ${dropdownPositionClasses} z-50
            ${isSidebarVariant && !isRail ? 'w-full' : 'w-64'}
            bg-card rounded-lg shadow-lg border border-line
            overflow-hidden
          `}
          role="menu"
          aria-orientation="vertical"
        >
          {/* User header */}
          <div className="px-4 py-3 border-b border-line bg-subtle">
            <p className="text-sm font-medium text-ink">Settings</p>
            <p className="text-xs text-ink-muted">Theme, layout and contrast, saved in this browser</p>
          </div>

          {/* Settings sections */}
          <div className="p-4 space-y-4">
            {/* Layout toggle */}
            <div>
              <label className="block text-xs font-medium text-ink-muted uppercase tracking-wider mb-2">
                Layout
              </label>
              <div className="flex gap-2">
                <button
                  onClick={() => handleLayoutChange('sidebar')}
                  className={`
                    flex-1 px-3 py-2 text-sm rounded-md border transition-colors
                    ${layoutMode === 'sidebar'
                      ? 'bg-blue-50 border-blue-500 text-blue-700 dark:bg-blue-500/15 dark:border-blue-400 dark:text-blue-200'
                      : 'bg-card border-line text-ink-secondary hover:bg-subtle'
                    }
                  `}
                  role="menuitem"
                >
                  Sidebar
                </button>
                <button
                  onClick={() => handleLayoutChange('topbar')}
                  className={`
                    flex-1 px-3 py-2 text-sm rounded-md border transition-colors
                    ${layoutMode === 'topbar'
                      ? 'bg-blue-50 border-blue-500 text-blue-700 dark:bg-blue-500/15 dark:border-blue-400 dark:text-blue-200'
                      : 'bg-card border-line text-ink-secondary hover:bg-subtle'
                    }
                  `}
                  role="menuitem"
                >
                  Top Bar
                </button>
              </div>
            </div>

            {/* Theme toggle */}
            <div>
              <label className="block text-xs font-medium text-ink-muted uppercase tracking-wider mb-2">
                Theme
              </label>
              <div className="flex gap-2">
                <button
                  onClick={() => handleThemeChange('light')}
                  className={`
                    flex-1 px-2 py-1.5 text-xs rounded-md border transition-colors
                    ${theme === 'light'
                      ? 'bg-blue-50 border-blue-500 text-blue-700 dark:bg-blue-500/15 dark:border-blue-400 dark:text-blue-200'
                      : 'bg-card border-line text-ink-secondary hover:bg-subtle'
                    }
                  `}
                  role="menuitem"
                >
                  Light
                </button>
                <button
                  onClick={() => handleThemeChange('dark')}
                  className={`
                    flex-1 px-2 py-1.5 text-xs rounded-md border transition-colors
                    ${theme === 'dark'
                      ? 'bg-blue-50 border-blue-500 text-blue-700 dark:bg-blue-500/15 dark:border-blue-400 dark:text-blue-200'
                      : 'bg-card border-line text-ink-secondary hover:bg-subtle'
                    }
                  `}
                  role="menuitem"
                >
                  Dark
                </button>
                <button
                  onClick={() => handleThemeChange('system')}
                  className={`
                    flex-1 px-2 py-1.5 text-xs rounded-md border transition-colors
                    ${theme === 'system'
                      ? 'bg-blue-50 border-blue-500 text-blue-700 dark:bg-blue-500/15 dark:border-blue-400 dark:text-blue-200'
                      : 'bg-card border-line text-ink-secondary hover:bg-subtle'
                    }
                  `}
                  role="menuitem"
                >
                  System
                </button>
              </div>
            </div>

            {/* Accessibility toggle */}
            <div>
              <label className="block text-xs font-medium text-ink-muted uppercase tracking-wider mb-2">
                Accessibility
              </label>
              <button
                type="button"
                onClick={handleToggleHighContrast}
                aria-pressed={highContrast}
                className={`
                  w-full flex items-center justify-between px-3 py-2 text-xs rounded-md border transition-colors
                  ${highContrast
                    ? 'bg-indigo-50 border-indigo-600 text-indigo-900 font-semibold dark:bg-indigo-500/20 dark:border-indigo-300 dark:text-indigo-100'
                    : 'bg-card border-line text-ink-secondary hover:bg-subtle'
                  }
                `}
                role="menuitem"
              >
                <span>High Contrast Mode</span>
                <span className="text-xs uppercase tracking-wide">
                  {highContrast ? 'On' : 'Off'}
                </span>
              </button>
            </div>
          </div>

          {/* Footer actions */}
          <div className="px-4 py-3 border-t border-line bg-subtle space-y-1">
            {/* Req 20: admin-only key management lives with the other account
                settings rather than in the graph-scoped view chrome. */}
            <button
              className="w-full text-left text-sm text-ink-secondary hover:text-ink transition-colors"
              role="menuitem"
              onClick={() => {
                setIsOpen(false)
                setShowApiKeys(true)
              }}
            >
              API Keys
            </button>
            <button
              className="w-full flex items-center justify-between text-left text-sm text-ink-secondary hover:text-ink transition-colors"
              role="menuitem"
              onClick={() => {
                setIsOpen(false)
                openHelp()
              }}
            >
              <span>Help &amp; keyboard shortcuts</span>
              <kbd className="font-mono-code text-xs text-ink-muted" aria-hidden="true">?</kbd>
            </button>
          </div>
        </div>
      )}

      {showApiKeys && (
        <ApiKeyDashboard isOpen onClose={() => setShowApiKeys(false)} />
      )}
    </div>
  )
}
