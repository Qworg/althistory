import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from '../../test/utils'
import { ActorSelector } from './ActorSelector'

const mockActors = ['Alice', 'Bob', 'Charlie', 'David', 'Eve']

describe('ActorSelector', () => {
  const mockOnActorSelect = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Initial Render', () => {
    it('renders with default placeholder', () => {
      renderWithProviders(
        <ActorSelector
          actors={mockActors}
          selectedActor=""
          onActorSelect={mockOnActorSelect}
        />
      )
      
      expect(screen.getByText('Select Actor')).toBeInTheDocument()
      expect(screen.getByText('Search and select an actor...')).toBeInTheDocument()
    })

    it('renders with custom placeholder', () => {
      renderWithProviders(
        <ActorSelector
          actors={mockActors}
          selectedActor=""
          onActorSelect={mockOnActorSelect}
          placeholder="Choose an actor..."
        />
      )
      
      expect(screen.getByText('Choose an actor...')).toBeInTheDocument()
    })

    it('shows selected actor when provided', () => {
      renderWithProviders(
        <ActorSelector
          actors={mockActors}
          selectedActor="Alice"
          onActorSelect={mockOnActorSelect}
        />
      )
      
      expect(screen.getByText('Alice')).toBeInTheDocument()
    })

    it('shows clear button when actor is selected', () => {
      renderWithProviders(
        <ActorSelector
          actors={mockActors}
          selectedActor="Alice"
          onActorSelect={mockOnActorSelect}
        />
      )
      
      expect(screen.getByLabelText('Clear selection')).toBeInTheDocument()
    })

    it('does not show clear button when no actor is selected', () => {
      renderWithProviders(
        <ActorSelector
          actors={mockActors}
          selectedActor=""
          onActorSelect={mockOnActorSelect}
        />
      )
      
      expect(screen.queryByLabelText('Clear selection')).not.toBeInTheDocument()
    })
  })

  describe('Dropdown Functionality', () => {
    it('opens dropdown when clicked', async () => {
      const user = userEvent.setup()
      
      renderWithProviders(
        <ActorSelector
          actors={mockActors}
          selectedActor=""
          onActorSelect={mockOnActorSelect}
        />
      )
      
      const button = screen.getByRole('button')
      await user.click(button)
      
      expect(screen.getByPlaceholderText('Search actors...')).toBeInTheDocument()
      expect(screen.getByText('Alice')).toBeInTheDocument()
      expect(screen.getByText('Bob')).toBeInTheDocument()
    })

    it('closes dropdown when clicking outside', async () => {
      const user = userEvent.setup()
      
      renderWithProviders(
        <div>
          <ActorSelector
            actors={mockActors}
            selectedActor=""
            onActorSelect={mockOnActorSelect}
          />
          <div data-testid="outside">Outside element</div>
        </div>
      )
      
      const button = screen.getByRole('button')
      await user.click(button)
      
      expect(screen.getByPlaceholderText('Search actors...')).toBeInTheDocument()
      
      const outside = screen.getByTestId('outside')
      await user.click(outside)
      
      expect(screen.queryByPlaceholderText('Search actors...')).not.toBeInTheDocument()
    })

    it('closes dropdown when escape key is pressed', async () => {
      const user = userEvent.setup()
      
      renderWithProviders(
        <ActorSelector
          actors={mockActors}
          selectedActor=""
          onActorSelect={mockOnActorSelect}
        />
      )
      
      const button = screen.getByRole('button')
      await user.click(button)
      
      expect(screen.getByPlaceholderText('Search actors...')).toBeInTheDocument()
      
      await user.keyboard('{Escape}')
      
      expect(screen.queryByPlaceholderText('Search actors...')).not.toBeInTheDocument()
    })
  })

  describe('Search Functionality', () => {
    it('filters actors based on search query', async () => {
      const user = userEvent.setup()
      
      renderWithProviders(
        <ActorSelector
          actors={mockActors}
          selectedActor=""
          onActorSelect={mockOnActorSelect}
        />
      )
      
      const button = screen.getByRole('button')
      await user.click(button)
      
      const searchInput = screen.getByPlaceholderText('Search actors...')
      await user.type(searchInput, 'al')
      
      expect(screen.getByText('Alice')).toBeInTheDocument()
      expect(screen.queryByText('Bob')).not.toBeInTheDocument()
      expect(screen.queryByText('Charlie')).not.toBeInTheDocument()
    })

    it('shows no results message when search yields no matches', async () => {
      const user = userEvent.setup()
      
      renderWithProviders(
        <ActorSelector
          actors={mockActors}
          selectedActor=""
          onActorSelect={mockOnActorSelect}
        />
      )
      
      const button = screen.getByRole('button')
      await user.click(button)
      
      const searchInput = screen.getByPlaceholderText('Search actors...')
      await user.type(searchInput, 'xyz')
      
      expect(screen.getByText('No actors found matching "xyz"')).toBeInTheDocument()
    })

    it('is case insensitive', async () => {
      const user = userEvent.setup()
      
      renderWithProviders(
        <ActorSelector
          actors={mockActors}
          selectedActor=""
          onActorSelect={mockOnActorSelect}
        />
      )
      
      const button = screen.getByRole('button')
      await user.click(button)
      
      const searchInput = screen.getByPlaceholderText('Search actors...')
      await user.type(searchInput, 'ALICE')
      
      expect(screen.getByText('Alice')).toBeInTheDocument()
    })

    it('selects single match when Enter is pressed', async () => {
      const user = userEvent.setup()
      
      renderWithProviders(
        <ActorSelector
          actors={mockActors}
          selectedActor=""
          onActorSelect={mockOnActorSelect}
        />
      )
      
      const button = screen.getByRole('button')
      await user.click(button)
      
      const searchInput = screen.getByPlaceholderText('Search actors...')
      await user.type(searchInput, 'Alice')
      await user.keyboard('{Enter}')
      
      expect(mockOnActorSelect).toHaveBeenCalledWith('Alice')
    })

    it('does not select when multiple matches exist and Enter is pressed', async () => {
      const user = userEvent.setup()
      
      renderWithProviders(
        <ActorSelector
          actors={['Alice', 'Alex', 'Alexander']}
          selectedActor=""
          onActorSelect={mockOnActorSelect}
        />
      )
      
      const button = screen.getByRole('button')
      await user.click(button)
      
      const searchInput = screen.getByPlaceholderText('Search actors...')
      await user.type(searchInput, 'Al')
      await user.keyboard('{Enter}')
      
      expect(mockOnActorSelect).not.toHaveBeenCalled()
    })
  })

  describe('Actor Selection', () => {
    it('calls onActorSelect when actor is clicked', async () => {
      const user = userEvent.setup()
      
      renderWithProviders(
        <ActorSelector
          actors={mockActors}
          selectedActor=""
          onActorSelect={mockOnActorSelect}
        />
      )
      
      const button = screen.getByRole('button')
      await user.click(button)
      
      const aliceOption = screen.getByText('Alice')
      await user.click(aliceOption)
      
      expect(mockOnActorSelect).toHaveBeenCalledWith('Alice')
    })

    it('closes dropdown after selection', async () => {
      const user = userEvent.setup()
      
      renderWithProviders(
        <ActorSelector
          actors={mockActors}
          selectedActor=""
          onActorSelect={mockOnActorSelect}
        />
      )
      
      const button = screen.getByRole('button')
      await user.click(button)
      
      const aliceOption = screen.getByText('Alice')
      await user.click(aliceOption)
      
      expect(screen.queryByPlaceholderText('Search actors...')).not.toBeInTheDocument()
    })

    it('clears search query after selection', async () => {
      const user = userEvent.setup()
      
      renderWithProviders(
        <ActorSelector
          actors={mockActors}
          selectedActor=""
          onActorSelect={mockOnActorSelect}
        />
      )
      
      const button = screen.getByRole('button')
      await user.click(button)
      
      const searchInput = screen.getByPlaceholderText('Search actors...')
      await user.type(searchInput, 'Al')
      
      const aliceOption = screen.getByText('Alice')
      await user.click(aliceOption)
      
      // Reopen dropdown to check search is cleared
      await user.click(button)
      const newSearchInput = screen.getByPlaceholderText('Search actors...')
      expect(newSearchInput).toHaveValue('')
    })

    it('shows checkmark for selected actor', async () => {
      const user = userEvent.setup()
      
      renderWithProviders(
        <ActorSelector
          actors={mockActors}
          selectedActor="Alice"
          onActorSelect={mockOnActorSelect}
        />
      )
      
      const button = screen.getByRole('button', { name: /Alice/ })
      await user.click(button)
      
      const aliceOption = screen.getByRole('option', { name: 'Alice' })
      expect(aliceOption).toHaveAttribute('aria-selected', 'true')
      
      // Check for checkmark SVG
      const checkmark = aliceOption.querySelector('svg')
      expect(checkmark).toBeInTheDocument()
    })
  })

  describe('Clear Functionality', () => {
    it('clears selection when clear button is clicked', async () => {
      const user = userEvent.setup()
      
      renderWithProviders(
        <ActorSelector
          actors={mockActors}
          selectedActor="Alice"
          onActorSelect={mockOnActorSelect}
        />
      )
      
      const clearButton = screen.getByRole('button', { name: 'Clear selection' })
      await user.click(clearButton)
      
      expect(mockOnActorSelect).toHaveBeenCalledWith('')
    })

    it('does not open dropdown when clear button is clicked', async () => {
      const user = userEvent.setup()
      
      renderWithProviders(
        <ActorSelector
          actors={mockActors}
          selectedActor="Alice"
          onActorSelect={mockOnActorSelect}
        />
      )
      
      const clearButton = screen.getByRole('button', { name: 'Clear selection' })
      await user.click(clearButton)
      
      expect(screen.queryByPlaceholderText('Search actors...')).not.toBeInTheDocument()
    })
  })

  describe('Actor Count Display', () => {
    it('shows actor count in dropdown footer', async () => {
      const user = userEvent.setup()
      
      renderWithProviders(
        <ActorSelector
          actors={mockActors}
          selectedActor=""
          onActorSelect={mockOnActorSelect}
        />
      )
      
      const button = screen.getByRole('button')
      await user.click(button)
      
      expect(screen.getByText('5 of 5 actors')).toBeInTheDocument()
    })

    it('shows filtered count when searching', async () => {
      const user = userEvent.setup()
      
      renderWithProviders(
        <ActorSelector
          actors={mockActors}
          selectedActor=""
          onActorSelect={mockOnActorSelect}
        />
      )
      
      const button = screen.getByRole('button')
      await user.click(button)
      
      const searchInput = screen.getByPlaceholderText('Search actors...')
      await user.type(searchInput, 'a')
      
      expect(screen.getByText('3 of 5 actors matching "a"')).toBeInTheDocument()
    })
  })

  describe('Empty State', () => {
    it('shows no actors message when actors array is empty', async () => {
      const user = userEvent.setup()
      
      renderWithProviders(
        <ActorSelector
          actors={[]}
          selectedActor=""
          onActorSelect={mockOnActorSelect}
        />
      )
      
      const button = screen.getByRole('button')
      await user.click(button)
      
      expect(screen.getByText('No actors available')).toBeInTheDocument()
    })
  })

  describe('Accessibility', () => {
    it('has proper ARIA attributes', () => {
      renderWithProviders(
        <ActorSelector
          actors={mockActors}
          selectedActor=""
          onActorSelect={mockOnActorSelect}
        />
      )
      
      const button = screen.getByRole('button')
      expect(button).toHaveAttribute('aria-haspopup', 'listbox')
      expect(button).toHaveAttribute('aria-expanded', 'false')
    })

    it('updates aria-expanded when dropdown opens', async () => {
      const user = userEvent.setup()
      
      renderWithProviders(
        <ActorSelector
          actors={mockActors}
          selectedActor=""
          onActorSelect={mockOnActorSelect}
        />
      )
      
      const button = screen.getByRole('button')
      await user.click(button)
      
      expect(button).toHaveAttribute('aria-expanded', 'true')
    })

    it('has proper role attributes for options', async () => {
      const user = userEvent.setup()
      
      renderWithProviders(
        <ActorSelector
          actors={mockActors}
          selectedActor=""
          onActorSelect={mockOnActorSelect}
        />
      )
      
      const button = screen.getByRole('button')
      await user.click(button)
      
      const aliceOption = screen.getByRole('option', { name: 'Alice' })
      expect(aliceOption).toHaveAttribute('aria-selected', 'false')
    })

    it('supports keyboard navigation', async () => {
      const user = userEvent.setup()
      
      renderWithProviders(
        <ActorSelector
          actors={mockActors}
          selectedActor=""
          onActorSelect={mockOnActorSelect}
        />
      )
      
      const button = screen.getByRole('button')
      await user.tab()
      expect(button).toHaveFocus()
      
      await user.keyboard('{Enter}')
      expect(screen.getByPlaceholderText('Search actors...')).toBeInTheDocument()
    })
  })

  describe('Custom Styling', () => {
    it('applies custom className', () => {
      renderWithProviders(
        <ActorSelector
          actors={mockActors}
          selectedActor=""
          onActorSelect={mockOnActorSelect}
          className="custom-class"
        />
      )
      
      const container = screen.getByText('Select Actor').closest('div')
      expect(container).toHaveClass('custom-class')
    })
  })
})