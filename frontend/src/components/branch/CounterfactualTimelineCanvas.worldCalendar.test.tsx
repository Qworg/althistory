import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { CounterfactualTimelineCanvas } from './CounterfactualTimelineCanvas'
import { useWorldCalendarStore } from '@/stores/worldCalendarStore'
import type { Event, GraphCalendar } from '@/types'
import { legacyCalendarSet } from '@althistory/calendar'

const AR: GraphCalendar = legacyCalendarSet({ epochYear: 1000, eraLabel: 'AR' })

const event = (id: string, description: string, timestamp: string): Event => ({
  id,
  description,
  actor: 'Parliament',
  target: 'Crown',
  timestamp,
  created_at: timestamp,
  updated_at: timestamp,
})

const baseline = [event('e1', 'The Charter', '1843-03-04T00:00:00Z'), event('e2', 'The Old Treaty', '1850-01-01T00:00:00Z')]
const branch = [event('e1', 'The Charter', '1843-03-04T00:00:00Z'), event('e3', 'The New Treaty', '1848-01-01T00:00:00Z')]

/** The axis labels: the <text> under the axis group, which are the only dates drawn as text. */
function axisText(container: HTMLElement): string {
  return Array.from(container.querySelectorAll('svg text'))
    .map((node) => node.textContent ?? '')
    .join(' | ')
}

function draw(calendars: { baselineCalendar?: GraphCalendar | null; counterfactualCalendar?: GraphCalendar | null }) {
  return render(
    <CounterfactualTimelineCanvas
      baselineName="Earth"
      counterfactualName="Branch"
      baselineEvents={baseline}
      counterfactualEvents={branch}
      {...calendars}
    />
  )
}

describe('CounterfactualTimelineCanvas in world calendars', () => {
  afterEach(() => useWorldCalendarStore.getState().setCalendar(null))

  it("uses the compared graphs' calendars, not the open graph's", () => {
    useWorldCalendarStore.getState().setCalendar(AR)
    const { container } = draw({ baselineCalendar: null, counterfactualCalendar: null })
    expect(axisText(container)).not.toMatch(/\bAR\b/)
    expect(screen.getByLabelText(/The Charter, .*Mar 4, 1843 \(Earth lane\)/)).toBeInTheDocument()
  })

  it("labels the axis in the world's years when both graphs share its calendar", () => {
    const { container } = draw({ baselineCalendar: AR, counterfactualCalendar: AR })
    expect(axisText(container)).toMatch(/\bAR\b/)
    expect(screen.getByLabelText(/The Charter, .*Mar 4, 844 AR \(Branch lane\)/)).toBeInTheDocument()
  })

  it('labels each lane in its own calendar, and the shared axis in stored years, when they differ', () => {
    const { container } = draw({ baselineCalendar: AR, counterfactualCalendar: null })
    expect(axisText(container)).not.toMatch(/\bAR\b/)
    expect(screen.getByLabelText(/The Charter, .*Mar 4, 844 AR \(Earth lane\)/)).toBeInTheDocument()
    expect(screen.getByLabelText(/The Charter, .*Mar 4, 1843 \(Branch lane\)/)).toBeInTheDocument()
  })

  it("falls back to the open graph's calendar when none is given", () => {
    useWorldCalendarStore.getState().setCalendar(AR)
    draw({})
    expect(screen.getByLabelText(/The Charter, .*Mar 4, 844 AR \(Earth lane\)/)).toBeInTheDocument()
  })
})

describe('CounterfactualTimelineCanvas before 1 CE', () => {
  it('labels year ticks with their era, never as astronomical years', () => {
    const roman = [event('r1', 'The Ides', '-000043-03-15T00:00:00Z'), event('r2', 'Actium', '-000030-09-02T00:00:00Z')]
    const { container } = render(
      <CounterfactualTimelineCanvas
        baselineName="Rome"
        counterfactualName="Branch"
        baselineEvents={roman}
        counterfactualEvents={roman}
        baselineCalendar={null}
        counterfactualCalendar={null}
      />
    )
    const labels = axisText(container)
    expect(labels).toMatch(/\d+(-\d{2}){0,2} BCE\b/)
    expect(labels).not.toMatch(/(^|\| )-\d/)
    expect(labels).not.toMatch(/\d BC\b/)
  })
})

describe('CounterfactualTimelineCanvas over two days before 1 CE', () => {
  it('names each sub-day tick once, adding the time where the day alone would repeat', () => {
    const ides = [event('i1', 'The Ides', '-000043-03-15T00:00:00Z'), event('i2', 'The funeral', '-000043-03-17T00:00:00Z')]
    const { container } = render(
      <CounterfactualTimelineCanvas
        baselineName="Rome"
        counterfactualName="Branch"
        baselineEvents={ides}
        counterfactualEvents={ides}
        baselineCalendar={null}
        counterfactualCalendar={null}
      />
    )
    const ticks = Array.from(container.querySelectorAll('svg text'))
      .map((node) => node.textContent ?? '')
      .filter((text) => / BCE( \d{2}:\d{2})?$/.test(text))
    expect(ticks.length).toBeGreaterThan(1)
    expect(new Set(ticks).size, JSON.stringify(ticks)).toBe(ticks.length)
  })
})
