import { useState } from 'react'
import { Navigation } from './Navigation'
import { Breadcrumb } from './Breadcrumb'
import { ViewToolbar } from '@/components/views/ViewToolbar'
import { UserProfileMenu } from './UserProfileMenu'
import { GraphSelector, GraphManagerModal } from '@/components/graphs'
import { useGlobalStore } from '@/stores/globalStore'
import { LayoutMode } from '@/types'

interface HeaderProps {
  isMobile: boolean
  layoutMode: LayoutMode
}

export function Header({ isMobile, layoutMode }: HeaderProps) {
  const { viewMode } = useGlobalStore()
  const [isGraphManagerOpen, setIsGraphManagerOpen] = useState(false)

  // Show view switcher in header only in topbar mode on desktop
  const showViewSwitcher = !isMobile && layoutMode === 'topbar'

  // Show user profile in header when:
  // - On mobile (any layout mode, since there's no sidebar)
  // - On desktop in topbar mode (since sidebar has its own profile menu)
  const showUserProfile = isMobile || layoutMode === 'topbar'

  return (
    <header className="bg-white shadow-sm border-b sticky top-0 z-40" role="banner">
      <div className="max-w-full mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center h-16">
          {/* Left section: Title and breadcrumb */}
          <div className="flex items-center space-x-4">
            <div className="flex items-center">
              <h1 className="text-xl font-semibold text-gray-900">
                Timeline Interface
              </h1>
            </div>

            {!isMobile && (
              <div className="hidden md:block">
                <Breadcrumb />
              </div>
            )}
          </div>

          {/* Right section: graph switcher, navigation and user menu */}
          <div className="flex items-center space-x-4">
            {/* Req 17.1: the active graph is always switchable from the header. */}
            <GraphSelector onOpenManager={() => setIsGraphManagerOpen(true)} />

            {showViewSwitcher && <Navigation />}

            {showUserProfile && <UserProfileMenu variant="header" />}
          </div>
        </div>

        {/* Mobile breadcrumb */}
        {isMobile && (
          <div className="pb-3">
            <Breadcrumb />
          </div>
        )}

        {/* View-specific toolbar */}
        <div className="border-t border-gray-200 py-2">
          <ViewToolbar viewMode={viewMode} className="justify-center" />
        </div>
      </div>

      {/* Req 17.2-17.5: full graph management, opened from the selector. */}
      <GraphManagerModal
        isOpen={isGraphManagerOpen}
        onClose={() => setIsGraphManagerOpen(false)}
      />
    </header>
  )
}
