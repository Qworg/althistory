import { FilterState } from './FilterPanel'

interface ActiveFiltersProps {
  filters: FilterState
  onRemoveFilter: (key: keyof FilterState, value?: any) => void
  onClearAll: () => void
  className?: string
}

interface FilterTag {
  key: keyof FilterState
  label: string
  value?: any
  removable: boolean
}

export function ActiveFilters({
  filters,
  onRemoveFilter,
  onClearAll,
  className = ''
}: ActiveFiltersProps) {
  const getFilterTags = (): FilterTag[] => {
    const tags: FilterTag[] = []

    // Search query
    if (filters.searchQuery) {
      tags.push({
        key: 'searchQuery',
        label: `Search: "${filters.searchQuery}"`,
        removable: true
      })
    }

    // Date range
    if (filters.dateRange) {
      const { start, end } = filters.dateRange
      const label = start && end 
        ? `Date: ${start} to ${end}`
        : start 
        ? `Date: from ${start}`
        : end 
        ? `Date: until ${end}`
        : 'Date range'
      
      tags.push({
        key: 'dateRange',
        label,
        removable: true
      })
    }

    // Actors
    filters.actors.forEach(actor => {
      tags.push({
        key: 'actors',
        label: `Actor: ${actor}`,
        value: actor,
        removable: true
      })
    })

    // Targets
    filters.targets.forEach(target => {
      tags.push({
        key: 'targets',
        label: `Target: ${target}`,
        value: target,
        removable: true
      })
    })

    // Event types
    filters.eventTypes.forEach(eventType => {
      tags.push({
        key: 'eventTypes',
        label: `Type: ${eventType}`,
        value: eventType,
        removable: true
      })
    })

    // Arc levels
    filters.arcLevels.forEach(level => {
      tags.push({
        key: 'arcLevels',
        label: `Arc Level: ${level}`,
        value: level,
        removable: true
      })
    })

    // Confidence threshold
    if (filters.confidenceThreshold > 0) {
      tags.push({
        key: 'confidenceThreshold',
        label: `Confidence: ≥${filters.confidenceThreshold.toFixed(2)}`,
        removable: true
      })
    }

    // Causal weight range
    if (filters.causalWeightRange[0] > 0 || filters.causalWeightRange[1] < 1) {
      const [min, max] = filters.causalWeightRange
      tags.push({
        key: 'causalWeightRange',
        label: `Weight: ${min.toFixed(2)} - ${max.toFixed(2)}`,
        removable: true
      })
    }

    return tags
  }

  const handleRemoveFilter = (tag: FilterTag) => {
    if (tag.value !== undefined) {
      // For array filters, remove specific value
      onRemoveFilter(tag.key, tag.value)
    } else {
      // For single value filters, clear the entire filter
      onRemoveFilter(tag.key)
    }
  }

  const filterTags = getFilterTags()

  if (filterTags.length === 0) {
    return null
  }

  return (
    <div className={`flex flex-wrap items-center gap-2 ${className}`}>
      <span className="text-sm font-medium text-gray-700">Active filters:</span>
      
      {filterTags.map((tag, index) => (
        <span
          key={`${tag.key}-${tag.value || index}`}
          className="inline-flex items-center px-3 py-1 rounded-full text-sm bg-blue-100 text-blue-800"
        >
          <span>{tag.label}</span>
          {tag.removable && (
            <button
              onClick={() => handleRemoveFilter(tag)}
              className="ml-2 inline-flex items-center justify-center w-4 h-4 rounded-full hover:bg-blue-200 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1"
              aria-label={`Remove filter: ${tag.label}`}
            >
              <svg
                className="w-3 h-3"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          )}
        </span>
      ))}
      
      {filterTags.length > 1 && (
        <button
          onClick={onClearAll}
          className="text-sm text-gray-500 hover:text-gray-700 underline focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1 rounded"
        >
          Clear all
        </button>
      )}
    </div>
  )
}