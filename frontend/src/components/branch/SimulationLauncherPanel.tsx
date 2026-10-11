import React, { useCallback, useState } from 'react'
import { apiClient } from '@/services/api'
import {
  SIMULATION_DOMAINS,
  type SimulationDomain,
  type SimulationRequestOptions,
  type SimulationResult,
} from '@/types'

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
      <div className="bg-white rounded-lg border border-indigo-100 shadow-xs p-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-sm font-bold text-gray-900 flex items-center gap-1.5">
              <span>🔮</span> Autonomous Forward Simulation
            </h3>
            <p className="text-xs text-gray-500 mt-0.5">
              Evolve <span className="font-semibold">{graphName}</span> forward in discrete hops
              under inferred historical pressures.
            </p>
          </div>
          <span className="text-[10px] font-semibold uppercase tracking-wider text-indigo-700 bg-indigo-50 border border-indigo-200 rounded-full px-2 py-0.5">
            Option 1
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mt-4">
          <label className="text-xs text-gray-600 flex flex-col gap-1">
            <span className="font-semibold text-gray-700">Steps (1-10)</span>
            <input
              type="number"
              min={1}
              max={10}
              value={steps}
              onChange={e => setSteps(Number(e.target.value))}
              className="border border-gray-300 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
          </label>

          <label className="text-xs text-gray-600 flex flex-col gap-1">
            <span className="font-semibold text-gray-700">Months per step</span>
            <input
              type="number"
              min={1}
              value={months}
              onChange={e => setMonths(Number(e.target.value))}
              className="border border-gray-300 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
          </label>

          <label className="text-xs text-gray-600 flex flex-col gap-1">
            <span className="font-semibold text-gray-700">Domain</span>
            <select
              value={domain}
              onChange={e => setDomain(e.target.value as DomainChoice)}
              className="border border-gray-300 rounded px-2 py-1 text-xs bg-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
            >
              <option value={AUTO_DOMAIN}>Auto (dominant pressure)</option>
              {SIMULATION_DOMAINS.map(option => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>

          <label className="text-xs text-gray-600 flex flex-col gap-1">
            <span className="font-semibold text-gray-700">
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

        <label className="text-xs text-gray-600 flex flex-col gap-1 mt-3">
          <span className="font-semibold text-gray-700">Seed context (optional)</span>
          <input
            type="text"
            value={seedContext}
            onChange={e => setSeedContext(e.target.value)}
            placeholder="e.g. A blockade of the eastern trade routes"
            className="border border-gray-300 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
        </label>

        <div className="flex flex-wrap items-center justify-between gap-3 mt-4">
          <label className="flex items-center gap-2 text-xs text-gray-600">
            <input
              type="checkbox"
              checked={dryRun}
              onChange={e => setDryRun(e.target.checked)}
              className="rounded border-gray-300"
            />
            Preview only (persist nothing)
          </label>

          <button
            type="button"
            onClick={handleRun}
            disabled={!canRun}
            className="px-4 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-300 disabled:cursor-not-allowed rounded-lg transition-colors shadow-xs"
          >
            {isRunning ? 'Simulating…' : 'Run Simulation'}
          </button>
        </div>

        {!graphId && (
          <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded p-2 mt-3">
            Select a graph before running a simulation.
          </p>
        )}

        {error && (
          <p
            role="alert"
            className="text-xs text-red-700 bg-red-50 border border-red-200 rounded p-2 mt-3"
          >
            {error}
          </p>
        )}
      </div>

      {result && (
        <div className="bg-white rounded-lg border border-gray-200 shadow-xs p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h4 className="text-xs font-bold text-gray-900">
              {result.dryRun ? 'Simulation Preview' : 'Simulated Milestones'} — {graphName}
            </h4>
            <div className="flex items-center gap-2 text-[10px]">
              <span className="px-2 py-0.5 rounded-full font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200">
                {result.domain}
              </span>
              <span className="text-gray-500">
                {result.steps} step(s) · {result.events.length} events ·{' '}
                {result.relationships.length} causal links
              </span>
            </div>
          </div>

          {result.events.length === 0 ? (
            <p className="text-xs text-gray-500 mt-3">The engine produced no milestones.</p>
          ) : (
            <ol className="mt-3 space-y-2" data-testid="simulated-milestones">
              {result.events.map(event => (
                <li
                  key={event.id}
                  className="border border-gray-100 rounded p-3 bg-gray-50/60"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] font-semibold text-gray-500">
                      {new Date(event.timestamp).toLocaleDateString()}
                    </span>
                    <span className="text-[10px] text-gray-500">
                      {event.actor} → {event.target}
                    </span>
                  </div>
                  <p className="text-xs text-gray-900 mt-1">{event.description}</p>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </div>
  )
})
