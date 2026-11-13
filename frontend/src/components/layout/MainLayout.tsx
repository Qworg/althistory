import { ReactNode, useState, useEffect, useCallback, type MouseEvent } from 'react'
import { Header } from './Header'
import { Sidebar } from './Sidebar'
import { MobileBottomBar } from './MobileBottomBar'
import { useViewStateManager } from '@/hooks/useViewStateManager'
import { useViewShortcuts } from '@/hooks/useViewShortcuts'
import { useGlobalStore } from '@/stores/globalStore'
import { ActiveFiltersBar, FilterPanelContainer } from '@/components/filters/FilterPanelContainer'
import { CopyCompletionNotifier } from '@/components/notifications/CopyCompletionNotifier'
import { LiveChangeNotices } from '@/components/notifications/LiveChangeNotices'
import { useLiveChanges } from '@/hooks/useLiveChanges'
import { HelpDialog } from '@/components/help/HelpDialog'
import { useHelpShortcut } from '@/components/help/useHelpShortcut'
import { useActiveGraphReconciler } from '@/hooks/useGraphs'
import { NoActiveGraph } from '@/components/graphs/NoActiveGraph'
import { ApiKeyRequired } from '@/components/graphs/ApiKeyRequired'
import { useWorldCalendarSync } from '@/hooks/useWorldCalendar'
import { WorldCalendarBoundary } from './WorldCalendarBoundary'

interface MainLayoutProps {
  children: ReactNode
}

/** The main view region: the skip link's target. */
export const MAIN_VIEW_ID = 'main-view'

export function MainLayout({ children }: MainLayoutProps) {
  const [isMobile, setIsMobile] = useState(false)
  const { userPreferences, uiState } = useGlobalStore()
  const { layoutMode } = userPreferences

  // Initialize view state management
  useViewStateManager()

  // Register global keyboard shortcuts for view switching (Shift+1/2/3, or Alt+1/2/3)
  useViewShortcuts()

  // `?` opens the help and reference dialog (mounted once, below)
  useHelpShortcut()

  // The header's active graph follows the server's, which scopes the data
  const { noActiveGraph, accessProblem } = useActiveGraphReconciler()

  // Dates are shown in the open graph's world calendar, when it has one
  useWorldCalendarSync()

  // Changes other writers make to the open graph (an agent working through MCP,
  // the command line, a generation job) appear as they are made
  useLiveChanges()

  // Sync high contrast accessibility preference to the root document element
  useEffect(() => {
    const highContrast = Boolean(userPreferences.accessibility?.highContrast)
    document.documentElement.classList.toggle('high-contrast', highContrast)
  }, [userPreferences.accessibility?.highContrast])

  // Sync theme preference ('light' | 'dark' | 'system') to the root document element
  // 'system' follows the OS live, so switching the OS appearance while the
  // app is open re-themes it without a reload.
  useEffect(() => {
    const theme = userPreferences.theme ?? 'system'
    const query =
      typeof window !== 'undefined' && typeof window.matchMedia === 'function'
        ? window.matchMedia('(prefers-color-scheme: dark)')
        : null
    const apply = () => {
      const isDark = theme === 'dark' || (theme === 'system' && Boolean(query?.matches))
      document.documentElement.classList.toggle('dark', isDark)
    }
    apply()
    if (theme !== 'system' || !query || typeof query.addEventListener !== 'function') return
    query.addEventListener('change', apply)
    return () => query.removeEventListener('change', apply)
  }, [userPreferences.theme])

  // Handle responsive behavior
  useEffect(() => {
    const checkMobile = () => {
      const mobile = window.innerWidth < 1024 // lg breakpoint
      setIsMobile(mobile)
    }

    checkMobile()
    window.addEventListener('resize', checkMobile)
    return () => window.removeEventListener('resize', checkMobile)
  }, [])

  // Handle touch gestures for mobile
  useEffect(() => {
    if (!isMobile) return

    let startX = 0
    let startY = 0
    let isScrolling = false

    const handleTouchStart = (e: TouchEvent) => {
      if (e.touches.length > 0) {
        startX = e.touches[0]!.clientX
        startY = e.touches[0]!.clientY
        isScrolling = false
      }
    }

    const handleTouchMove = (e: TouchEvent) => {
      if (!startX || !startY || e.touches.length === 0) return

      const currentX = e.touches[0]!.clientX
      const currentY = e.touches[0]!.clientY
      const diffX = startX - currentX
      const diffY = startY - currentY

      // Determine if user is scrolling vertically
      if (Math.abs(diffY) > Math.abs(diffX)) {
        isScrolling = true
      }

      // Prevent horizontal scrolling when not scrolling vertically
      if (!isScrolling && Math.abs(diffX) > 10) {
        e.preventDefault()
      }
    }

    const handleTouchEnd = () => {
      startX = 0
      startY = 0
      isScrolling = false
    }

    document.addEventListener('touchstart', handleTouchStart, { passive: true })
    document.addEventListener('touchmove', handleTouchMove, { passive: false })
    document.addEventListener('touchend', handleTouchEnd, { passive: true })

    return () => {
      document.removeEventListener('touchstart', handleTouchStart)
      document.removeEventListener('touchmove', handleTouchMove)
      document.removeEventListener('touchend', handleTouchEnd)
    }
  }, [isMobile])

  // Show sidebar only on desktop in sidebar mode
  const showSidebar = !isMobile && layoutMode === 'sidebar'

  // The skip link moves focus itself rather than following the fragment, so
  // the router's URL is left alone and focus lands even where the browser
  // would only scroll.
  const skipToView = useCallback((event: MouseEvent<HTMLAnchorElement>) => {
    const main = document.getElementById(MAIN_VIEW_ID)
    if (!main) return
    event.preventDefault()
    main.focus()
    main.scrollIntoView?.({ block: 'start' })
  }, [])

  return (
    <div className="min-h-screen bg-canvas text-ink flex flex-col">
      {/* First in the tab order: past the header, the toolbar and the
          sidebar to the view. Hidden until it has focus. */}
      <a
        href={`#${MAIN_VIEW_ID}`}
        onClick={skipToView}
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-3 focus:z-[60] focus:rounded-md focus:border focus:border-line focus:bg-card focus:px-4 focus:py-2.5 focus:text-sm focus:font-medium focus:text-ink focus:shadow-lg focus:outline-none focus:ring-2 focus:ring-selected"
      >
        Skip to view
      </a>

      <Header isMobile={isMobile} layoutMode={layoutMode} />

      {/* overflow-clip, not overflow-hidden: a hidden overflow makes this row
          a scroll container, and the sidebar would stick inside it instead
          of under the header. */}
      <div className="flex flex-1 overflow-clip">
        {showSidebar && <Sidebar />}

        <main
          id={MAIN_VIEW_ID}
          className={`flex-1 min-w-0 overflow-auto focus:outline-none ${isMobile ? 'pb-14' : ''}`}
          role="main"
          tabIndex={-1}
        >
          <div className="h-full">
            <div className={`max-w-full mx-auto px-4 sm:px-6 lg:px-8 h-full ${isMobile ? 'py-4' : 'py-6'}`}>
              {/* A refused key comes first: without access, "no graph" and the
                  unscoped reads underneath would both be wrong. */}
              {accessProblem ? (
                <ApiKeyRequired problem={accessProblem} />
              ) : noActiveGraph ? (
                <NoActiveGraph />
              ) : (
                // Remounted when the world calendar changes, so every date in
                // the views is shown in the new one (WorldCalendarBoundary).
                <WorldCalendarBoundary>
                  <ActiveFiltersBar className="mb-4" />
                  {children}
                </WorldCalendarBoundary>
              )}
            </div>
          </div>
        </main>

        {uiState.filterPanelOpen && <FilterPanelContainer />}
      </div>

      {isMobile && <MobileBottomBar />}

      {/* The copy completion notice lives here so it outlives the modal that
          started the copy. */}
      <CopyCompletionNotifier />
      <LiveChangeNotices />

      {/* Help & reference (shortcuts + glossary): opened from the header, the
          user menu or `?`. */}
      <HelpDialog />
    </div>
  )
}
