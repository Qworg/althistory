import { NavLink } from 'react-router'
import { UserProfileMenu } from './UserProfileMenu'

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

export function Sidebar() {
  return (
    <aside
      className="bg-white shadow-sm border-r w-64 flex-shrink-0"
      aria-label="Sidebar navigation"
    >
      <div className="flex flex-col h-full">
        {/* Header */}
        <div className="p-4 border-b">
          <h2 className="text-lg font-semibold text-gray-900">Views</h2>
        </div>

        {/* Navigation */}
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
            >
              <span className="text-lg" aria-hidden="true">{item.icon}</span>
              <div className="ml-3 flex-1">
                <div className="text-sm font-medium">{item.label}</div>
                {item.description && (
                  <div className="text-xs text-gray-500 mt-0.5">
                    {item.description}
                  </div>
                )}
              </div>
            </NavLink>
          ))}
        </nav>

        {/* User profile section */}
        <div className="border-t p-4">
          <UserProfileMenu variant="sidebar" />
        </div>

        {/* Version footer */}
        <div className="p-4 border-t">
          <div className="text-xs text-gray-500">
            Timeline Interface v1.0
          </div>
        </div>
      </div>
    </aside>
  )
}
