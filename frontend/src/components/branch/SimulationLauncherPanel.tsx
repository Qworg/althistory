import React, { useCallback, useState } from 'react'
import { apiClient } from '@/services/api'
import {
  SIMULATION_DOMAINS,
  type SimulationDomain,
  type SimulationRequestOptions,
  type SimulationResult,
} from '@/types'
import { formatHistoricalDate } from '@/utils/historicalTime'
import { PRIMARY_BUTTON, FIELD, countNoun } from './branchUi'

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
 * The panel owns its own request state and reports the completed run upward;
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
  const [dryRun, setDryRun] = useState(false)
  const [isRunning, setIsRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<SimulationResult | null>(null)

  const handleRun = useCallback(async () => {
    if (!graphId || isRunning) return

    setIsRunning(true)
    setError(null)

    const options: SimulationRequestOptions = {
      steps,
      timeAdvanceMonths: months,
      aggressiveness,
      dryRun,
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
      onSimulated?.(simulated)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Simulation failed')
    } finally {
      setIsRunning(false)
    }
  }, [graphId, isRunning, steps, months, aggressiveness, dryRun, domain, seedContext, onSimulated])

  const canRun = graphId.length > 0 && !isRunning

  return (
    <div className="space-y-4" data-testid="simulation-launcher">
      {/* Plain sections, not cards: this sits inside the comparison dialog. */}
      <section aria-labelledby="simulation-heading" className="text-sm text-ink">
        <h3 id="simulation-heading" className="font-display text-xl font-semibold">
          Simulate forward
        </h3>
        <p className="text-ink-secondary mt-0.5">
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
            <span className="font-semibold text-ink">Domain</span>
            <select
              value={domain}
              onChange={e => setDomain(e.target.value as DomainChoice)}
              className={FIELD}
            >
              <option value={AUTO_DOMAIN}>Auto (dominant pressure)</option>
              {SIMULATION_DOMAINS.map(option => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>

          <label className="text-sm text-ink-secondary flex flex-col gap-1">
            <span className="font-semibold text-ink">
              Aggressiveness: {aggressiveness.toFixed(2)}
            </span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={aggressiveness}
              onChange={e => setAggressiveness(Number(e.target.value))}
              className="mt-1.5"
            />
          </label>
        </div>

        <label className="text-sm text-ink-secondary flex flex-col gap-1 mt-3">
          <span className="font-semibold text-ink">Seed context (optional)</span>
          <input
            type="text"
            value={seedContext}
            onChange={e => setSeedContext(e.target.value)}
            placeholder="e.g. A blockade of the eastern trade routes"
            className={FIELD}
          />
        </label>

        <div className="flex flex-wrap items-center justify-between gap-3 mt-4">
          <label className="flex items-center gap-2 text-sm text-ink-secondary">
            <input
              type="checkbox"
              checked={dryRun}
              onChange={e => setDryRun(e.target.checked)}
              className="rounded border-line"
            />
            Preview only (persist nothing)
          </label>

          <button
            type="button"
            onClick={handleRun}
            disabled={!canRun}
            className={`${PRIMARY_BUTTON} w-full sm:w-auto`}
          >
            {isRunning ? 'Simulating…' : 'Run simulation'}
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
                {countNoun(result.relationships.length, 'causal link')}
              </span>
            </div>
          </div>
          {result.dryRun && (
            <p className="text-xs text-ink-secondary mt-1">A preview: nothing was saved to the graph.</p>
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
        </section>
      )}
    </div>
  )
})
