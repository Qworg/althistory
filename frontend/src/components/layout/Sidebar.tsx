import React, { useId } from 'react'
import { NavLink } from 'react-router'
import { UserProfileMenu } from './UserProfileMenu'
import { TimelineViewIcon, CausalGraphViewIcon, ActorViewIcon } from './viewIcons'
import { useGlobalStore } from '@/stores/globalStore'

interface SidebarItem {
  path: string
  label: string
  icon: React.ReactNode
  description?: string
}

const sidebarItems: SidebarItem[] = [
  {
    path: '/timeline',
    label: 'Timeline',
    icon: <TimelineViewIcon />,
    description: 'View events chronologically'
  },
  {
    path: '/causal-graph',
    label: 'Causal Graph',
    icon: <CausalGraphViewIcon />,
    description: 'Explore cause-effect relationships'
  },
  {
    path: '/actor-perspective',
    label: 'Actor Perspective',
    icon: <ActorViewIcon />,
    description: 'Focus on specific actors'
  }
]

/** A panel with its left rail marked, and a chevron pointing the way it will move. */
function SidebarToggleIcon({ collapsed }: { collapsed: boolean }) {
  return (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75} aria-hidden="true">
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 4v16" />
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d={collapsed ? 'M13.5 10l2 2-2 2' : 'M15.5 10l-2 2 2 2'}
      />
    </svg>
  )
}

/**
 * The view navigation in sidebar layout. It collapses to a 56px icon rail; the
 * choice is a persisted user preference (`setSidebarCollapsed`). Collapsed,
 * every link keeps its view name as its accessible name and tooltip.
 */
export function Sidebar() {
  const collapsed = useGlobalStore((state) => state.uiState.sidebarCollapsed)
  const setSidebarCollapsed = useGlobalStore((state) => state.setSidebarCollapsed)
  const sidebarId = useId()

  const toggleLabel = collapsed ? 'Expand sidebar' : 'Collapse sidebar'

  return (
    <aside
      id={sidebarId}
      className={`bg-card shadow-sm border-r border-line flex-shrink-0 transition-[width] duration-200 ease-out motion-reduce:transition-none ${
        collapsed ? 'w-14' : 'w-64'
      }`}
      aria-label="Sidebar navigation"
      data-collapsed={collapsed || undefined}
    >
      <div className="flex flex-col h-full">
        {/* The links name the views; the heading keeps the outline intact for
            screen readers without a second visible label. */}
        <h2 className="sr-only">Views</h2>

        {/* Navigation */}
        <nav className={`flex-1 space-y-2 ${collapsed ? 'px-2 py-4' : 'p-4'}`} role="navigation">
          {sidebarItems.map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              aria-label={collapsed ? item.label : undefined}
              title={collapsed ? item.label : undefined}
              className={({ isActive }) =>
                `flex items-center rounded-lg text-sm font-medium transition-colors duration-200 group focus:outline-none focus-visible:ring-2 focus-visible:ring-selected ${
                  collapsed ? 'justify-center p-2' : 'px-3 py-2.5'
                } ${
                  isActive
                    ? 'bg-blue-50 text-blue-800 border border-blue-200/80 dark:bg-blue-500/15 dark:text-blue-200 dark:border-blue-400/30'
                    : 'text-ink-secondary hover:text-ink hover:bg-subtle border border-transparent'
                }`
              }
            >
              <span className="text-current shrink-0" aria-hidden="true" data-testid={`sidebar-icon-${item.path.slice(1)}`}>
                {item.icon}
              </span>
              {!collapsed && (
                <div className="ml-3 flex-1 min-w-0">
                  <div className="text-sm font-medium">{item.label}</div>
                  {item.description && (
                    <div className="text-xs text-ink-muted mt-0.5">
                      {item.description}
                    </div>
                  )}
                </div>
              )}
            </NavLink>
          ))}
        </nav>

        {/* Collapse / expand */}
        <div className={collapsed ? 'px-2 pb-2' : 'px-4 pb-2'}>
          <button
            type="button"
            onClick={() => setSidebarCollapsed(!collapsed)}
            aria-expanded={!collapsed}
            aria-controls={sidebarId}
            aria-label={toggleLabel}
            title={toggleLabel}
            className={`w-full flex items-center rounded-lg text-sm text-ink-muted hover:text-ink hover:bg-subtle transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-selected ${
              collapsed ? 'justify-center p-2' : 'gap-3 px-3 py-2'
            }`}
          >
            <SidebarToggleIcon collapsed={collapsed} />
            {!collapsed && <span>Collapse</span>}
          </button>
        </div>

        {/* User menu and version: one compact row, so the rail goes to the views */}
        <div className={`border-t border-line ${collapsed ? 'p-2' : 'flex items-center gap-2 px-2 py-2'}`}>
          <div className={collapsed ? '' : 'flex-1 min-w-0'}>
            <UserProfileMenu variant="sidebar" compact={collapsed} />
          </div>
          {!collapsed && (
            <span className="shrink-0 pr-2 font-mono-code text-xs text-ink-muted" title="althistory v1.0">
              v1.0
            </span>
          )}
        </div>
      </div>
    </aside>
  )
}
