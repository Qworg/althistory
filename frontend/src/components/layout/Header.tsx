import { useLayoutEffect, useRef, useState } from 'react'
import { Navigation } from './Navigation'
import { Breadcrumb } from './Breadcrumb'
import { ViewToolbar } from '@/components/views/ViewToolbar'
import { UserProfileMenu } from './UserProfileMenu'
import { GraphSelector, GraphManagerModal } from '@/components/graphs'
import { CalendarSwitcher } from './CalendarSwitcher'
import { HelpButton } from '@/components/help/HelpButton'
import { useGlobalStore } from '@/stores/globalStore'
import { useApiAccess } from '@/hooks/useGraphs'
import { LayoutMode } from '@/types'

interface HeaderProps {
  isMobile: boolean
  layoutMode: LayoutMode
}

export function Header({ isMobile, layoutMode }: HeaderProps) {
  const { viewMode } = useGlobalStore()
  // The header's height, published for the sticky sidebar beneath it (the
  // toolbar row wraps, so the height is measured, not assumed).
  const headerRef = useRef<HTMLElement>(null)
  useLayoutEffect(() => {
    const header = headerRef.current
    if (!header) return
    const publish = () =>
      document.documentElement.style.setProperty('--app-header-h', `${header.offsetHeight}px`)
    publish()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(publish)
    observer.observe(header)
    return () => observer.disconnect()
  }, [])
  const sidebarCollapsed = useGlobalStore((state) => state.uiState.sidebarCollapsed)
  const [isGraphManagerOpen, setIsGraphManagerOpen] = useState(false)
  const accessProblem = useApiAccess()

  // Show view switcher in header only in topbar mode on desktop
  const showViewSwitcher = !isMobile && layoutMode === 'topbar'

  // Show user profile in header when:
  // - On mobile (any layout mode, since there's no sidebar)
  // - On desktop in topbar mode (since sidebar has its own profile menu)
  const showUserProfile = isMobile || layoutMode === 'topbar'

  return (
    <header ref={headerRef} className="bg-card shadow-sm border-b border-line sticky top-0 z-40" role="banner">
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

            {/* The view's name, only where nothing else on screen says it: a
                labelled sidebar or the top navigation already marks the open
                view, and repeating it beside the wordmark was noise. */}
            {!isMobile && !showViewSwitcher && sidebarCollapsed && (
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
              sheet={isMobile}
              className={isMobile ? 'min-w-0 flex-1 [&>button]:w-full [&>button]:min-h-11' : ''}
            />

            {/* A world with several calendars: which its dates are shown in. */}
            {!isMobile && <CalendarSwitcher />}

            {showViewSwitcher && <Navigation />}

            <HelpButton touch={isMobile} />

            {showUserProfile && <UserProfileMenu variant="header" touch={isMobile} />}
          </div>
        </div>

        {/* View-specific toolbar. On a phone it keeps the view's primary
            actions; the rest is in the bottom bar's More sheet. (The bottom
            bar also says which view is open, so there is no breadcrumb.) */}
        {/* Without access every toolbar action would fail; the view explains why. */}
        {!accessProblem && (
          <div className={`border-t border-line ${isMobile ? 'py-1' : 'py-2'}`}>
            {/* Left-aligned: centred, the row re-centred (and every button moved)
            whenever a conditional action such as Clear Selection appeared. */}
            <ViewToolbar viewMode={viewMode} compact={isMobile} className={isMobile ? 'justify-center' : 'justify-start'} />
          </div>
        )}
      </div>

      {/* Req 17.2-17.5: full graph management, opened from the selector. */}
      <GraphManagerModal
        isOpen={isGraphManagerOpen}
        onClose={() => setIsGraphManagerOpen(false)}
      />
    </header>
  )
}
