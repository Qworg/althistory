import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import React from 'react'
import { useEvents, useCreateEvent, useUpdateEvent, useDeleteEvent } from '@/hooks/useAPI'
import { apiClient } from '@/services/api'
import { useGlobalStore } from '@/stores/globalStore'
import { Event } from '@/types'

// Mock the API client
vi.mock('@/services/api', () => ({
  apiClient: {
    events: {
      getAll: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    }
  },
  APIError: class APIError extends Error {
    constructor(message: string, public status: number) {
      super(message)
    }
  }
}))

// Mock the global store
vi.mock('@/stores/globalStore', () => ({
  useGlobalStore: vi.fn()
}))

const mockAddEvent = vi.fn()
const mockUpdateEvent = vi.fn()
const mockDeleteEvent = vi.fn()
const mockAddError = vi.fn()

// Setup mock store
const mockStore = {
  addEvent: mockAddEvent,
  updateEvent: mockUpdateEvent,
  deleteEvent: mockDeleteEvent,
  addError: mockAddError,
}

describe('useAPI hooks', () => {
  let queryClient: QueryClient

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    })
    
    vi.mocked(useGlobalStore).mockImplementation((selector: any) => {
      return selector(mockStore)
    })
    
    vi.clearAllMocks()
  })

  afterEach(() => {
    queryClient.clear()
  })

  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      {children}
    </QueryClientProvider>
  )

  describe('useEvents', () => {
    it('should fetch events successfully', async () => {
      const mockEvents: Event[] = [
        {
          id: '1',
          description: 'Test event',
          actor: 'Test actor',
          target: 'Test target',
          timestamp: '2024-01-01T00:00:00Z',
          created_at: '2024-01-01T00:00:00Z',
          updated_at: '2024-01-01T00:00:00Z',
        }
      ]

      vi.mocked(apiClient.events.getAll).mockResolvedValue(mockEvents)

      const { result } = renderHook(() => useEvents(), { wrapper })

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true)
      })

      expect(result.current.data).toEqual(mockEvents)
      expect(apiClient.events.getAll).toHaveBeenCalledWith(undefined)
    })

    it('should fetch events with filters', async () => {
      const mockEvents: Event[] = []
      const filters = { actor: 'Test actor' }

      vi.mocked(apiClient.events.getAll).mockResolvedValue(mockEvents)

      const { result } = renderHook(() => useEvents(filters), { wrapper })

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true)
      })

      expect(apiClient.events.getAll).toHaveBeenCalledWith(filters)
    })

    it('should handle fetch errors', async () => {
      const error = new Error('Network error')
      vi.mocked(apiClient.events.getAll).mockRejectedValue(error)

      const { result } = renderHook(() => useEvents(), { wrapper })

      await waitFor(() => {
        expect(result.current.isError).toBe(true)
      })

      expect(result.current.error).toEqual(error)
    })
  })

  describe('useCreateEvent', () => {
    it('should create event successfully', async () => {
      const newEvent: Event = {
        id: '1',
        description: 'New event',
        actor: 'Test actor',
        target: 'Test target',
        timestamp: '2024-01-01T00:00:00Z',
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
      }

      const createData = {
        description: 'New event',
        actor: 'Test actor',
        target: 'Test target',
        timestamp: '2024-01-01T00:00:00Z',
      }

      vi.mocked(apiClient.events.create).mockResolvedValue(newEvent)

      const { result } = renderHook(() => useCreateEvent(), { wrapper })

      result.current.mutate(createData)

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true)
      })

      expect(apiClient.events.create).toHaveBeenCalledWith(createData)
      expect(mockAddEvent).toHaveBeenCalledWith(newEvent)
    })

    it('should handle create errors', async () => {
      const error = new Error('Validation error')
      vi.mocked(apiClient.events.create).mockRejectedValue(error)

      const createData = {
        description: 'New event',
        actor: 'Test actor',
        target: 'Test target',
        timestamp: '2024-01-01T00:00:00Z',
      }

      const { result } = renderHook(() => useCreateEvent(), { wrapper })

      result.current.mutate(createData)

      await waitFor(() => {
        expect(result.current.isError).toBe(true)
      })

      expect(result.current.error).toEqual(error)
    })
  })

  describe('useUpdateEvent', () => {
    it('should update event successfully', async () => {
      const updatedEvent: Event = {
        id: '1',
        description: 'Updated event',
        actor: 'Test actor',
        target: 'Test target',
        timestamp: '2024-01-01T00:00:00Z',
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
      }

      const updateData = { description: 'Updated event' }

      vi.mocked(apiClient.events.update).mockResolvedValue(updatedEvent)

      const { result } = renderHook(() => useUpdateEvent(), { wrapper })

      result.current.mutate({ id: '1', data: updateData })

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true)
      })

      expect(apiClient.events.update).toHaveBeenCalledWith('1', updateData)
      expect(mockUpdateEvent).toHaveBeenCalledWith('1', updatedEvent)
    })
  })

  describe('useDeleteEvent', () => {
    it('should delete event successfully', async () => {
      vi.mocked(apiClient.events.delete).mockResolvedValue(undefined)

      const { result } = renderHook(() => useDeleteEvent(), { wrapper })

      result.current.mutate('1')

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true)
      })

      expect(apiClient.events.delete).toHaveBeenCalledWith('1')
      expect(mockDeleteEvent).toHaveBeenCalledWith('1')
    })

    it('should handle delete errors', async () => {
      const error = new Error('Delete failed')
      vi.mocked(apiClient.events.delete).mockRejectedValue(error)

      const { result } = renderHook(() => useDeleteEvent(), { wrapper })

      result.current.mutate('1')

      await waitFor(() => {
        expect(result.current.isError).toBe(true)
      })

      expect(result.current.error).toEqual(error)
    })
  })
})