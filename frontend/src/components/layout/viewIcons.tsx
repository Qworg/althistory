/**
 * Icons for the three views, in the app's outline set (24×24, stroke
 * currentColor, round caps). They match the Sidebar's icons so every view
 * switcher draws the same glyph for the same view.
 */

interface ViewIconProps {
  className?: string
}

export function TimelineViewIcon({ className = 'w-5 h-5' }: ViewIconProps) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75} aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 6h18M3 12h12m-12 6h18M7 6v12m8-12v6" />
    </svg>
  )
}

export function CausalGraphViewIcon({ className = 'w-5 h-5' }: ViewIconProps) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75} aria-hidden="true">
      <circle cx="6" cy="6" r="2.5" />
      <circle cx="18" cy="6" r="2.5" />
      <circle cx="12" cy="18" r="2.5" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M8.5 6h7M7.5 8l3.5 7.5M16.5 8L13 15.5" />
    </svg>
  )
}

export function ActorViewIcon({ className = 'w-5 h-5' }: ViewIconProps) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75} aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
    </svg>
  )
}
