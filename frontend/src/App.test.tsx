import { describe, it, expect } from 'vitest'
import { screen } from '@testing-library/react'
import { renderWithProviders } from './test/utils'
import App from './App'

describe('App', () => {
  it('renders without crashing', () => {
    renderWithProviders(<App />, { withRouter: false })
    
    expect(screen.getByText('Timeline Interface')).toBeInTheDocument()
  })

  it('displays the timeline view by default', () => {
    renderWithProviders(<App />, { withRouter: false })
    
    // Check that timeline tab is active (aria-selected="true") and visible
    const timelineTab = screen.getByRole('tab', { name: /timeline/i })
    expect(timelineTab).toBeInTheDocument()
    expect(timelineTab).toHaveAttribute('aria-selected', 'true')
  })
})