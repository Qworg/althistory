import { describe, it, expect } from 'vitest'
import { render, fireEvent, screen } from '@testing-library/react'
import { MemoryRouter, Routes, Route, useLocation } from 'react-router'
import { useViewShortcuts } from './useViewShortcuts'

function Harness() {
  useViewShortcuts()
  const location = useLocation()
  return <p data-testid="path">{location.pathname}</p>
}

const renderAt = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="*" element={<Harness />} />
      </Routes>
    </MemoryRouter>
  )

describe('useViewShortcuts', () => {
  it('switches views with Shift+digit, read by physical key (Shift+2 types "@")', () => {
    renderAt('/timeline')
    fireEvent.keyDown(document, { key: '@', code: 'Digit2', shiftKey: true })
    expect(screen.getByTestId('path')).toHaveTextContent('/causal-graph')
  })

  it('still accepts Alt+digit as an alternative', () => {
    renderAt('/timeline')
    fireEvent.keyDown(document, { key: '3', code: 'Digit3', altKey: true })
    expect(screen.getByTestId('path')).toHaveTextContent('/actor-perspective')
  })

  it('leaves a bare digit alone (the graph uses 9, 1 and 6 for layouts)', () => {
    renderAt('/timeline')
    fireEvent.keyDown(document, { key: '2', code: 'Digit2' })
    expect(screen.getByTestId('path')).toHaveTextContent('/timeline')
  })
})
