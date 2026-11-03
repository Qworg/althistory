import { Link, useLocation } from 'react-router'

interface BreadcrumbItem {
  label: string
  path?: string
}

const routeLabels: Record<string, string> = {
  '/timeline': 'Timeline',
  '/causal-graph': 'Causal Graph',
  '/actor-perspective': 'Actor Perspective'
}

/**
 * The trail starts at the current view. There is no "Home" crumb: "/" renders
 * the timeline, so "Home > Timeline" was two links to the same place. At "/"
 * the trail is the timeline itself.
 */
export function Breadcrumb() {
  const location = useLocation()
  const pathSegments = location.pathname.split('/').filter(Boolean)

  const breadcrumbItems: BreadcrumbItem[] = []

  let currentPath = ''
  pathSegments.forEach((segment) => {
    currentPath += `/${segment}`
    const label = routeLabels[currentPath] || segment.charAt(0).toUpperCase() + segment.slice(1)
    breadcrumbItems.push({ label, path: currentPath })
  })

  if (breadcrumbItems.length === 0) {
    breadcrumbItems.push({ label: routeLabels['/timeline']!, path: '/' })
  }

  return (
    <nav className="flex" aria-label="Breadcrumb">
      <ol className="inline-flex items-center space-x-1 md:space-x-3">
        {breadcrumbItems.map((item, index) => (
          <li key={item.path || item.label} className="inline-flex items-center">
            {index > 0 && (
              <svg
                className="w-3 h-3 text-ink-muted mx-1"
                aria-hidden="true"
                fill="none"
                viewBox="0 0 6 10"
              >
                <path
                  stroke="currentColor"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  d="m1 9 4-4-4-4"
                />
              </svg>
            )}
            {index === breadcrumbItems.length - 1 ? (
              <span className="text-sm font-medium text-ink-secondary" aria-current="page">
                {item.label}
              </span>
            ) : (
              <Link
                to={item.path!}
                className="inline-flex items-center text-sm font-medium text-ink-secondary hover:text-ink transition-colors duration-200"
              >
                {item.label}
              </Link>
            )}
          </li>
        ))}
      </ol>
    </nav>
  )
}