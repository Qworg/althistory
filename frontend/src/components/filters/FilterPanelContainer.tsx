import { useCallback, useMemo } from 'react'
import { FilterPanel } from './FilterPanel'
import type { FilterState as PanelFilterState } from './FilterPanel'
import { SearchInterface } from './SearchInterface'
import type { SearchSuggestion } from './SearchInterface'
import { ActiveFilters } from './ActiveFilters'
import {
  fromPanelFilters,
  filtersEqual,
  toPanelFilters
} from './filterUtils'
import { useEvents, VIEW_EVENT_LIMIT } from '@/hooks/useEvents'
import { useArcs } from '@/hooks/useArcs'
import { useGlobalStore } from '@/stores/globalStore'
import { useWorldCalendar } from '@/stores/worldCalendarStore'

function unique(values: string[]): string[] {
  return Array.from(new Set(values))
}

function suggestionId(type: SearchSuggestion['type'], value: string): string {
  return `${type}:${value}`
}

/**
 * The toolbar's `filterPanelOpen` toggle used to flip a store flag that nothing
 * rendered. This is the mount point: it reads the global filter state, fetches
 * the unfiltered collections for the option lists, and renders the panel plus
 * the debounced search box. All state flows to/from the store so the views can
 * read the same `activeFilters`.
 */
export function FilterPanelContainer() {
  const {
    activeFilters,
    setFilters,
    setFilterPanelOpen
  } = useGlobalStore()

  const { data: events = [] } = useEvents({ limit: VIEW_EVENT_LIMIT })
  const { data: arcs = [] } = useArcs()

  // Bounds are written in the world calendar shown, and rewritten when it changes.
  const calendar = useWorldCalendar()
  const panelFilters = useMemo(
    () => toPanelFilters(activeFilters, calendar),
    [activeFilters, calendar]
  )

  const handleFiltersChange = useCallback((next: PanelFilterState) => {
    const mapped = fromPanelFilters(next, calendar)
    if (!filtersEqual(mapped, activeFilters)) {
      setFilters(mapped)
    }
  }, [activeFilters, setFilters, calendar])

  const availableActors = useMemo(
    () => unique(events.flatMap(event => [event.actor, event.target])).sort(),
    [events]
  )

  const availableTargets = useMemo(
    () => unique(events.map(event => event.target)).sort(),
    [events]
  )

  const timeRange = useMemo(() => {
    if (events.length === 0) {
      return { start: '', end: '' }
    }
    const timestamps = events
      .map(event => new Date(event.timestamp).getTime())
      .filter(time => !Number.isNaN(time))
    if (timestamps.length === 0) {
      return { start: '', end: '' }
    }
    return {
      start: new Date(Math.min(...timestamps)).toISOString().slice(0, 10),
      end: new Date(Math.max(...timestamps)).toISOString().slice(0, 10)
    }
  }, [events])

  const suggestions = useMemo((): SearchSuggestion[] => {
    const eventSuggestions = events.map(event => ({
      id: suggestionId('event', event.id),
      text: event.description,
      type: 'event' as const,
      description: `${event.actor} -> ${event.target}`
    }))
    const arcSuggestions = arcs.map(arc => ({
      id: suggestionId('arc', arc.id),
      text: arc.name,
      type: 'arc' as const,
      description: arc.description
    }))
    const actorSuggestions = availableActors.map(actor => ({
      id: suggestionId('actor', actor),
      text: actor,
      type: 'actor' as const
    }))
    const targetSuggestions = availableTargets.map(target => ({
      id: suggestionId('target', target),
      text: target,
      type: 'target' as const
    }))
    return [...eventSuggestions, ...arcSuggestions, ...actorSuggestions, ...targetSuggestions]
  }, [events, arcs, availableActors, availableTargets])

  const handleClose = useCallback(() => setFilterPanelOpen?.(false), [setFilterPanelOpen])

  // One dismiss control at every breakpoint: the panel header's Close button
  // flips the same `uiState.filterPanelOpen` flag as the toolbar's
  // Hide/Show Filters toggle, and MainLayout unmounts the panel when it is off,
  // so closing on desktop gives the column back to the view.
  return (
    <aside
      className="fixed inset-y-0 right-0 z-40 w-80 max-w-full shrink-0 overflow-y-auto border-l border-line bg-card text-ink shadow-xl lg:static lg:z-auto lg:shadow-none"
      aria-label="Filter panel"
    >
      <FilterPanel
        filters={panelFilters}
        onFiltersChange={handleFiltersChange}
        availableActors={availableActors}
        availableTargets={availableTargets}
        timeRange={timeRange}
        onClose={handleClose}
        search={
          <SearchInterface
            value={panelFilters.searchQuery}
            onChange={(value) => handleFiltersChange({ ...panelFilters, searchQuery: value })}
            suggestions={suggestions}
            placeholder="Search events, arcs, or actors..."
          />
        }
      />
    </aside>
  )
}

/**
 * Always-visible indicator for the global filter state. Removing a tag for a
 * multi-select filter drops that value; removing a scalar filter resets it to
 * its neutral default.
 */
export function ActiveFiltersBar({ className = '' }: { className?: string }) {
  const {
    activeFilters,
    updateFilters,
    clearFilters
  } = useGlobalStore()

  const calendar = useWorldCalendar()
  const panelFilters = useMemo(
    () => toPanelFilters(activeFilters, calendar),
    [activeFilters, calendar]
  )

  const handleRemoveFilter = useCallback((key: keyof PanelFilterState, value?: unknown) => {
    switch (key) {
      case 'actors':
        updateFilters({ actors: panelFilters.actors.filter(actor => actor !== value) })
        break
      case 'targets':
        updateFilters({ targets: panelFilters.targets.filter(target => target !== value) })
        break
      case 'eventTypes':
        updateFilters({ eventTypes: panelFilters.eventTypes.filter(type => type !== value) })
        break
      case 'arcLevels':
        updateFilters({ arcLevels: panelFilters.arcLevels.filter(level => level !== value) })
        break
      case 'searchQuery':
        updateFilters({ searchQuery: '' })
        break
      case 'dateRange':
        updateFilters({ dateRange: null })
        break
      case 'confidenceThreshold':
        updateFilters({ confidenceThreshold: 0 })
        break
      case 'causalWeightRange':
        updateFilters({ causalWeightRange: [0, 1] })
        break
    }
  }, [panelFilters, updateFilters])

  return (
    <ActiveFilters
      filters={panelFilters}
      onRemoveFilter={handleRemoveFilter}
      onClearAll={clearFilters}
      className={className}
    />
  )
}
