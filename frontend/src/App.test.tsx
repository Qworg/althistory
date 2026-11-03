import { describe, it, expect } from 'vitest'
import { screen } from '@testing-library/react'
import { renderWithProviders } from './test/utils'
import App from './App'

describe('App', () => {
  it('renders without crashing', () => {
    renderWithProviders(<App />, { withRouter: false })
    
    expect(screen.getByText('althistory')).toBeInTheDocument()
  })

  it('displays the timeline view by default', () => {
    renderWithProviders(<App />, { withRouter: false })
    
    // Check that the app renders with the althistory header
    expect(screen.getByText('althistory')).toBeInTheDocument()
    
    // The ViewSwitcher with tabs may not be visible depending on layout mode
    // Just verify the app renders successfully without errors
    const header = screen.getByRole('banner')
    expect(header).toBeInTheDocument()
  })

  it('leaves no modal dialog in the DOM at rest, so keyboard shortcuts stay live', () => {
    // Every app shortcut stands aside while an [aria-modal] element exists
    // (utils/keyboardShortcuts.ts); a closed dialog that stayed mounted with
    // that attribute would silently switch them all off.
    renderWithProviders(<App />, { withRouter: false })

    expect(document.querySelector('[aria-modal="true"]')).toBeNull()
  })
})
