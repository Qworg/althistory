import { useState } from 'react'
import { Navigation } from './Navigation'
import { Breadcrumb } from './Breadcrumb'
import { ViewToolbar } from '@/components/views/ViewToolbar'
import { UserProfileMenu } from './UserProfileMenu'
import { GraphSelector, GraphManagerModal } from '@/components/graphs'
import { HelpButton } from '@/components/help/HelpButton'
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
    <header className="bg-card shadow-sm border-b border-line sticky top-0 z-40" role="banner">
      <div className="max-w-full mx-auto px-4 sm:px-6 lg:px-8">
        <div className={`flex justify-between items-center gap-2 lg:gap-4 ${isMobile ? 'h-14' : 'h-16'}`}>
          {/* Left section: Title and breadcrumb */}
          <div className="flex items-center gap-4 shrink-0">
            <div className="flex items-center gap-2.5">
              <span
                className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-[#0f172a] text-amber-400 shadow-xs ring-1 ring-inset ring-white/10"
                aria-hidden="true"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6l4 2m6-2a10 10 0 11-20 0 10 10 0 0120 0z" />
                </svg>
              </span>
              {/* A phone has room for the mark or the graph selector, not both
                  and the wordmark: the wordmark yields, the heading stays. */}
              <h1
                className={`font-display text-[1.375rem] leading-none font-semibold tracking-tight text-ink ${
                  isMobile ? 'sr-only' : ''
                }`}
              >
                althistory
              </h1>
            </div>

            {!isMobile && (
              <div className="hidden md:block">
                <Breadcrumb />
              </div>
            )}
          </div>

          {/* Right section: graph switcher, navigation, help and user menu.
              The selector is the part that gives way, so help and the user
              menu stay on screen at any width. */}
          <div className={`flex items-center min-w-0 ${isMobile ? 'flex-1 justify-end gap-1' : 'gap-4'}`}>
            {/* Req 17.1: the active graph is always switchable from the header. */}
            <GraphSelector
              onOpenManager={() => setIsGraphManagerOpen(true)}
              className={isMobile ? 'min-w-0 flex-1 [&>button]:w-full [&>button]:min-h-11' : ''}
            />

            {showViewSwitcher && <Navigation />}

            <HelpButton touch={isMobile} />

            {showUserProfile && <UserProfileMenu variant="header" touch={isMobile} />}
          </div>
        </div>

        {/* View-specific toolbar. On a phone it keeps the view's primary
            actions; the rest is in the bottom bar's More sheet. (The bottom
            bar also says which view is open, so there is no breadcrumb.) */}
        <div className={`border-t border-line ${isMobile ? 'py-1' : 'py-2'}`}>
          <ViewToolbar viewMode={viewMode} compact={isMobile} className="justify-center" />
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
