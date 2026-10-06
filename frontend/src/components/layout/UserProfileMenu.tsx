import { useState, useRef, useEffect } from 'react'
import { useGlobalStore } from '@/stores/globalStore'
import { ApiKeyDashboard } from '@/components/api-keys/ApiKeyDashboard'
import { LayoutMode } from '@/types'

interface UserProfileMenuProps {
  variant?: 'header' | 'sidebar'
}

export function UserProfileMenu({ variant = 'header' }: UserProfileMenuProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [showApiKeys, setShowApiKeys] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const { userPreferences, setUserPreferences } = useGlobalStore()

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

  const isSidebarVariant = variant === 'sidebar'

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
          ${isSidebarVariant
            ? 'w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left text-gray-700 hover:bg-gray-100 transition-colors'
            : 'p-2 rounded-md text-gray-400 hover:text-gray-500 hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500'
          }
        `}
        aria-expanded={isOpen}
        aria-haspopup="true"
        aria-label="User menu"
      >
        {/* User icon */}
        <svg className={isSidebarVariant ? 'h-8 w-8' : 'h-5 w-5'} fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
        </svg>
        {isSidebarVariant && (
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium truncate">User</div>
            <div className="text-xs text-gray-500">Settings</div>
          </div>
        )}
        {isSidebarVariant && (
          <svg
            className={`h-4 w-4 text-gray-400 transition-transform ${isOpen ? 'rotate-180' : ''}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
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
            ${isSidebarVariant ? 'w-full' : 'w-64'}
            bg-white rounded-lg shadow-lg border border-gray-200
            overflow-hidden
          `}
          role="menu"
          aria-orientation="vertical"
        >
          {/* User header */}
          <div className="px-4 py-3 border-b border-gray-100 bg-gray-50">
            <p className="text-sm font-medium text-gray-900">User</p>
            <p className="text-xs text-gray-500">Manage your preferences</p>
          </div>

          {/* Settings sections */}
          <div className="p-4 space-y-4">
            {/* Layout toggle */}
            <div>
              <label className="block text-xs font-medium text-gray-500 uppercase tracking-wider mb-2">
                Layout
              </label>
              <div className="flex gap-2">
                <button
                  onClick={() => handleLayoutChange('sidebar')}
                  className={`
                    flex-1 px-3 py-2 text-sm rounded-md border transition-colors
                    ${layoutMode === 'sidebar'
                      ? 'bg-blue-50 border-blue-500 text-blue-700'
                      : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50'
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
                      ? 'bg-blue-50 border-blue-500 text-blue-700'
                      : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50'
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
              <label className="block text-xs font-medium text-gray-500 uppercase tracking-wider mb-2">
                Theme
              </label>
              <div className="flex gap-2">
                <button
                  onClick={() => handleThemeChange('light')}
                  className={`
                    flex-1 px-2 py-1.5 text-xs rounded-md border transition-colors
                    ${theme === 'light'
                      ? 'bg-blue-50 border-blue-500 text-blue-700'
                      : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50'
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
                      ? 'bg-blue-50 border-blue-500 text-blue-700'
                      : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50'
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
                      ? 'bg-blue-50 border-blue-500 text-blue-700'
                      : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50'
                    }
                  `}
                  role="menuitem"
                >
                  System
                </button>
              </div>
            </div>
          </div>

          {/* Footer actions */}
          <div className="px-4 py-3 border-t border-gray-100 bg-gray-50 space-y-1">
            {/* Req 20: admin-only key management lives with the other account
                settings rather than in the graph-scoped view chrome. */}
            <button
              className="w-full text-left text-sm text-gray-600 hover:text-gray-900 transition-colors"
              role="menuitem"
              onClick={() => {
                setIsOpen(false)
                setShowApiKeys(true)
              }}
            >
              API Keys
            </button>
            <button
              className="w-full text-left text-sm text-gray-600 hover:text-gray-900 transition-colors"
              role="menuitem"
              onClick={() => setIsOpen(false)}
            >
              Sign out
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
