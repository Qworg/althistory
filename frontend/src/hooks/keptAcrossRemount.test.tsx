import { Fragment, useEffect } from 'react'
import { describe, expect, it } from 'vitest'
import { act, render } from '@testing-library/react'
import { type EditHistory, useEditHistory } from './useEditHistory'
import { useKeptState } from './useKeptState'

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
