import { ViewSwitcher } from '@/components/views/ViewSwitcher'

interface NavigationProps {
  isMobile?: boolean
  onMobileMenuToggle?: () => void
  isMobileMenuOpen?: boolean
}

export function Navigation({ isMobile = false, onMobileMenuToggle, isMobileMenuOpen = false }: NavigationProps) {
  if (isMobile) {
    return (
      <div className="md:hidden">
        <button
          onClick={onMobileMenuToggle}
          className="inline-flex items-center justify-center p-2 rounded-md text-gray-400 hover:text-gray-500 hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-blue-500"
          aria-expanded={isMobileMenuOpen}
          aria-label="Toggle navigation menu"
        >
          <span className="sr-only">Open main menu</span>
          {isMobileMenuOpen ? (
            <svg className="block h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          ) : (
            <svg className="block h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          )}
        </button>
        
        {isMobileMenuOpen && (
          <div className="absolute top-16 left-0 right-0 bg-white shadow-lg border-b z-50">
            <nav className="px-4 py-2" role="navigation" aria-label="Mobile navigation">
              <ViewSwitcher 
                orientation="vertical" 
                showLabels={true}
                className="w-full"
              />
            </nav>
          </div>
        )}
      </div>
    )
  }

  return (
    <nav className="hidden md:flex" role="navigation" aria-label="Main navigation">
      <ViewSwitcher 
        orientation="horizontal" 
        showLabels={true}
        className="space-x-2"
      />
    </nav>
  )
}