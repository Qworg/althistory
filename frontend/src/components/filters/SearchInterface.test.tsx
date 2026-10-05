import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { SearchInterface, SearchSuggestion } from './SearchInterface'

const mockSuggestions: SearchSuggestion[] = [
  {
    id: '1',
    text: 'Battle of Hastings',
    type: 'event',
    description: 'Norman conquest of England'
  },
  {
    id: '2',
    text: 'Medieval Period',
    type: 'arc',
    description: 'Historical period from 5th to 15th century'
  },
  {
    id: '3',
    text: 'William the Conqueror',
    type: 'actor',
    description: 'Norman king of England'
  },
  {
    id: '4',
    text: 'England',
    type: 'target',
    description: 'Country in Europe'
  }
]

const mockProps = {
  value: '',
  onChange: vi.fn(),
  onSuggestionSelect: vi.fn(),
  suggestions: mockSuggestions
}

describe('SearchInterface', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders search input with placeholder', () => {
    render(<SearchInterface {...mockProps} placeholder="Search events..." />)
    
    expect(screen.getByPlaceholderText('Search events...')).toBeInTheDocument()
  })

  it('calls onChange when input value changes', () => {
    render(<SearchInterface {...mockProps} />)
    
    const input = screen.getByRole('combobox')
    fireEvent.change(input, { target: { value: 'battle' } })
    
    expect(mockProps.onChange).toHaveBeenCalledWith('battle')
  })

  it('shows suggestions when input is focused and has value', async () => {
    render(<SearchInterface {...mockProps} value="battle" />)
    
    const input = screen.getByRole('combobox')
    fireEvent.focus(input)
    
    await waitFor(() => {
      expect(screen.getByText((_, element) => {
        return element?.textContent === 'Battle of Hastings'
      })).toBeInTheDocument()
    })
  })

  it('filters suggestions based on input value', async () => {
    render(<SearchInterface {...mockProps} value="william" />)
    
    const input = screen.getByRole('combobox')
    fireEvent.focus(input)
    
    await waitFor(() => {
      expect(screen.getByText((_, element) => {
        return element?.textContent === 'William the Conqueror'
      })).toBeInTheDocument()
      expect(screen.queryByText((_, element) => {
        return element?.textContent === 'Battle of Hastings'
      })).not.toBeInTheDocument()
    })
  })

  it('highlights matching text in suggestions', async () => {
    render(<SearchInterface {...mockProps} value="battle" />)
    
    const input = screen.getByRole('combobox')
    fireEvent.focus(input)
    
    await waitFor(() => {
      const highlightedText = screen.getByText('Battle')
      expect(highlightedText.tagName).toBe('MARK')
    })
  })

  it('calls onSuggestionSelect when suggestion is clicked', async () => {
    render(<SearchInterface {...mockProps} value="battle" />)
    
    const input = screen.getByRole('combobox')
    fireEvent.focus(input)
    
    await waitFor(() => {
      const suggestion = screen.getByText((_, element) => {
        return element?.textContent === 'Battle of Hastings'
      })
      fireEvent.click(suggestion)
    })
    
    expect(mockProps.onSuggestionSelect).toHaveBeenCalledWith(mockSuggestions[0])
    expect(mockProps.onChange).toHaveBeenCalledWith('Battle of Hastings')
  })

  it('handles keyboard navigation', async () => {
    render(<SearchInterface {...mockProps} value="battle" />)
    
    const input = screen.getByRole('combobox')
    fireEvent.focus(input)
    
    await waitFor(() => {
      expect(screen.getByText((_, element) => {
        return element?.textContent === 'Battle of Hastings'
      })).toBeInTheDocument()
    })
    
    // Arrow down to highlight first suggestion
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    
    const firstSuggestion = screen.getByRole('option')
    expect(firstSuggestion).toHaveAttribute('aria-selected', 'true')
    
    // Enter to select
    fireEvent.keyDown(input, { key: 'Enter' })
    
    expect(mockProps.onSuggestionSelect).toHaveBeenCalledWith(mockSuggestions[0])
  })

  it('closes suggestions on Escape key', async () => {
    render(<SearchInterface {...mockProps} value="battle" />)
    
    const input = screen.getByRole('combobox')
    fireEvent.focus(input)
    
    await waitFor(() => {
      expect(screen.getByText((_, element) => {
        return element?.textContent === 'Battle of Hastings'
      })).toBeInTheDocument()
    })
    
    fireEvent.keyDown(input, { key: 'Escape' })
    
    await waitFor(() => {
      expect(screen.queryByText((_, element) => {
        return element?.textContent === 'Battle of Hastings'
      })).not.toBeInTheDocument()
    })
  })

  it('shows clear button when input has value', () => {
    render(<SearchInterface {...mockProps} value="test" />)
    
    expect(screen.getByLabelText('Clear search')).toBeInTheDocument()
  })

  it('clears input when clear button is clicked', () => {
    render(<SearchInterface {...mockProps} value="test" />)
    
    const clearButton = screen.getByLabelText('Clear search')
    fireEvent.click(clearButton)
    
    expect(mockProps.onChange).toHaveBeenCalledWith('')
  })

  it('shows loading indicator when isLoading is true', () => {
    render(<SearchInterface {...mockProps} isLoading={true} />)
    
    const loadingSpinner = screen.getByRole('combobox').parentElement?.querySelector('.animate-spin')
    expect(loadingSpinner).toBeInTheDocument()
  })

  it('shows no results message when no suggestions match', async () => {
    render(<SearchInterface {...mockProps} value="nonexistent" />)
    
    const input = screen.getByRole('combobox')
    fireEvent.focus(input)
    
    // Wait for debounce to complete
    await waitFor(() => {
      expect(screen.getByText(/No results found/)).toBeInTheDocument()
    }, { timeout: 1500 })
  })

  it('displays correct icons for different suggestion types', async () => {
    render(<SearchInterface {...mockProps} value="a" />)
    
    const input = screen.getByRole('combobox')
    fireEvent.focus(input)
    
    await waitFor(() => {
      // Check that suggestions are displayed with their type labels
      expect(screen.getByText('Event')).toBeInTheDocument()
      expect(screen.getByText('Arc')).toBeInTheDocument()
      expect(screen.getByText('Actor')).toBeInTheDocument()
      expect(screen.getByText('Target')).toBeInTheDocument()
    })
  })

  it('has proper accessibility attributes', () => {
    render(<SearchInterface {...mockProps} />)
    
    const input = screen.getByRole('combobox')
    expect(input).toHaveAttribute('aria-expanded', 'false')
    expect(input).toHaveAttribute('aria-haspopup', 'listbox')
    expect(input).toHaveAttribute('aria-autocomplete', 'list')
  })

  it('updates aria-expanded when suggestions are shown', async () => {
    render(<SearchInterface {...mockProps} value="battle" />)
    
    const input = screen.getByRole('combobox')
    fireEvent.focus(input)
    
    await waitFor(() => {
      expect(input).toHaveAttribute('aria-expanded', 'true')
    })
  })

  it('does not show suggestions when showSuggestions is false', async () => {
    render(<SearchInterface {...mockProps} value="battle" showSuggestions={false} />)
    
    const input = screen.getByRole('combobox')
    fireEvent.focus(input)
    
    await waitFor(() => {
      expect(screen.queryByText('Battle of Hastings')).not.toBeInTheDocument()
    })
  })
})