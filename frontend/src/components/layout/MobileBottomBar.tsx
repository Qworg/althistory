import { NavLink } from 'react-router'
import { ActorViewIcon, CausalGraphViewIcon, TimelineViewIcon } from './viewIcons'
import { useMoreSheetStore } from './moreSheetStore'

interface NavItem {
  path: string
  label: string
  icon: React.ReactNode
}

const navItems: NavItem[] = [
  { path: '/timeline', label: 'Timeline', icon: <TimelineViewIcon className="h-6 w-6" /> },
  { path: '/causal-graph', label: 'Causal', icon: <CausalGraphViewIcon className="h-6 w-6" /> },
  { path: '/actor-perspective', label: 'Actors', icon: <ActorViewIcon className="h-6 w-6" /> },
]

const itemClass =
  'flex flex-col items-center justify-center flex-1 h-full px-2 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-selected'

/**
 * The phone navigation: the three views, then "More", which opens the sheet of
 * graph tools the phone toolbar has no room for (drawn by the ViewToolbar).
 *
 * It sits at z-30, under the sticky header (z-40): the dialogs the toolbar
 * opens live in the header's stacking context, and a bar above it would cover
 * their bottom edge, where a full-screen sheet keeps its footer buttons.
 */
export function MobileBottomBar() {
  const moreOpen = useMoreSheetStore((state) => state.isOpen)
  const setMoreOpen = useMoreSheetStore((state) => state.setOpen)

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 bg-card border-t border-line z-30"
      style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
      role="navigation"
      aria-label="Mobile navigation"
    >
      <div className="flex justify-around items-center h-14">
        {navItems.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            className={({ isActive }) =>
              `${itemClass} ${
                isActive
                  ? 'text-blue-700 dark:text-blue-300 border-t-2 border-baseline dark:border-blue-400 -mt-[2px]'
                  : 'text-ink-muted hover:text-ink'
              }`
            }
          >
            {item.icon}
            <span className="text-xs mt-1">{item.label}</span>
          </NavLink>
        ))}
        <button
          type="button"
          onClick={() => setMoreOpen(!moreOpen)}
          aria-haspopup="dialog"
          aria-expanded={moreOpen}
          className={`${itemClass} ${moreOpen ? 'text-ink' : 'text-ink-muted hover:text-ink'}`}
        >
          <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75} aria-hidden="true">
            <circle cx="5" cy="12" r="1.5" />
            <circle cx="12" cy="12" r="1.5" />
            <circle cx="19" cy="12" r="1.5" />
          </svg>
          <span className="text-xs mt-1">More</span>
        </button>
      </div>
    </nav>
  )
}
