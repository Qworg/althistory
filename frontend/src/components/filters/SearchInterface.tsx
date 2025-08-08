import { useState, useEffect, useRef } from 'react'
import { useDebounce } from '@/hooks/useDebounce'

export interface SearchSuggestion {
  id: string
  text: string
  type: 'event' | 'arc' | 'actor' | 'target'
  description?: string
}

interface SearchInterfaceProps {
  value: string
  onChange: (value: string) => void
  onSuggestionSelect?: (suggestion: SearchSuggestion) => void
  suggestions?: SearchSuggestion[]
  placeholder?: string
  className?: string
  showSuggestions?: boolean
  isLoading?: boolean
}

export function SearchInterface({
  value,
  onChange,
  onSuggestionSelect,
  suggestions = [],
  placeholder = 'Search...',
  className = '',
  showSuggestions = true,
  isLoading = false
}: SearchInterfaceProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [highlightedIndex, setHighlightedIndex] = useState(-1)
  const [filteredSuggestions, setFilteredSuggestions] = useState<SearchSuggestion[]>([])
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const debouncedValue = useDebounce(value, 300)

  // Filter suggestions based on search value
  useEffect(() => {
    if (!debouncedValue.trim()) {
      setFilteredSuggestions([])
      return
    }

    const filtered = suggestions.filter(suggestion =>
      suggestion.text.toLowerCase().includes(debouncedValue.toLowerCase()) ||
      suggestion.description?.toLowerCase().includes(debouncedValue.toLowerCase())
    )
    
    setFilteredSuggestions(filtered.slice(0, 10)) // Limit to 10 suggestions
  }, [debouncedValue, suggestions])

  // Reset highlighted index when suggestions change
  useEffect(() => {
    setHighlightedIndex(-1)
  }, [filteredSuggestions])

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value
    onChange(newValue)
    setIsOpen(true)
  }

  const handleInputFocus = () => {
    if (filteredSuggestions.length > 0 || (debouncedValue && filteredSuggestions.length === 0)) {
      setIsOpen(true)
    }
  }

  const handleInputBlur = () => {
    // Delay closing to allow for suggestion clicks
    setTimeout(() => setIsOpen(false), 150)
  }

  const handleSuggestionClick = (suggestion: SearchSuggestion) => {
    onChange(suggestion.text)
    setIsOpen(false)
    onSuggestionSelect?.(suggestion)
    inputRef.current?.focus()
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!isOpen || filteredSuggestions.length === 0) return

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        setHighlightedIndex(prev => 
          prev < filteredSuggestions.length - 1 ? prev + 1 : 0
        )
        break
      case 'ArrowUp':
        e.preventDefault()
        setHighlightedIndex(prev => 
          prev > 0 ? prev - 1 : filteredSuggestions.length - 1
        )
        break
      case 'Enter':
        e.preventDefault()
        if (highlightedIndex >= 0 && filteredSuggestions[highlightedIndex]) {
          handleSuggestionClick(filteredSuggestions[highlightedIndex])
        }
        break
      case 'Escape':
        setIsOpen(false)
        setHighlightedIndex(-1)
        break
    }
  }

  const clearSearch = () => {
    onChange('')
    setIsOpen(false)
    inputRef.current?.focus()
  }

  const getTypeIcon = (type: SearchSuggestion['type']) => {
    switch (type) {
      case 'event':
        return '📅'
      case 'arc':
        return '📊'
      case 'actor':
        return '👤'
      case 'target':
        return '🎯'
      default:
        return '🔍'
    }
  }

  const getTypeLabel = (type: SearchSuggestion['type']) => {
    switch (type) {
      case 'event':
        return 'Event'
      case 'arc':
        return 'Arc'
      case 'actor':
        return 'Actor'
      case 'target':
        return 'Target'
      default:
        return 'Item'
    }
  }

  const highlightMatch = (text: string, query: string) => {
    if (!query.trim()) return text

    const regex = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi')
    const parts = text.split(regex)

    return parts.map((part, index) => 
      regex.test(part) ? (
        <mark key={index} className="bg-yellow-200 text-yellow-900 px-0.5 rounded">
          {part}
        </mark>
      ) : (
        part
      )
    )
  }

  return (
    <div className={`relative ${className}`}>
      <div className="relative">
        <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
          <svg
            className="h-5 w-5 text-gray-400"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
            />
          </svg>
        </div>
        
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={handleInputChange}
          onFocus={handleInputFocus}
          onBlur={handleInputBlur}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          className="w-full pl-10 pr-10 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          aria-label="Search"
          aria-expanded={isOpen}
          aria-haspopup="listbox"
          aria-autocomplete="list"
          role="combobox"
        />
        
        {value && (
          <button
            onClick={clearSearch}
            className="absolute inset-y-0 right-0 pr-3 flex items-center"
            aria-label="Clear search"
          >
            <svg
              className="h-5 w-5 text-gray-400 hover:text-gray-600"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        )}
        
        {isLoading && (
          <div className="absolute inset-y-0 right-0 pr-3 flex items-center">
            <svg
              className="animate-spin h-5 w-5 text-gray-400"
              fill="none"
              viewBox="0 0 24 24"
            >
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
              />
            </svg>
          </div>
        )}
      </div>

      {/* Suggestions dropdown */}
      {isOpen && showSuggestions && filteredSuggestions.length > 0 && (
        <div className="absolute z-50 w-full mt-1 bg-white border border-gray-300 rounded-md shadow-lg max-h-60 overflow-auto">
          <ul
            ref={listRef}
            role="listbox"
            aria-label="Search suggestions"
            className="py-1"
          >
            {filteredSuggestions.map((suggestion, index) => (
              <li
                key={suggestion.id}
                role="option"
                aria-selected={index === highlightedIndex}
                className={`px-4 py-2 cursor-pointer flex items-start space-x-3 ${
                  index === highlightedIndex
                    ? 'bg-blue-100 text-blue-900'
                    : 'text-gray-900 hover:bg-gray-50'
                }`}
                onClick={() => handleSuggestionClick(suggestion)}
              >
                <span className="text-lg flex-shrink-0 mt-0.5" aria-hidden="true">
                  {getTypeIcon(suggestion.type)}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium">
                    {highlightMatch(suggestion.text, debouncedValue)}
                  </div>
                  {suggestion.description && (
                    <div className="text-xs text-gray-500 mt-0.5 truncate">
                      {highlightMatch(suggestion.description, debouncedValue)}
                    </div>
                  )}
                </div>
                <span className="text-xs text-gray-400 flex-shrink-0">
                  {getTypeLabel(suggestion.type)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* No results message */}
      {isOpen && showSuggestions && debouncedValue && filteredSuggestions.length === 0 && !isLoading && (
        <div className="absolute z-50 w-full mt-1 bg-white border border-gray-300 rounded-md shadow-lg">
          <div className="px-4 py-3 text-sm text-gray-500 text-center">
            No results found for "{debouncedValue}"
          </div>
        </div>
      )}
    </div>
  )
}