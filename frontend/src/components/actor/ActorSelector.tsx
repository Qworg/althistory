import React, { useState, useCallback, useMemo } from 'react'
import { ChevronDownIcon, MagnifyingGlassIcon, XMarkIcon } from '@heroicons/react/24/outline'

export interface ActorSelectorProps {
  actors: string[]
  selectedActor: string
  onActorSelect: (actor: string) => void
  className?: string
  placeholder?: string
}

export function ActorSelector({
  actors,
  selectedActor,
  onActorSelect,
  className = '',
  placeholder = 'Search and select an actor...'
}: ActorSelectorProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')

  // Filter actors based on search query
  const filteredActors = useMemo(() => {
    if (!searchQuery.trim()) return actors
    
    const query = searchQuery.toLowerCase()
    return actors.filter(actor => 
      actor.toLowerCase().includes(query)
    )
  }, [actors, searchQuery])

  const handleActorSelect = useCallback((actor: string) => {
    onActorSelect(actor)
    setIsOpen(false)
    setSearchQuery('')
  }, [onActorSelect])

  const handleClearSelection = useCallback((e: React.MouseEvent | React.KeyboardEvent) => {
    e.stopPropagation()
    onActorSelect('')
    setSearchQuery('')
  }, [onActorSelect])

  const handleToggleDropdown = useCallback(() => {
    setIsOpen(!isOpen)
    if (!isOpen) {
      setSearchQuery('')
    }
  }, [isOpen])

  const handleSearchChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchQuery(e.target.value)
  }, [])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      setIsOpen(false)
      setSearchQuery('')
    } else if (e.key === 'Enter' && filteredActors.length === 1 && filteredActors[0]) {
      handleActorSelect(filteredActors[0])
    }
  }, [filteredActors, handleActorSelect])

  return (
    <div className={`relative ${className}`}>
      <label className="block text-sm font-medium text-gray-700 mb-2">
        Select Actor
      </label>
      
      {/* Main selector button */}
      <div className="relative">
        <button
          type="button"
          onClick={handleToggleDropdown}
          className={`relative w-full bg-white border border-gray-300 rounded-md shadow-sm pl-3 pr-10 py-2 text-left cursor-pointer focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 sm:text-sm ${
            isOpen ? 'ring-1 ring-blue-500 border-blue-500' : ''
          }`}
          aria-haspopup="listbox"
          aria-expanded={isOpen}
          aria-labelledby="actor-selector-label"
        >
          <span className="block truncate">
            {selectedActor || placeholder}
          </span>
          
          {/* Clear button */}
          {selectedActor && (
            <span
              onClick={handleClearSelection}
              className="absolute inset-y-0 right-8 flex items-center pr-2 hover:text-gray-700 cursor-pointer"
              aria-label="Clear selection"
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  handleClearSelection(e)
                }
              }}
            >
              <XMarkIcon className="h-4 w-4 text-gray-400" />
            </span>
          )}
          
          {/* Dropdown arrow */}
          <span className="absolute inset-y-0 right-0 flex items-center pr-2 pointer-events-none">
            <ChevronDownIcon 
              className={`h-5 w-5 text-gray-400 transition-transform duration-200 ${
                isOpen ? 'transform rotate-180' : ''
              }`} 
            />
          </span>
        </button>

        {/* Dropdown menu */}
        {isOpen && (
          <div className="absolute z-10 mt-1 w-full bg-white shadow-lg max-h-60 rounded-md py-1 text-base ring-1 ring-black ring-opacity-5 overflow-auto focus:outline-none sm:text-sm">
            {/* Search input */}
            <div className="sticky top-0 bg-white px-3 py-2 border-b border-gray-200">
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <MagnifyingGlassIcon className="h-4 w-4 text-gray-400" />
                </div>
                <input
                  type="text"
                  value={searchQuery}
                  onChange={handleSearchChange}
                  onKeyDown={handleKeyDown}
                  className="block w-full pl-10 pr-3 py-2 border border-gray-300 rounded-md leading-5 bg-white placeholder-gray-500 focus:outline-none focus:placeholder-gray-400 focus:ring-1 focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                  placeholder="Search actors..."
                  autoFocus
                />
              </div>
            </div>

            {/* Actor list */}
            <div className="max-h-48 overflow-y-auto">
              {filteredActors.length > 0 ? (
                filteredActors.map((actor) => (
                  <button
                    key={actor}
                    type="button"
                    onClick={() => handleActorSelect(actor)}
                    className={`w-full text-left px-3 py-2 hover:bg-gray-100 focus:bg-gray-100 focus:outline-none ${
                      actor === selectedActor ? 'bg-blue-50 text-blue-900' : 'text-gray-900'
                    }`}
                    role="option"
                    aria-selected={actor === selectedActor}
                  >
                    <span className="block truncate">{actor}</span>
                    {actor === selectedActor && (
                      <span className="absolute inset-y-0 right-0 flex items-center pr-4 text-blue-600">
                        <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                        </svg>
                      </span>
                    )}
                  </button>
                ))
              ) : (
                <div className="px-3 py-2 text-gray-500 text-sm">
                  {searchQuery ? `No actors found matching "${searchQuery}"` : 'No actors available'}
                </div>
              )}
            </div>

            {/* Actor count */}
            {filteredActors.length > 0 && (
              <div className="sticky bottom-0 bg-gray-50 px-3 py-2 text-xs text-gray-500 border-t border-gray-200">
                {filteredActors.length} of {actors.length} actors
                {searchQuery && ` matching "${searchQuery}"`}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Click outside to close */}
      {isOpen && (
        <div
          className="fixed inset-0 z-0"
          onClick={() => setIsOpen(false)}
          aria-hidden="true"
        />
      )}
    </div>
  )
}