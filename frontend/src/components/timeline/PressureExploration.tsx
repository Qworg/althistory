import React, { useState, useCallback, useId } from 'react'
import { ChevronRightIcon } from '@heroicons/react/24/outline'
import { Arc, Event } from '@/types'
import { PressureWithContext } from '@/types/pressure'
import { usePressures } from '@/hooks/usePressures'
import PressureDetailModal from '@/components/modals/PressureDetailModal'
import PressureConfidenceTracker from './PressureConfidenceTracker'
import { formatPressureType, getPressureTypeIconPath } from '@/utils/pressureVisualization'
import { formatHistoricalRange } from '@/utils/historicalTime'

export interface PressureExplorationProps {
  /**
   * The arcs and events of the graph being shown.
   *
   * They are needed to build the pressure context -- which arcs a pressure
   * falls in, and which events it rests on -- and they are not in the store
   * (which only holds what the current session wrote).
   */
  arcs?: Arc[]
  events?: Event[]
  /** `events` is filtered: count only pressures with evidence among them. */
  scopeToEvents?: boolean
  selectedEvents?: Set<string>
  onEventHighlight?: (eventIds: Set<string>) => void
  onEventSelect?: (event: Event) => void
  /** Whether the analysis starts open. The timeline is the view's subject, so it starts closed. */
  defaultExpanded?: boolean
  className?: string
}

/**
 * Confidence on the 0–1 scale the filter panel uses, so the two thresholds on
 * the Timeline view read in the same unit.
 */
function formatConfidence(score: number): string {
  return score.toFixed(2)
}

function renderPressureTypeIcon(type: string, className = 'w-4 h-4'): React.ReactNode {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75} aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d={getPressureTypeIconPath(type)} />
    </svg>
  )
}

/**
 * The pressure analysis under the timeline.
 *
 * A disclosure section, closed by default: its one-line summary (how many
 * pressures, of which kinds, how confident) is always visible, and the
 * threshold, the list and the confidence tracker open beneath it. The detail
 * modal is outside the collapsible region, so clicking an indicator on the
 * timeline opens it whether the section is open or not.
 */
/**
 * Why the pressure was inferred, in the history's own terms. The inference
 * engine's description ("Economic pressure detected in cluster from Jun 1,
 * 1847 to Jun 18, 1847") restated the row's type and dates; naming the events
 * it rests on says why, and saves hunting for them on the timeline.
 */
function pressureReason(pressure: { description: string; evidenceEvents: Array<{ description: string }> }): string {
  const generic = /pressure detected in cluster/i.test(pressure.description)
  const names = pressure.evidenceEvents.map((event) => `“${event.description}”`)
  if (!generic || names.length === 0) return pressure.description
  const shown = names.slice(0, 3)
  const more = names.length - shown.length
  const list =
    shown.length === 1 ? shown[0] : `${shown.slice(0, -1).join(', ')}${shown.length > 2 ? ',' : ''} and ${shown[shown.length - 1]}`
  return `Inferred from ${list}${more > 0 ? `, and ${more} more` : ''}.`
}

export const PressureExploration: React.FC<PressureExplorationProps> = ({
  arcs = [],
  events = [],
  scopeToEvents = false,
  onEventHighlight,
  onEventSelect,
  defaultExpanded = false,
  className = ''
}) => {
  const {
    visiblePressures,
    pressureStats,
    isLoading,
    error,
    selectedPressure,
    explorationState,
    visualConfig,
    selectPressure,
    highlightPressureEvidence,
    clearPressureHighlight,
    showEvidenceModalAction,
    hideEvidenceModal,
    trackConfidenceChange,
    setConfidenceThreshold,
    togglePressureIndicators
  } = usePressures(arcs, events, { scopeToEvents })

  const [isExpanded, setIsExpanded] = useState(defaultExpanded)
  const [showConfidenceTracker, setShowConfidenceTracker] = useState(false)

  const baseId = useId()
  const headingId = `${baseId}-heading`
  const regionId = `${baseId}-region`
  const summaryId = `${baseId}-summary`
  const thresholdId = `${baseId}-threshold`
  const thresholdHintId = `${baseId}-threshold-hint`

  // Handle pressure selection from the list
  const handlePressureSelect = useCallback((pressure: PressureWithContext) => {
    selectPressure(pressure)
    showEvidenceModalAction(pressure)
  }, [selectPressure, showEvidenceModalAction])

  // Handle evidence highlighting
  const handleHighlightEvidence = useCallback((events: Event[]) => {
    const eventIds = new Set(events.map(e => e.id))
    onEventHighlight?.(eventIds)
    highlightPressureEvidence(selectedPressure!)
  }, [onEventHighlight, highlightPressureEvidence, selectedPressure])

  // Handle clearing highlights
  const handleClearHighlight = useCallback(() => {
    onEventHighlight?.(new Set())
    clearPressureHighlight()
  }, [onEventHighlight, clearPressureHighlight])

  // Handle evidence event clicks
  const handleEvidenceEventClick = useCallback((event: Event) => {
    onEventSelect?.(event)
  }, [onEventSelect])

  // Handle confidence updates
  const handleConfidenceUpdate = useCallback((pressureId: string, newConfidence: number) => {
    trackConfidenceChange(pressureId, newConfidence)
  }, [trackConfidenceChange])

  const types = Object.keys(pressureStats.typeDistribution)
  const { visibleCount, totalPressures, hiddenCount, outOfScopeCount } = pressureStats
  const outOfScopeNote =
    outOfScopeCount > 0
      ? ` · ${outOfScopeCount} more outside the current filters`
      : ''

  // The one line that stands in for the whole section while it is closed. Each
  // type name is its own text node (lower case, as the data has it) so it can
  // be found on its own.
  const summary: React.ReactNode = isLoading ? (
    'Inferring pressures…'
  ) : error ? (
    'The pressures could not be loaded.'
  ) : totalPressures === 0 ? (
    outOfScopeCount > 0
      ? `No pressures among the filtered events (${outOfScopeCount} outside the current filters).`
      : 'No pressures detected.'
  ) : (
    <>
      {hiddenCount > 0
        ? `${visibleCount} of ${totalPressures} pressures shown`
        : `${visibleCount} ${visibleCount === 1 ? 'pressure' : 'pressures'} detected`}
      {types.length > 0 && (
        <>
          {' · '}
          {types.map((type, index) => (
            <React.Fragment key={type}>
              {index > 0 && ', '}
              <span className="text-ink">{type}</span>
            </React.Fragment>
          ))}
        </>
      )}
      {' · average confidence '}
      <span className="font-mono-code">{formatConfidence(pressureStats.averageConfidence)}</span>
      {hiddenCount > 0 && (
        <>
          {` · ${hiddenCount} below `}
          <span className="font-mono-code">{formatConfidence(visualConfig.confidenceThreshold)}</span>
        </>
      )}
      {outOfScopeNote}
    </>
  )

  return (
    <section aria-labelledby={headingId} className={`pressure-exploration ${className}`}>
      <h3 id={headingId} className="font-display text-xl font-semibold text-ink">
        <button
          type="button"
          onClick={() => setIsExpanded((open) => !open)}
          aria-expanded={isExpanded}
          aria-controls={regionId}
          aria-describedby={summaryId}
          className="-ml-1 inline-flex items-center gap-1.5 rounded-md px-1 text-left hover:text-ink-secondary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-selected"
        >
          <ChevronRightIcon
            className={`h-5 w-5 shrink-0 text-ink-muted transition-transform duration-150 ${isExpanded ? 'rotate-90' : ''}`}
            aria-hidden="true"
          />
          Pressure Analysis
        </button>
      </h3>
      <p
        id={summaryId}
        className="mt-1 text-sm text-ink-secondary"
        data-testid="pressure-summary"
        role={error ? 'alert' : undefined}
      >
        {summary}
      </p>

      <div id={regionId} hidden={!isExpanded} className="mt-4 space-y-5">
        {isExpanded && (
          <>
            {/* Controls */}
            <div className="flex flex-wrap items-start gap-x-8 gap-y-4">
              <div className="w-full max-w-sm">
                <div className="mb-1 flex items-baseline justify-between gap-4">
                  <label htmlFor={thresholdId} className="text-sm font-medium text-ink-secondary">
                    Minimum pressure confidence
                  </label>
                  <output htmlFor={thresholdId} className="font-mono-code text-sm text-ink">
                    {formatConfidence(visualConfig.confidenceThreshold)}
                  </output>
                </div>
                <input
                  id={thresholdId}
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={visualConfig.confidenceThreshold}
                  onChange={(e) => setConfidenceThreshold(parseFloat(e.target.value))}
                  aria-describedby={thresholdHintId}
                  className="w-full cursor-pointer accent-[var(--accent-baseline)]"
                />
                <p id={thresholdHintId} className="mt-1 text-xs text-ink-muted">
                  Hides inferred pressures below this score. The filter panel's threshold applies to events.
                </p>
              </div>

              <div className="flex flex-col gap-2 pt-0.5">
                <label className="inline-flex items-center gap-2 text-sm text-ink-secondary">
                  <input
                    type="checkbox"
                    checked={visualConfig.showIndicators}
                    onChange={togglePressureIndicators}
                    className="h-4 w-4 accent-[var(--accent-baseline)]"
                  />
                  Show indicators on the timeline
                </label>
                <label className="inline-flex items-center gap-2 text-sm text-ink-secondary">
                  <input
                    type="checkbox"
                    checked={showConfidenceTracker}
                    onChange={() => setShowConfidenceTracker((shown) => !shown)}
                    className="h-4 w-4 accent-[var(--accent-baseline)]"
                  />
                  Track confidence of the selected pressure
                </label>
              </div>
            </div>

            {/* Pressure list */}
            {isLoading ? (
              // A request in flight is not an absence of pressures. Showing the
              // empty state here sent the user to the confidence slider, which
              // was not the problem.
              <p className="py-4 text-sm text-ink-muted" role="status">
                The graph is being analysed for systemic pressures.
              </p>
            ) : error ? (
              <p className="py-4 text-sm text-red-700 dark:text-red-300">
                {error instanceof Error ? error.message : 'The request failed.'}
              </p>
            ) : visiblePressures.length === 0 ? (
              <p className="py-4 text-sm text-ink-muted">
                No pressures at or above this confidence. Lower the minimum to see weaker inferences.
              </p>
            ) : (
              <ul className="divide-y divide-line border-y border-line" aria-label="Detected pressures">
                {visiblePressures.map((pressure) => (
                  <li key={pressure.id}>
                    <button
                      type="button"
                      onClick={() => handlePressureSelect(pressure)}
                      className="flex w-full items-start gap-3 px-2 py-3 text-left transition-colors hover:bg-subtle focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-selected"
                    >
                      <span className="mt-0.5 shrink-0 text-ink-muted">
                        {renderPressureTypeIcon(pressure.pressure_type, 'w-5 h-5')}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2">
                          <span
                            className="h-2.5 w-2.5 shrink-0 rounded-full"
                            style={{ backgroundColor: pressure.renderColor, opacity: pressure.renderOpacity }}
                            aria-hidden="true"
                          />
                          <span className="text-sm font-semibold text-ink">
                            {formatPressureType(pressure.pressure_type)} pressure
                          </span>
                        </span>
                        <span className="mt-0.5 block text-xs text-ink-muted">
                          Confidence <span className="font-mono-code text-ink-secondary">{formatConfidence(pressure.confidence_score)}</span>
                          {' · '}
                          {pressure.evidenceEvents.length} evidence {pressure.evidenceEvents.length === 1 ? 'event' : 'events'}
                          {/* When it was inferred over, and where that falls. This
                              slot used to show "Influence", a client-side
                              confidence × evidence figure capped at 1: it read
                              100% for nearly every pressure. */}
                          {pressure.time_range && (
                            <>
                              {' · '}
                              <span className="font-mono-code text-ink-secondary">
                                {formatHistoricalRange(pressure.time_range.start, pressure.time_range.end)}
                              </span>
                            </>
                          )}
                          {pressure.affectedArcs.length > 0 && (
                            <>
                              {' · in '}
                              {pressure.affectedArcs.map((arc) => arc.name).join(', ')}
                            </>
                          )}
                        </span>
                        <span className="mt-1 block text-sm leading-relaxed text-ink-secondary">
                          {pressureReason(pressure)}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}

            {/* Confidence tracker */}
            {showConfidenceTracker && (
              selectedPressure ? (
                <PressureConfidenceTracker
                  pressure={selectedPressure}
                  confidenceHistory={explorationState.confidenceTracking.get(selectedPressure.id) || []}
                  onConfidenceUpdate={(newConfidence) =>
                    handleConfidenceUpdate(selectedPressure.id, newConfidence)
                  }
                  showHistory={true}
                />
              ) : (
                <p className="text-sm text-ink-muted">Select a pressure in the list to track its confidence.</p>
              )
            )}
          </>
        )}
      </div>

      {/* Pressure Detail Modal: outside the collapsible region, so an
          indicator clicked on the timeline opens it either way. */}
      <PressureDetailModal
        pressure={selectedPressure}
        isOpen={explorationState.showEvidenceModal}
        onClose={hideEvidenceModal}
        onEvidenceEventClick={handleEvidenceEventClick}
        onHighlightEvidence={handleHighlightEvidence}
        onClearHighlight={handleClearHighlight}
      />
    </section>
  )
}

export default PressureExploration
