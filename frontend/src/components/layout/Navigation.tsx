import { ViewSwitcher } from '@/components/views/ViewSwitcher'

export function Navigation() {
  return (
    <nav className="flex" role="navigation" aria-label="Main navigation">
      <ViewSwitcher
        orientation="horizontal"
        showLabels={true}
        className="space-x-2"
      />
    </nav>
  )
}
