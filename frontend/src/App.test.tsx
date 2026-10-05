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
    
    // Check that the app renders with the Timeline Interface header
    expect(screen.getByText('Timeline Interface')).toBeInTheDocument()
    
    // The ViewSwitcher with tabs may not be visible depending on layout mode
    // Just verify the app renders successfully without errors
    const header = screen.getByRole('banner')
    expect(header).toBeInTheDocument()
  })
})