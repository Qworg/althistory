import { screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { SimulationLauncherPanel } from './SimulationLauncherPanel'
import { renderWithProviders } from '@/test/utils'
import { apiClient } from '@/services/api'
import type { SimulationResult } from '@/types'

vi.mock('@/services/api', () => ({
  apiClient: {
    inference: {
      simulate: vi.fn(),
    },
  },
}))

const simulateMock = vi.mocked(apiClient.inference.simulate)

function makeResult(overrides: Partial<SimulationResult> = {}): SimulationResult {
  return {
    graphId: 'graph-1',
    anchorEventId: 'event-1',
    domain: 'military',
    steps: 2,
    stepDurationMs: 1000,
    aggressiveness: 0.5,
    dryRun: false,
    events: [
      {
        id: 'sim-1',
        description: 'Roman Republic mobilises armed forces against Carthage',
        actor: 'Roman Republic',
        target: 'Carthage',
        timestamp: '0201-01-01T00:00:00.000Z',
        metadata: { simulated: true, domain: 'military' },
      },
    ],
    relationships: [],
    pressures: [],
    ...overrides,
  }
}

describe('SimulationLauncherPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    simulateMock.mockResolvedValue(makeResult())
  })

  it('disables the run button when no graph is selected', () => {
    renderWithProviders(<SimulationLauncherPanel graphId="" graphName="Prime Timeline" />)

    expect(screen.getByRole('button', { name: /Run Simulation/ })).toBeDisabled()
    expect(screen.getByText(/Select a graph before running/)).toBeInTheDocument()
  })

  it('runs a simulation with the selected options and reports the result upward', async () => {
    const onSimulated = vi.fn()
    renderWithProviders(
      <SimulationLauncherPanel graphId="graph-1" graphName="Prime Timeline" onSimulated={onSimulated} />
    )

    fireEvent.change(screen.getByLabelText(/Steps/), { target: { value: '4' } })
    fireEvent.change(screen.getByLabelText(/Months per step/), { target: { value: '24' } })
    fireEvent.change(screen.getByLabelText(/Domain/), { target: { value: 'military' } })
    fireEvent.change(screen.getByLabelText(/Seed context/), { target: { value: 'A blockade' } })

    fireEvent.click(screen.getByRole('button', { name: /Run Simulation/ }))

    await waitFor(() => expect(onSimulated).toHaveBeenCalledTimes(1))
    expect(simulateMock).toHaveBeenCalledWith('graph-1', {
      steps: 4,
      timeAdvanceMonths: 24,
      aggressiveness: 0.5,
      dryRun: false,
      domain: 'military',
      seedContext: 'A blockade',
    })

    expect(await screen.findByTestId('simulated-milestones')).toBeInTheDocument()
    expect(screen.getByText(/mobilises armed forces/)).toBeInTheDocument()
    expect(screen.getAllByText(/military/).length).toBeGreaterThan(0)
  })

  it('omits the domain when left on auto', async () => {
    renderWithProviders(<SimulationLauncherPanel graphId="graph-1" graphName="Prime Timeline" />)

    fireEvent.click(screen.getByRole('button', { name: /Run Simulation/ }))

    await waitFor(() => expect(simulateMock).toHaveBeenCalledTimes(1))
    const options = simulateMock.mock.calls[0]?.[1]
    expect(options).not.toHaveProperty('domain')
  })

  it('passes dryRun through and labels the result as a preview', async () => {
    simulateMock.mockResolvedValue(makeResult({ dryRun: true }))
    renderWithProviders(<SimulationLauncherPanel graphId="graph-1" graphName="Prime Timeline" />)

    fireEvent.click(screen.getByLabelText(/Preview only/))
    fireEvent.click(screen.getByRole('button', { name: /Run Simulation/ }))

    await waitFor(() => expect(simulateMock).toHaveBeenCalledTimes(1))
    expect(simulateMock).toHaveBeenCalledWith('graph-1', expect.objectContaining({ dryRun: true }))
    expect(await screen.findByText(/Simulation Preview/)).toBeInTheDocument()
  })

  it('surfaces an engine failure instead of leaving the spinner running', async () => {
    simulateMock.mockRejectedValue(new Error('graph has no events'))
    renderWithProviders(<SimulationLauncherPanel graphId="graph-1" graphName="Prime Timeline" />)

    fireEvent.click(screen.getByRole('button', { name: /Run Simulation/ }))

    expect(await screen.findByRole('alert')).toHaveTextContent('graph has no events')
    expect(screen.getByRole('button', { name: /Run Simulation/ })).toBeEnabled()
  })
})
