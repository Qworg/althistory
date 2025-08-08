import { useState } from 'react'
import { Navigation } from './Navigation'
import { Breadcrumb } from './Breadcrumb'
import { ViewToolbar } from '@/components/views/ViewToolbar'
import { useGlobalStore } from '@/stores/globalStore'

interface HeaderProps {
  onSidebarToggle?: () => void
  showSidebarToggle?: boolean
}

export function Header({ onSidebarToggle, showSidebarToggle = true }: HeaderProps) {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false)
  const { viewMode } = useGlobalStore()

  const handleMobileMenuToggle = () => {
    setIsMobileMenuOpen(!isMobileMenuOpen)
  }

  return (
    <header className="bg-white shadow-sm border-b sticky top-0 z-40" role="banner">
      <div className="max-w-full mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center h-16">
          <div className="flex items-center space-x-4">
            {showSidebarToggle && (
              <button
                onClick={onSidebarToggle}
                className="hidden lg:inline-flex items-center justify-center p-2 rounded-md text-gray-400 hover:text-gray-500 hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-blue-500"
                aria-label="Toggle sidebar"
              >
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                </svg>
              </button>
            )}
            
            <div className="flex items-center">
              <h1 className="text-xl font-semibold text-gray-900">
                Timeline Interface
              </h1>
            </div>
            
            <div className="hidden md:block">
              <Breadcrumb />
            </div>
          </div>

          <div className="flex items-center space-x-4">
            <Navigation />
            <Navigation 
              isMobile 
              onMobileMenuToggle={handleMobileMenuToggle}
              isMobileMenuOpen={isMobileMenuOpen}
            />
            
            {/* User menu placeholder */}
            <div className="hidden md:flex items-center space-x-4">
              <button
                className="p-2 rounded-md text-gray-400 hover:text-gray-500 hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                aria-label="User menu"
              >
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                </svg>
              </button>
            </div>
          </div>
        </div>
        
        {/* Mobile breadcrumb */}
        <div className="md:hidden pb-3">
          <Breadcrumb />
        </div>

        {/* View-specific toolbar */}
        <div className="border-t border-gray-200 py-2">
          <ViewToolbar viewMode={viewMode} className="justify-center" />
        </div>
      </div>
    </header>
  )
}