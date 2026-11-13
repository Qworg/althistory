import { Fragment, useEffect, useState } from 'react'
import { describe, expect, it } from 'vitest'
import { act, render } from '@testing-library/react'
import { type EditHistory, useEditHistory } from './useEditHistory'
import { useKeptRef, useKeptState } from './useKeptState'

const entry = { description: 'Moved "Hastings"', undo: async () => true, redo: async () => true }

/** A view under a key: a new key remounts it in the same render, as WorldCalendarBoundary does. */
function Keyed({ remount, graph, seen }: { remount: number; graph: string; seen: (state: { history: EditHistory; selection: [string | null, (next: string | null) => void] }) => void }) {
  return (
    <Fragment key={remount}>
      <View graph={graph} seen={seen} />
    </Fragment>
  )
}
function View({ graph, seen }: { graph: string; seen: Parameters<typeof Keyed>[0]['seen'] }) {
  const history = useEditHistory({ resetKey: graph, keepAs: 'remount-test' })
  const selection = useKeptState<string | null>('remount-test.selection', graph, null)
  useEffect(() => {
    seen({ history, selection })
  })
  return null
}

describe('state a view keeps when it is remounted for another calendar', () => {
  it('passes the edit history and the selection to the view that replaces it, for the same graph only', () => {
    let state!: Parameters<Parameters<typeof Keyed>[0]['seen']>[0]
    const seen = (next: typeof state) => (state = next)
    const view = render(<Keyed remount={1} graph="graph-a" seen={seen} />)
    act(() => {
      state.history.record(entry)
      state.selection[1]('event-1')
    })

    view.rerender(<Keyed remount={2} graph="graph-a" seen={seen} />)
    expect(state.history.canUndo).toBe(true)
    expect(state.history.lastMessage).toBe('Moved "Hastings"')
    expect(state.selection[0]).toBe('event-1')

    view.rerender(<Keyed remount={2} graph="graph-b" seen={seen} />)
    expect(state.history.canUndo).toBe(false)
    expect(state.selection[0]).toBeNull()
    view.unmount()
  })

  it('is not kept once the view is simply unmounted', () => {
    let state!: Parameters<Parameters<typeof Keyed>[0]['seen']>[0]
    const seen = (next: typeof state) => (state = next)
    const first = render(<Keyed remount={1} graph="graph-a" seen={seen} />)
    act(() => {
      state.history.record(entry)
      state.selection[1]('event-1')
    })
    first.unmount()
    render(<Keyed remount={1} graph="graph-a" seen={seen} />)
    expect(state.history.canUndo).toBe(false)
    expect(state.selection[0]).toBeNull()
  })
})

describe('state kept across a remount, when the graph changes at the same time', () => {
  /** A layout that, like useWorldCalendarSync, changes the calendar (the boundary's key) in its own effect after the graph changes. */
  function Layout({ graph, seen }: { graph: string; seen: (selection: string | null) => void }) {
    const [calendarOf, setCalendarOf] = useState(graph)
    useEffect(() => setCalendarOf(graph), [graph])
    return (
      <Fragment key={calendarOf}>
        <Selecting graph={graph} seen={seen} />
      </Fragment>
    )
  }
  let select: (id: string | null) => void = () => undefined
  function Selecting({ graph, seen }: { graph: string; seen: (selection: string | null) => void }) {
    const [selection, setSelection] = useKeptState<string | null>('remount-test.layout', graph, null)
    select = setSelection
    seen(selection)
    return null
  }

  it("never gives another graph's selection, not even for one render", () => {
    const shown: Array<string | null> = []
    const view = render(<Layout graph="graph-a" seen={(selection) => shown.push(selection)} />)
    act(() => select('event-of-a'))
    shown.length = 0
    view.rerender(<Layout graph="graph-b" seen={(selection) => shown.push(selection)} />)
    expect(shown.length).toBeGreaterThan(0)
    expect(shown.every((selection) => selection === null)).toBe(true)
    view.unmount()
  })
})

describe('a ref kept across a remount', () => {
  let ref: { current: string } = { current: '' }
  function Holder({ remountKey, data }: { remountKey: number; data: string }) {
    return (
      <Fragment key={remountKey}>
        <Reading data={data} />
      </Fragment>
    )
  }
  function Reading({ data }: { data: string }) {
    const kept = useKeptRef('remount-test.ref', 'graph-a', data)
    kept.current = data
    ref = kept
    return null
  }

  it('is the same object after the remount, holding what the mounted view last put in it', () => {
    const view = render(<Holder remountKey={1} data="E v1" />)
    const before = ref
    // An undo entry recorded now reads through `before` later.
    view.rerender(<Holder remountKey={2} data="E v1" />)
    view.rerender(<Holder remountKey={2} data="gone" />)
    expect(ref).toBe(before)
    expect(before.current).toBe('gone')
    view.unmount()
  })
})
