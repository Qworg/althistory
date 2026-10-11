import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { CounterfactualTimelineCanvas } from './CounterfactualTimelineCanvas'
import { Event } from '@/types'

describe('CounterfactualTimelineCanvas', () => {
  const baselineEvents: Event[] = [
    {
      id: 'e1',
      description: 'Chamberlain Resigns',
      actor: 'Parliament',
      target: 'Chamberlain',
      timestamp: '1940-05-09T00:00:00Z',
      created_at: '1940-05-09T00:00:00Z',
      updated_at: '1940-05-09T00:00:00Z',
    },
    {
      id: 'e2',
      description: 'Churchill Appointed',
      actor: 'King',
      target: 'Churchill',
      timestamp: '1940-05-10T00:00:00Z',
      created_at: '1940-05-10T00:00:00Z',
      updated_at: '1940-05-10T00:00:00Z',
    },
  ]

  const counterfactualEvents: Event[] = [
    {
      id: 'e1',
      description: 'Chamberlain Resigns',
      actor: 'Parliament',
      target: 'Chamberlain',
      timestamp: '1940-05-09T00:00:00Z',
      created_at: '1940-05-09T00:00:00Z',
      updated_at: '1940-05-09T00:00:00Z',
    },
    {
      id: 'cf_pod',
      description: 'Halifax Appointed',
      actor: 'King',
      target: 'Halifax',
      timestamp: '1940-05-10T12:00:00Z',
      created_at: '1940-05-10T12:00:00Z',
      updated_at: '1940-05-10T12:00:00Z',
    },
  ]

  it('renders lane labels and Point of Divergence indicator', () => {
    render(
      <CounterfactualTimelineCanvas
        baselineName="Prime History"
        counterfactualName="Halifax Government"
        baselineEvents={baselineEvents}
        counterfactualEvents={counterfactualEvents}
      />
    )

    expect(screen.getByText(/Baseline: Prime History/)).toBeInTheDocument()
    expect(screen.getByText(/Branch: Halifax Government/)).toBeInTheDocument()
    expect(screen.getByText(/PoD:/)).toBeInTheDocument()
    expect(screen.getByText('Point of Divergence')).toBeInTheDocument()
  })

  it('supports zoom and pan controls', () => {
    render(
      <CounterfactualTimelineCanvas
        baselineName="Prime History"
        counterfactualName="Halifax Government"
        baselineEvents={baselineEvents}
        counterfactualEvents={counterfactualEvents}
      />
    )

    const zoomInBtn = screen.getByTitle('Zoom In')
    const zoomOutBtn = screen.getByTitle('Zoom Out')
    const panLeftBtn = screen.getByTitle('Pan Left')
    const panRightBtn = screen.getByTitle('Pan Right')
    const resetBtn = screen.getByTitle('Reset View')

    fireEvent.click(zoomInBtn)
    fireEvent.click(zoomOutBtn)
    fireEvent.click(panLeftBtn)
    fireEvent.click(panRightBtn)
    fireEvent.click(resetBtn)
  })

  it('triggers onEventSelect callback on event click', () => {
    const handleSelect = vi.fn()
    render(
      <CounterfactualTimelineCanvas
        baselineName="Prime History"
        counterfactualName="Halifax Government"
        baselineEvents={baselineEvents}
        counterfactualEvents={counterfactualEvents}
        onEventSelect={handleSelect}
      />
    )

    // Click baseline event node
    const eventNode = screen.getByTestId('event-node-e1')
    fireEvent.click(eventNode)
    expect(handleSelect).toHaveBeenCalledWith(baselineEvents[0], 'baseline')
  })
})
