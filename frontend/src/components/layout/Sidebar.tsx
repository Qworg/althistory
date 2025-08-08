import { NavLink } from 'react-router'

interface SidebarItem {
  path: string
  label: string
  icon: string
  description?: string
}

const sidebarItems: SidebarItem[] = [
  { 
    path: '/timeline', 
    label: 'Timeline', 
    icon: '📊',
    description: 'View events chronologically'
  },
  { 
    path: '/causal-graph', 
    label: 'Causal Graph', 
    icon: '🔗',
    description: 'Explore cause-effect relationships'
  },
  { 
    path: '/actor-perspective', 
    label: 'Actor Perspective', 
    icon: '👤',
    description: 'Focus on specific actors'
  }
]

interface SidebarProps {
  isCollapsed?: boolean
  onToggleCollapse?: () => void
}

export function Sidebar({ isCollapsed = false, onToggleCollapse }: SidebarProps) {
  return (
    <aside 
      className={`bg-white shadow-sm border-r transition-all duration-300 ${
        isCollapsed ? 'w-16' : 'w-64'
      }`}
      aria-label="Sidebar navigation"
    >
      <div className="flex flex-col h-full">
        <div className="flex items-center justify-between p-4 border-b">
          {!isCollapsed && (
            <h2 className="text-lg font-semibold text-gray-900">Views</h2>
          )}
          <button
            onClick={onToggleCollapse}
            className="p-1 rounded-md text-gray-400 hover:text-gray-600 hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
            aria-label={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            <svg
              className={`w-5 h-5 transition-transform duration-200 ${
                isCollapsed ? 'rotate-180' : ''
              }`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M11 19l-7-7 7-7m8 14l-7-7 7-7"
              />
            </svg>
          </button>
        </div>
        
        <nav className="flex-1 p-4 space-y-2" role="navigation">
          {sidebarItems.map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              className={({ isActive }) =>
                `flex items-center px-3 py-2 rounded-lg text-sm font-medium transition-colors duration-200 group ${
                  isActive
                    ? 'bg-blue-100 text-blue-700'
                    : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
                }`
              }
              title={isCollapsed ? item.label : undefined}
            >
              <span className="text-lg" aria-hidden="true">{item.icon}</span>
              {!isCollapsed && (
                <div className="ml-3 flex-1">
                  <div className="text-sm font-medium">{item.label}</div>
                  {item.description && (
                    <div className="text-xs text-gray-500 mt-0.5">
                      {item.description}
                    </div>
                  )}
                </div>
              )}
            </NavLink>
          ))}
        </nav>
        
        {!isCollapsed && (
          <div className="p-4 border-t">
            <div className="text-xs text-gray-500">
              Timeline Interface v1.0
            </div>
          </div>
        )}
      </div>
    </aside>
  )
}