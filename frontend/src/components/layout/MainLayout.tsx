import { ReactNode, useState, useEffect } from 'react'
import { Header } from './Header'
import { Sidebar } from './Sidebar'
import { MobileBottomBar } from './MobileBottomBar'
import { useViewStateManager } from '@/hooks/useViewStateManager'
import { useViewShortcuts } from '@/hooks/useViewShortcuts'
import { useGlobalStore } from '@/stores/globalStore'

interface MainLayoutProps {
  children: ReactNode
}

export function MainLayout({ children }: MainLayoutProps) {
  const [isMobile, setIsMobile] = useState(false)
  const { userPreferences } = useGlobalStore()
  const { layoutMode } = userPreferences

  // Initialize view state management
  useViewStateManager()

  // Register global keyboard shortcuts for view switching (Alt+1/2/3)
  useViewShortcuts()

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

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <Header isMobile={isMobile} layoutMode={layoutMode} />

      <div className="flex flex-1 overflow-hidden">
        {showSidebar && <Sidebar />}

        <main
          className={`flex-1 overflow-auto focus:outline-none ${isMobile ? 'pb-14' : ''}`}
          role="main"
          tabIndex={-1}
        >
          <div className="h-full">
            <div className="max-w-full mx-auto px-4 sm:px-6 lg:px-8 py-6 h-full">
              {children}
            </div>
          </div>
        </main>
      </div>

      {isMobile && <MobileBottomBar />}
    </div>
  )
}
