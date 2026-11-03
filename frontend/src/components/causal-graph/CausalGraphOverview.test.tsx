import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor, act } from '@testing-library/react'
import type { Core } from 'cytoscape'
import cytoscape from 'cytoscape'
import { createMockCytoscape } from '@/test/__mocks__/cytoscape'
import type { Event } from '@/types'

vi.mock('cytoscape', () => import('@/test/__mocks__/cytoscape'))
import { CausalGraphOverview } from './CausalGraphOverview'

describe('CausalGraphOverview', () => {
  it('is a headed section on the surface it sits on, not a nested card', () => {
    const { container } = render(
      <CausalGraphOverview mainCytoscapeInstance={null} events={[]} causalRelationships={[]} />
    )

    expect(screen.getByRole('heading', { level: 3, name: 'Graph Overview' })).toBeInTheDocument()
    expect(container.querySelector('.shadow-sm, .bg-white')).toBeNull()
  })

  it('explains the map in text that meets contrast (no light-grey hint)', () => {
    render(<CausalGraphOverview mainCytoscapeInstance={null} events={[]} causalRelationships={[]} />)

    const hint = screen.getByText(/click the map/i)
    expect(hint).toHaveClass('text-ink-secondary')
    expect(hint.className).not.toMatch(/text-gray-400/)
  })

  it('renders nothing when the minimap is off', () => {
    const { container } = render(
      <CausalGraphOverview mainCytoscapeInstance={null} events={[]} causalRelationships={[]} showMinimap={false} />
    )
    expect(container).toBeEmptyDOMElement()
  })

  it("copies the main graph's node positions again once its layout settles", async () => {
    // The overview is filled before the main layout runs, when every node is
    // still at the origin; without a resync the map showed one dot.
    const main = createMockCytoscape()
    // The viewport indicator reads the main graph's visible extent
    Object.assign(main, { extent: vi.fn(() => ({ x1: 0, y1: 0, x2: 500, y2: 400, w: 500, h: 400 })) })
    const settled = { x: 240, y: 120 }
    main.nodes = vi.fn(() => ({
      forEach: (cb: (node: { id: () => string; position: () => { x: number; y: number } }) => void) =>
        cb({ id: () => 'e1', position: () => settled }),
    })) as unknown as typeof main.nodes
    const event: Event = {
      id: 'e1', description: 'Treaty', actor: 'A', target: 'B',
      timestamp: '1843-01-01T00:00:00Z', created_at: '', updated_at: '',
    }

    render(
      <CausalGraphOverview mainCytoscapeInstance={main as unknown as Core} events={[event]} causalRelationships={[]} />
    )

    const overview = await waitFor(() => {
      const results = vi.mocked(cytoscape).mock.results
      const instance = results[results.length - 1]?.value as unknown as ReturnType<typeof createMockCytoscape>
      expect(instance).toBeDefined()
      return instance
    })
    Object.assign(overview, { extent: vi.fn(() => ({ x1: 0, y1: 0, x2: 200, y2: 150, w: 200, h: 150 })) })
    const position = vi.fn()
    overview.getElementById = vi.fn(() => ({ length: 1, position, addClass: vi.fn() })) as unknown as typeof overview.getElementById

    const layoutstop = await waitFor(() => {
      const call = main.on.mock.calls.find((args) => args[0] === 'layoutstop')
      expect(call).toBeDefined()
      return call![1] as () => void
    })
    layoutstop()

    expect(position).toHaveBeenCalledWith(settled)
    expect(overview.fit).toHaveBeenCalled()
  })

  describe('"in view" rectangle', () => {
    const size = (w: number, h: number) => {
      const width = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth')
      const height = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientHeight')
      Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => w })
      Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => h })
      return () => {
        if (width) Object.defineProperty(HTMLElement.prototype, 'clientWidth', width)
        if (height) Object.defineProperty(HTMLElement.prototype, 'clientHeight', height)
      }
    }

    async function renderWithExtents(mainExtent: { x1: number; y1: number; x2: number; y2: number }) {
      const main = createMockCytoscape()
      Object.assign(main, { extent: vi.fn(() => ({ ...mainExtent, w: mainExtent.x2 - mainExtent.x1, h: mainExtent.y2 - mainExtent.y1 })) })
      main.nodes = vi.fn(() => ({ forEach: () => {} })) as unknown as typeof main.nodes
      render(<CausalGraphOverview mainCytoscapeInstance={main as unknown as Core} events={[]} causalRelationships={[]} height={150} />)
      const overview = await waitFor(() => {
        const results = vi.mocked(cytoscape).mock.results
        const instance = results[results.length - 1]?.value as unknown as ReturnType<typeof createMockCytoscape>
        expect(instance).toBeDefined()
        return instance
      })
      // The overview shows the model region 0..200 x 0..150 (1 model px per map px)
      Object.assign(overview, { extent: vi.fn(() => ({ x1: 0, y1: 0, x2: 200, y2: 150, w: 200, h: 150 })) })
      overview.getElementById = vi.fn(() => ({ length: 0, addClass: vi.fn() })) as unknown as typeof overview.getElementById
      const layoutstop = await waitFor(() => {
        const call = main.on.mock.calls.find((args) => args[0] === 'layoutstop')
        expect(call).toBeDefined()
        return call![1] as () => void
      })
      act(() => layoutstop())
      return screen.getByTestId('overview-viewport')
    }

    it('frames the whole map when the whole graph is in view', async () => {
      const restore = size(200, 150)
      try {
        // The main view sees more than the graph (fitted with padding)
        const rect = await renderWithExtents({ x1: -50, y1: -40, x2: 260, y2: 200 })
        expect(rect.style.left).toBe('0px')
        expect(rect.style.top).toBe('0px')
        expect(rect.style.width).toBe('200px')
        expect(rect.style.height).toBe('150px')
      } finally {
        restore()
      }
    })

    it('frames the visible part when the main view is zoomed in', async () => {
      const restore = size(200, 150)
      try {
        const rect = await renderWithExtents({ x1: 50, y1: 30, x2: 150, y2: 105 })
        expect(rect.style.left).toBe('50px')
        expect(rect.style.top).toBe('30px')
        expect(rect.style.width).toBe('100px')
        expect(rect.style.height).toBe('75px')
      } finally {
        restore()
      }
    })
  })
})
