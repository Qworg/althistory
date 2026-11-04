import { render, screen, fireEvent, act, within } from '@testing-library/react'
import { describe, it, expect, vi, afterEach } from 'vitest'
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

    // The lanes are named in the SVG margin, with the full name in a <title>.
    const svg = screen.getByRole('img')
    expect(svg).toHaveTextContent('Prime History')
    expect(svg).toHaveTextContent('Halifax Government')
    expect(screen.getByText('Point of divergence')).toBeInTheDocument()
  })

  it('has a legend that explains every mark, not only the point of divergence', () => {
    render(
      <CounterfactualTimelineCanvas
        baselineName="Prime History"
        counterfactualName="Halifax Government"
        baselineEvents={baselineEvents}
        counterfactualEvents={counterfactualEvents}
      />
    )
    const legend = screen.getByRole('list', { name: 'Legend' })
    const entries = within(legend).getAllByRole('listitem').map(item => item.textContent)
    expect(entries).toEqual([
      'In both histories',
      'Added in branch',
      'Changed in branch',
      'Only in baseline',
      expect.stringMatching(/^Point of divergence, May (9|10), 1940$/),
    ])
  })

  it('tells the statuses apart by shape and fill, not by colour alone', () => {
    const changed: Event = { ...baselineEvents[1]!, description: 'Churchill Appointed (delayed)' }
    const { getByTestId } = render(
      <CounterfactualTimelineCanvas
        baselineName="Prime History"
        counterfactualName="Halifax Government"
        baselineEvents={baselineEvents}
        counterfactualEvents={[counterfactualEvents[0]!, changed, counterfactualEvents[1]!]}
      />
    )
    // Shared: a filled circle. Added in the branch: a filled square.
    expect(getByTestId('cf-event-node-e1').querySelector('circle:not(.event-focus-ring)')).not.toBeNull()
    const added = getByTestId('cf-event-node-cf_pod').querySelector('rect')
    expect(added).not.toBeNull()
    expect(added?.getAttribute('style')).toContain('fill: var(--accent-divergence)')
    // Changed: a hollow square.
    const modified = getByTestId('cf-event-node-e2').querySelector('rect')
    expect(modified?.getAttribute('style')).toContain('fill: var(--surface-card)')
  })

  it('draws event titles and axis dates at 12px', () => {
    const { container } = render(
      <CounterfactualTimelineCanvas
        baselineName="Prime History"
        counterfactualName="Halifax Government"
        baselineEvents={baselineEvents}
        counterfactualEvents={counterfactualEvents}
        width={1020}
      />
    )
    expect(screen.getByTestId('event-label-e1')).toHaveAttribute('font-size', '12')
    const sizes = Array.from(container.querySelectorAll('svg text')).map(t => Number(t.getAttribute('font-size')))
    expect(Math.min(...sizes)).toBeGreaterThanOrEqual(12)
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

    const zoomInBtn = screen.getByTitle('Zoom in')
    const zoomOutBtn = screen.getByTitle('Zoom out')
    const panLeftBtn = screen.getByTitle('Pan left')
    const panRightBtn = screen.getByTitle('Pan right')
    const resetBtn = screen.getByTitle(/^Reset view/)

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

  it.each(['Enter', ' '])('activates an event mark with the %j key', (key) => {
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

    const mark = screen.getByTestId('cf-event-node-cf_pod')
    expect(mark).toHaveAttribute('role', 'button')
    expect(mark).toHaveAttribute('tabindex', '0')
    const notPrevented = fireEvent.keyDown(mark, { key })
    expect(handleSelect).toHaveBeenCalledWith(counterfactualEvents[1], 'counterfactual')
    expect(notPrevented).toBe(false)
  })

  it('labels event marks with description, actor → target and the UTC date', () => {
    render(
      <CounterfactualTimelineCanvas
        baselineName="Prime History"
        counterfactualName="Halifax Government"
        baselineEvents={baselineEvents}
        counterfactualEvents={counterfactualEvents}
      />
    )

    // 12:00 UTC is shown as such whatever the test machine's time zone is.
    expect(
      screen.getByRole('button', { name: /^Halifax Appointed, King → Halifax, May 10, 1940, 12:00 UTC/ })
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Chamberlain Resigns, Parliament → Chamberlain, May 9, 1940 \(Prime History lane\)/ })).toBeInTheDocument()
  })

  it('shows the tooltip on keyboard focus with a UTC timestamp', () => {
    render(
      <CounterfactualTimelineCanvas
        baselineName="Prime History"
        counterfactualName="Halifax Government"
        baselineEvents={baselineEvents}
        counterfactualEvents={counterfactualEvents}
      />
    )

    fireEvent.focus(screen.getByTestId('cf-event-node-cf_pod'))
    const tooltip = screen.getByRole('tooltip')
    expect(tooltip).toHaveTextContent('Halifax Appointed')
    expect(tooltip).toHaveTextContent('May 10, 1940, 12:00 UTC')
    fireEvent.blur(screen.getByTestId('cf-event-node-cf_pod'))
    expect(screen.queryByRole('tooltip')).toBeNull()
  })

  it('dates the point of divergence in the legend in UTC', () => {
    render(
      <CounterfactualTimelineCanvas
        baselineName="Prime History"
        counterfactualName="Halifax Government"
        baselineEvents={baselineEvents}
        counterfactualEvents={counterfactualEvents}
      />
    )
    expect(screen.getByText(/^Point of divergence,/)).toHaveTextContent(/Point of divergence, (May 9|May 10), 1940/)
  })

  it('opens the point-of-divergence detail from the keyboard', () => {
    render(
      <CounterfactualTimelineCanvas
        baselineName="Prime History"
        counterfactualName="Halifax Government"
        baselineEvents={baselineEvents}
        counterfactualEvents={counterfactualEvents}
      />
    )
    fireEvent.keyDown(screen.getByRole('button', { name: /^Point of divergence:/ }), { key: 'Enter' })
    expect(screen.getByRole('button', { name: 'Dismiss point of divergence details' })).toBeInTheDocument()
  })

  it('names event marks with collision-free titles in each lane', () => {
    render(
      <CounterfactualTimelineCanvas
        baselineName="Prime History"
        counterfactualName="Halifax Government"
        baselineEvents={baselineEvents}
        counterfactualEvents={counterfactualEvents}
        width={1020}
      />
    )
    expect(screen.getByTestId('event-label-e1')).toHaveTextContent(/^Chamberlain Resig/)
    expect(screen.getByTestId('cf-event-label-cf_pod')).toHaveTextContent('Halifax Appointed')
    // The titles are decorative; each mark already carries its full name.
    expect(screen.getByTestId('event-label-e1').closest('[aria-hidden="true"]')).not.toBeNull()
  })

  it('keeps a long title whole where its row has room, without colliding with its neighbour', () => {
    const crowded: Event[] = [
      { ...baselineEvents[0]!, id: 'a', description: 'An extremely long description of the first event' },
      { ...baselineEvents[0]!, id: 'b', description: 'Second', timestamp: '1940-05-09T00:05:00Z' },
    ]
    render(
      <CounterfactualTimelineCanvas
        baselineName="Prime History"
        counterfactualName="Halifax Government"
        baselineEvents={crowded}
        counterfactualEvents={[]}
        width={1020}
      />
    )
    // Labels shorten only as far as a collision needs; here the row is free.
    expect(screen.getByTestId('event-label-a').textContent).toBe('An extremely long description of the first event')
    // Two marks minutes apart sit almost on top of each other: the second
    // title goes in the second row rather than over the first.
    const yA = screen.getByTestId('event-label-a').getAttribute('y')
    const yB = screen.getByTestId('event-label-b').getAttribute('y')
    expect(yB).not.toBe(yA)
  })

  it('fits a long lane name in the margin, keeping the full name in a title', () => {
    const { container } = render(
      <CounterfactualTimelineCanvas
        baselineName="Prime History"
        counterfactualName="The Engine Age — Clerks Prevail Over the Guilds"
        baselineEvents={baselineEvents}
        counterfactualEvents={counterfactualEvents}
        width={1020}
      />
    )
    const titles = Array.from(container.querySelectorAll('svg title')).map(t => t.textContent)
    expect(titles).toContain('The Engine Age — Clerks Prevail Over the Guilds')
    const laneText = Array.from(container.querySelectorAll('svg text')).find(t =>
      t.querySelector('title')?.textContent?.startsWith('The Engine Age')
    )
    const lines = Array.from(laneText?.querySelectorAll('tspan') ?? []).map(t => t.textContent ?? '')
    expect(lines[0]).toBe('The Engine Age —')
    expect(lines.length).toBe(2)
    expect(lines.every(line => line.length <= 17)).toBe(true)
    expect(lines[1]).toMatch(/…$/)
  })

  it('labels the time axis with historical dates, not ISO strings', () => {
    const { container } = render(
      <CounterfactualTimelineCanvas
        baselineName="Prime History"
        counterfactualName="Halifax Government"
        baselineEvents={baselineEvents}
        counterfactualEvents={counterfactualEvents}
        width={1020}
      />
    )
    const texts = Array.from(container.querySelectorAll('svg text')).map(t => t.textContent ?? '')
    expect(texts.some(text => /\d{4}-\d{2}-\d{2}/.test(text))).toBe(false)
    expect(texts.some(text => /May \d+, 1940/.test(text))).toBe(true)
  })

  describe('responsive width', () => {
    const OriginalResizeObserver = globalThis.ResizeObserver

    afterEach(() => {
      globalThis.ResizeObserver = OriginalResizeObserver
    })

    it('uses the width prop where the container cannot be measured', () => {
      const { container } = render(
        <CounterfactualTimelineCanvas
          baselineName="Prime History"
          counterfactualName="Halifax Government"
          baselineEvents={baselineEvents}
          counterfactualEvents={counterfactualEvents}
          width={1020}
        />
      )
      expect(container.querySelector('svg[role="img"]')).toHaveAttribute('width', '1020')
    })

    it('fills the container width reported by ResizeObserver', () => {
      let callback: ResizeObserverCallback | null = null
      const disconnect = vi.fn()
      globalThis.ResizeObserver = class {
        constructor(cb: ResizeObserverCallback) {
          callback = cb
        }
        observe = vi.fn()
        unobserve = vi.fn()
        disconnect = disconnect
      } as unknown as typeof ResizeObserver

      const { container, unmount } = render(
        <CounterfactualTimelineCanvas
          baselineName="Prime History"
          counterfactualName="Halifax Government"
          baselineEvents={baselineEvents}
          counterfactualEvents={counterfactualEvents}
          width={1020}
        />
      )
      expect(callback).not.toBeNull()

      act(() => {
        callback!([{ contentRect: { width: 640 } } as ResizeObserverEntry], {} as ResizeObserver)
      })
      expect(container.querySelector('svg[role="img"]')).toHaveAttribute('width', '640')

      unmount()
      expect(disconnect).toHaveBeenCalled()
    })

    it('gives a phone-width canvas narrower margins and axis dates that do not overprint', () => {
      let callback: ResizeObserverCallback | null = null
      globalThis.ResizeObserver = class {
        constructor(cb: ResizeObserverCallback) {
          callback = cb
        }
        observe = vi.fn()
        unobserve = vi.fn()
        disconnect = vi.fn()
      } as unknown as typeof ResizeObserver

      const { container } = render(
        <CounterfactualTimelineCanvas
          baselineName="Prime History"
          counterfactualName="Halifax Government"
          baselineEvents={baselineEvents}
          counterfactualEvents={counterfactualEvents}
          width={1020}
        />
      )
      act(() => {
        callback!([{ contentRect: { width: 340 } } as ResizeObserverEntry], {} as ResizeObserver)
      })
      const svg = container.querySelector('svg[role="img"]')!
      expect(svg).toHaveAttribute('width', '340')
      // The plot starts 96px in, not 140px, leaving it most of the width.
      const plot = Array.from(svg.querySelectorAll('g')).find(g => g.querySelector('clipPath, [clip-path]'))
      expect(plot?.getAttribute('transform')).toBe('translate(96, 32)')

      // Each axis date (12px monospace, ~7.2px a character) clears its neighbour.
      const ticks = Array.from(svg.querySelectorAll('text.font-mono-code')).map(text => ({
        x: Number(/translate\(([-\d.]+)/.exec(text.parentElement?.getAttribute('transform') ?? '')?.[1]),
        width: (text.textContent ?? '').length * 7.2,
      }))
      expect(ticks.length).toBeGreaterThan(0)
      for (let i = 1; i < ticks.length; i++) {
        const prev = ticks[i - 1]!
        const next = ticks[i]!
        expect(next.x - next.width / 2).toBeGreaterThanOrEqual(prev.x + prev.width / 2)
      }
    })

    it('works without ResizeObserver at all', () => {
      // @ts-expect-error -- simulating an environment without the API
      delete globalThis.ResizeObserver
      expect(() =>
        render(
          <CounterfactualTimelineCanvas
            baselineName="Prime History"
            counterfactualName="Halifax Government"
            baselineEvents={baselineEvents}
            counterfactualEvents={counterfactualEvents}
          />
        )
      ).not.toThrow()
    })
  })

  describe('focusing on the divergence', () => {
    const at = (id: string, year: number, description = `Event ${id}`): Event => ({
      id, description, actor: 'A', target: 'B',
      timestamp: `${year}-01-01T00:00:00.000Z`, created_at: '', updated_at: '',
    })
    const shared = [at('s1', 1835), at('s2', 1840), at('s3', 1845), at('s4', 1850), at('s5', 1855)]
    const baseline = [...shared, at('late', 1866)]
    const branch = [...shared, at('ban', 1860, 'Parliament bans engines'), at('late', 1866)]

    it('opens on the years from just before a late split, and can show all history', () => {
      render(
        <CounterfactualTimelineCanvas
          focusDivergence
          baselineName="Engine Age"
          counterfactualName="Clerks Prevail"
          baselineEvents={baseline}
          counterfactualEvents={branch}
          width={1020}
        />
      )
      // Early shared events fall outside the focused window
      expect(screen.queryByTestId('event-label-s1')).toBeNull()
      fireEvent.click(screen.getByRole('button', { name: 'All history' }))
      expect(screen.getAllByTestId('event-label-s1').length).toBeGreaterThan(0)
      expect(screen.getByRole('button', { name: 'From divergence' })).toBeInTheDocument()
    })
  })
})
