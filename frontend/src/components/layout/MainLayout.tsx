import { ReactNode, useState, useEffect } from 'react'
import { Header } from './Header'
import { Sidebar } from './Sidebar'
import { useViewStateManager } from '@/hooks/useViewStateManager'

interface MainLayoutProps {
  children: ReactNode
}

export function MainLayout({ children }: MainLayoutProps) {
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false)
  const [isMobile, setIsMobile] = useState(false)

  // Initialize view state management
  useViewStateManager()

  // Handle responsive behavior
  useEffect(() => {
    const checkMobile = () => {
      const mobile = window.innerWidth < 1024 // lg breakpoint
      setIsMobile(mobile)
      if (mobile) {
        setIsSidebarCollapsed(true)
      }
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

  const handleSidebarToggle = () => {
    setIsSidebarCollapsed(!isSidebarCollapsed)
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <Header 
        onSidebarToggle={handleSidebarToggle}
        showSidebarToggle={!isMobile}
      />
      
      <div className="flex flex-1 overflow-hidden">
        {!isMobile && (
          <Sidebar 
            isCollapsed={isSidebarCollapsed}
            onToggleCollapse={handleSidebarToggle}
          />
        )}
        
        <main 
          className="flex-1 overflow-auto focus:outline-none"
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
    </div>
  )
}