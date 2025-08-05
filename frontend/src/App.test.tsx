import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import App from './App'

// Create a test wrapper with providers
function TestWrapper({ children }: { children: React.ReactNode }) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  })

  return (
    <QueryClientProvider client={queryClient}>
      {children}
    </QueryClientProvider>
  )
}

describe('App', () => {
  it('renders without crashing', () => {
    render(
      <TestWrapper>
        <App />
      </TestWrapper>
    )
    
    expect(screen.getByText('Timeline Interface')).toBeInTheDocument()
  })

  it('displays the timeline view by default', () => {
    render(
      <TestWrapper>
        <App />
      </TestWrapper>
    )
    
    expect(screen.getByText('Timeline View')).toBeInTheDocument()
  })
})