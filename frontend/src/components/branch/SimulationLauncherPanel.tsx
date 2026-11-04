import React, { useCallback, useState } from 'react'
import { apiClient } from '@/services/api'
import {
  SIMULATION_DOMAINS,
  type SimulationDomain,
  type SimulationRequestOptions,
  type SimulationResult,
} from '@/types'
import { formatHistoricalDate } from '@/utils/historicalTime'
import { PRIMARY_BUTTON, SECONDARY_BUTTON, QUIET_BUTTON, FIELD, countNoun } from './branchUi'

export interface SimulationLauncherPanelProps {
  /** Graph to evolve forward. The panel is inert without one. */
  readonly graphId: string
  /** Human-readable name shown in the run summary. */
  readonly graphName: string
  /** Called after a run completes so the parent can refresh its data. */
  readonly onSimulated?: (result: SimulationResult) => void
}

/** Sentinel for "let the engine pick the dominant inferred pressure". */
const AUTO_DOMAIN = 'auto'
type DomainChoice = SimulationDomain | typeof AUTO_DOMAIN

const DEFAULT_STEPS = 3
const DEFAULT_MONTHS = 12
const DEFAULT_AGGRESSIVENESS = 0.5

/**
 * Controls for the autonomous historical simulation engine.
 *
 * A run is a preview first: generated history is a hypothesis, and nothing is
 * written until the user has read it and chosen to keep it. The engine is
 * deterministic over the graph and the options, so "Add to graph" runs the
 * previewed options for real and gets the events that were shown.
 *
 * The panel owns its own request state and reports a saved run upward;
 * it deliberately does not fetch graph data, so it can be dropped into the
 * branch comparison modal or a toolbar without duplicating that wiring.
 */
export const SimulationLauncherPanel = React.memo(function SimulationLauncherPanel({
  graphId,
  graphName,
  onSimulated,
}: SimulationLauncherPanelProps) {
  const [steps, setSteps] = useState(DEFAULT_STEPS)
  const [months, setMonths] = useState(DEFAULT_MONTHS)
  const [domain, setDomain] = useState<DomainChoice>(AUTO_DOMAIN)
  const [aggressiveness, setAggressiveness] = useState(DEFAULT_AGGRESSIVENESS)
  const [seedContext, setSeedContext] = useState('')
  const [isRunning, setIsRunning] = useState<'preview' | 'save' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<SimulationResult | null>(null)
  /** The options the shown preview was made with: what "Add to graph" runs. */
  const [previewOptions, setPreviewOptions] = useState<SimulationRequestOptions | null>(null)

  const handlePreview = useCallback(async () => {
    if (!graphId || isRunning) return

    setIsRunning('preview')
    setError(null)

    const options: SimulationRequestOptions = {
      steps,
      timeAdvanceMonths: months,
      aggressiveness,
      dryRun: true,
    }
    if (domain !== AUTO_DOMAIN) {
      options.domain = domain
    }
    const trimmedSeed = seedContext.trim()
    if (trimmedSeed.length > 0) {
      options.seedContext = trimmedSeed
    }

    try {
      const simulated = await apiClient.inference.simulate(graphId, options)
      setResult(simulated)
      setPreviewOptions(options)
    } catch (err) {
      setError(err instanceof Error ? `The simulation could not run: ${err.message}` : 'The simulation could not run.')
    } finally {
      setIsRunning(null)
    }
  }, [graphId, isRunning, steps, months, aggressiveness, domain, seedContext])

  const handleSave = useCallback(async () => {
    if (!graphId || isRunning || !previewOptions) return
    setIsRunning('save')
    setError(null)
    try {
      const saved = await apiClient.inference.simulate(graphId, { ...previewOptions, dryRun: false })
      setResult(saved)
      setPreviewOptions(null)
      onSimulated?.(saved)
    } catch (err) {
      setError(
        err instanceof Error
          ? `The events could not be added: ${err.message}. The preview is still here; nothing was saved.`
          : 'The events could not be added. Nothing was saved.'
      )
    } finally {
      setIsRunning(null)
    }
  }, [graphId, isRunning, previewOptions, onSimulated])

  const handleDiscard = useCallback(() => {
    setResult(null)
    setPreviewOptions(null)
  }, [])

  const canRun = graphId.length > 0 && isRunning === null

  return (
    <div className="space-y-4" data-testid="simulation-launcher">
      {/* Plain sections, not cards: this sits inside a drawer that titles it. */}
      <section aria-label="Simulate forward" className="text-sm text-ink">
        <p className="text-ink-secondary">
          Extend <span className="font-semibold text-ink">{graphName}</span> forward in steps,
          driven by the pressures inferred from its history.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mt-4">
          <label className="text-sm text-ink-secondary flex flex-col gap-1">
            <span className="font-semibold text-ink">Steps (1-10)</span>
            <input
              type="number"
              min={1}
              max={10}
              value={steps}
              onChange={e => setSteps(Number(e.target.value))}
              className={FIELD}
            />
          </label>

          <label className="text-sm text-ink-secondary flex flex-col gap-1">
            <span className="font-semibold text-ink">Months per step</span>
            <input
              type="number"
              min={1}
              value={months}
              onChange={e => setMonths(Number(e.target.value))}
              className={FIELD}
            />
          </label>

          <label className="text-sm text-ink-secondary flex flex-col gap-1">
            <span className="font-semibold text-ink">Driving pressure</span>
            <select
              value={domain}
              onChange={e => setDomain(e.target.value as DomainChoice)}
              className={FIELD}
            >
              <option value={AUTO_DOMAIN}>The strongest one inferred</option>
              {SIMULATION_DOMAINS.map(option => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>

          <div className="text-sm text-ink-secondary flex flex-col gap-1">
            <label htmlFor="simulation-strength" className="font-semibold text-ink">
              How strongly it follows through:{' '}
              <span className="font-normal text-ink-secondary">
                {aggressiveness < 0.34 ? 'cautious' : aggressiveness < 0.67 ? 'moderate' : 'bold'}{' '}
                <span className="font-mono-code">{aggressiveness.toFixed(2)}</span>
              </span>
            </label>
            <input
              id="simulation-strength"
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={aggressiveness}
              onChange={e => setAggressiveness(Number(e.target.value))}
              aria-describedby="simulation-strength-hint"
              className="mt-1.5"
            />
            <span id="simulation-strength-hint" className="text-xs text-ink-muted">
              Higher makes each step weigh more and link more firmly to what caused it.
            </span>
          </div>
        </div>

        <div className="text-sm text-ink-secondary flex flex-col gap-1 mt-3">
          <label htmlFor="simulation-premise" className="font-semibold text-ink">Premise (optional)</label>
          <span id="simulation-premise-hint" className="text-xs text-ink-muted">A what-if to steer the run; it is recorded on every simulated event.</span>
          <input
            id="simulation-premise"
            aria-describedby="simulation-premise-hint"
            type="text"
            value={seedContext}
            onChange={e => setSeedContext(e.target.value)}
            placeholder="e.g. A blockade of the eastern trade routes"
            className={FIELD}
          />
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 mt-4">
          <p className="text-xs text-ink-secondary">
            You see the simulated events first; nothing is added to the graph until you keep them.
          </p>

          <button
            type="button"
            onClick={handlePreview}
            disabled={!canRun}
            className={`${result && previewOptions ? SECONDARY_BUTTON : PRIMARY_BUTTON} w-full sm:w-auto`}
          >
            {isRunning === 'preview' ? 'Simulating…' : result && previewOptions ? 'Preview again' : 'Preview simulation'}
          </button>
        </div>

        {!graphId && (
          <p className="text-sm text-amber-900 bg-amber-50 border border-amber-200 rounded-md p-2 mt-3">
            Select a graph before running a simulation.
          </p>
        )}

        {error && (
          <p
            role="alert"
            className="text-sm text-red-800 bg-red-50 border border-red-200 rounded-md p-2 mt-3"
          >
            {error}
          </p>
        )}
      </section>

      {result && (
        <section aria-labelledby="simulation-result-heading" className="border-t border-line pt-4 text-sm text-ink">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h4 id="simulation-result-heading" className="text-base font-semibold">
              {result.dryRun ? 'Simulation preview' : 'Simulated events'} — {graphName}
            </h4>
            <div className="flex flex-wrap items-center gap-2 text-xs text-ink-secondary">
              <span className="px-2 py-0.5 rounded-full font-medium border border-line text-ink capitalize">
                {result.domain}
              </span>
              <span>
                {countNoun(result.steps, 'step')} · {countNoun(result.events.length, 'event')} ·{' '}
                {/* A preview writes no links: each event is linked to the one
                    before it as it is added. */}
                {result.dryRun ? 'linked in sequence when added' : countNoun(result.relationships.length, 'causal link')}
              </span>
            </div>
          </div>
          {result.dryRun ? (
            <p className="text-xs text-ink-secondary mt-1">A preview: nothing has been saved to the graph.</p>
          ) : (
            <p className="text-xs text-ink-secondary mt-1" role="status">
              Added to {graphName}. Version history can restore the graph to before this run.
            </p>
          )}

          {result.events.length === 0 ? (
            <p className="text-ink-secondary mt-3">The simulation produced no events.</p>
          ) : (
            <ol className="mt-3 divide-y divide-line border-y border-line" data-testid="simulated-milestones">
              {result.events.map(event => (
                <li key={event.id} className="py-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                    <span className="font-semibold text-ink-secondary font-mono-code">
                      {formatHistoricalDate(event.timestamp)}
                    </span>
                    <span className="text-ink-secondary">
                      {event.actor} → {event.target}
                    </span>
                  </div>
                  <p className="text-ink mt-1">{event.description}</p>
                </li>
              ))}
            </ol>
          )}

          {result.dryRun && result.events.length > 0 && previewOptions && (
            <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
              <button type="button" onClick={handleDiscard} disabled={isRunning !== null} className={QUIET_BUTTON}>
                Discard preview
              </button>
              <button type="button" onClick={handleSave} disabled={isRunning !== null} className={PRIMARY_BUTTON}>
                {isRunning === 'save'
                  ? 'Adding…'
                  : `Add ${countNoun(result.events.length, 'event')} to ${graphName}`}
              </button>
            </div>
          )}
        </section>
      )}
    </div>
  )
})
