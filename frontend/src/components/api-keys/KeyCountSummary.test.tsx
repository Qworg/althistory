import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { KeyCountSummary } from './KeyCountSummary'

describe('KeyCountSummary', () => {
  it('shows the active and total key counters', () => {
    render(
      <KeyCountSummary
        stats={{ total: 5, active: 2, inactive: 2, expired: 1 }}
      />
    )

    expect(screen.getByText('2 active / 5 total keys')).toBeInTheDocument()
  })

  it('renders nothing while the stats are unknown', () => {
    const { container } = render(<KeyCountSummary stats={undefined} />)

    expect(container).toBeEmptyDOMElement()
  })
})
