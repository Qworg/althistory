import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { Event, Arc, CausalRelationship } from '@/types'

// Mock axios.create to return a mock instance
const mockAxiosInstance = {
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  delete: vi.fn(),
  interceptors: {
    request: { use: vi.fn() },
    response: { use: vi.fn() }
  }
}

// Mock axios
vi.mock('axios', () => ({
  default: {
    create: vi.fn(() => mockAxiosInstance)
  }
}))

// Import after mocking
const { apiClient, APIError } = await import('@/services/api')

describe('APIClient', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('Event Operations', () => {
    const mockEvent: Event = {
      id: '1',
      description: 'Test event',
      actor: 'Test actor',
      target: 'Test target',
      timestamp: '2024-01-01T00:00:00Z',
      created_at: '2024-01-01T00:00:00Z',
      updated_at: '2024-01-01T00:00:00Z',
    }

    it('should fetch all events', async () => {
      const mockEvents = [mockEvent]
      mockAxiosInstance.get.mockResolvedValue({ data: mockEvents })

      const result = await apiClient.events.getAll()

      expect(mockAxiosInstance.get).toHaveBeenCalledWith('/events', { params: undefined })
      expect(result).toEqual(mockEvents)
    })

    it('should fetch all events with filters', async () => {
      const mockEvents = [mockEvent]
      const filters = { actor: 'Test actor' }
      mockAxiosInstance.get.mockResolvedValue({ data: mockEvents })

      const result = await apiClient.events.getAll(filters)

      expect(mockAxiosInstance.get).toHaveBeenCalledWith('/events', { params: filters })
      expect(result).toEqual(mockEvents)
    })

    it('should fetch event by id', async () => {
      mockAxiosInstance.get.mockResolvedValue({ data: mockEvent })

      const result = await apiClient.events.getById('1')

      expect(mockAxiosInstance.get).toHaveBeenCalledWith('/events/1')
      expect(result).toEqual(mockEvent)
    })

    it('should create an event', async () => {
      const createData = {
        description: 'Test event',
        actor: 'Test actor',
        target: 'Test target',
        timestamp: '2024-01-01T00:00:00Z',
      }
      mockAxiosInstance.post.mockResolvedValue({ data: mockEvent })

      const result = await apiClient.events.create(createData)

      expect(mockAxiosInstance.post).toHaveBeenCalledWith('/events', createData)
      expect(result).toEqual(mockEvent)
    })

    it('should update an event', async () => {
      const updateData = { description: 'Updated event' }
      const updatedEvent = { ...mockEvent, ...updateData }
      mockAxiosInstance.put.mockResolvedValue({ data: updatedEvent })

      const result = await apiClient.events.update('1', updateData)

      expect(mockAxiosInstance.put).toHaveBeenCalledWith('/events/1', updateData)
      expect(result).toEqual(updatedEvent)
    })

    it('should delete an event', async () => {
      mockAxiosInstance.delete.mockResolvedValue({})

      await apiClient.events.delete('1')

      expect(mockAxiosInstance.delete).toHaveBeenCalledWith('/events/1')
    })

    it('should search events', async () => {
      const mockEvents = [mockEvent]
      const query = 'test query'
      const filters = { actor: 'Test actor' }
      mockAxiosInstance.get.mockResolvedValue({ data: mockEvents })

      const result = await apiClient.events.search(query, filters)

      expect(mockAxiosInstance.get).toHaveBeenCalledWith('/events/search', {
        params: { q: query, ...filters }
      })
      expect(result).toEqual(mockEvents)
    })

    it('should handle API errors', async () => {
      const errorResponse = {
        response: {
          status: 404,
          data: { message: 'Event not found', code: 'NOT_FOUND' }
        }
      }
      mockAxiosInstance.get.mockRejectedValue(errorResponse)

      await expect(apiClient.events.getById('nonexistent')).rejects.toThrow(APIError)
      
      try {
        await apiClient.events.getById('nonexistent')
      } catch (error) {
        expect(error).toBeInstanceOf(APIError)
        expect((error as InstanceType<typeof APIError>).status).toBe(404)
        expect((error as InstanceType<typeof APIError>).code).toBe('NOT_FOUND')
        expect((error as InstanceType<typeof APIError>).message).toBe('Event not found')
      }
    })

    it('should handle network errors', async () => {
      const networkError = { request: {} }
      mockAxiosInstance.get.mockRejectedValue(networkError)

      await expect(apiClient.events.getAll()).rejects.toThrow(APIError)
      
      try {
        await apiClient.events.getAll()
      } catch (error) {
        expect(error).toBeInstanceOf(APIError)
        expect((error as InstanceType<typeof APIError>).status).toBe(0)
        expect((error as InstanceType<typeof APIError>).code).toBe('NETWORK_ERROR')
      }
    })
  })

  describe('Arc Operations', () => {
    const mockArc: Arc = {
      id: '1',
      name: 'Test arc',
      description: 'Test arc description',
      start_time: '2024-01-01T00:00:00Z',
      end_time: '2024-01-02T00:00:00Z',
      parent_arc_id: null,
      created_at: '2024-01-01T00:00:00Z',
      updated_at: '2024-01-01T00:00:00Z',
    }

    it('should fetch all arcs', async () => {
      const mockArcs = [mockArc]
      mockAxiosInstance.get.mockResolvedValue({ data: mockArcs })

      const result = await apiClient.arcs.getAll()

      expect(mockAxiosInstance.get).toHaveBeenCalledWith('/arcs', { params: undefined })
      expect(result).toEqual(mockArcs)
    })

    it('should fetch arc by id', async () => {
      mockAxiosInstance.get.mockResolvedValue({ data: mockArc })

      const result = await apiClient.arcs.getById('1')

      expect(mockAxiosInstance.get).toHaveBeenCalledWith('/arcs/1')
      expect(result).toEqual(mockArc)
    })

    it('should create an arc', async () => {
      const createData = {
        name: 'Test arc',
        description: 'Test arc description',
        start_time: '2024-01-01T00:00:00Z',
        end_time: '2024-01-02T00:00:00Z',
      }
      mockAxiosInstance.post.mockResolvedValue({ data: mockArc })

      const result = await apiClient.arcs.create(createData)

      expect(mockAxiosInstance.post).toHaveBeenCalledWith('/arcs', createData)
      expect(result).toEqual(mockArc)
    })

    it('should fetch arc hierarchy', async () => {
      const mockHierarchy = [mockArc]
      mockAxiosInstance.get.mockResolvedValue({ data: mockHierarchy })

      const result = await apiClient.arcs.getHierarchy()

      expect(mockAxiosInstance.get).toHaveBeenCalledWith('/arcs/hierarchy')
      expect(result).toEqual(mockHierarchy)
    })
  })

  describe('Causal Operations', () => {
    const mockRelationship: CausalRelationship = {
      id: '1',
      cause_event_id: 'event1',
      effect_event_id: 'event2',
      weight: 0.8,
      evidence: 'Test evidence',
      confidence: 0.9,
      relationship_type: 'direct',
      created_at: '2024-01-01T00:00:00Z',
      updated_at: '2024-01-01T00:00:00Z',
    }

    it('should fetch causal relationships', async () => {
      const mockRelationships = [mockRelationship]
      mockAxiosInstance.get.mockResolvedValue({ data: mockRelationships })

      const result = await apiClient.causal.getRelationships()

      expect(mockAxiosInstance.get).toHaveBeenCalledWith('/causal-relationships', {
        params: undefined
      })
      expect(result).toEqual(mockRelationships)
    })

    it('should fetch causal relationships for specific event', async () => {
      const mockRelationships = [mockRelationship]
      mockAxiosInstance.get.mockResolvedValue({ data: mockRelationships })

      const result = await apiClient.causal.getRelationships('event1')

      expect(mockAxiosInstance.get).toHaveBeenCalledWith('/causal-relationships', {
        params: { event_id: 'event1' }
      })
      expect(result).toEqual(mockRelationships)
    })

    it('should create causal link', async () => {
      const relationshipData = {
        weight: 0.8,
        evidence: 'Test evidence',
        confidence: 0.9,
        relationship_type: 'direct' as const,
      }
      mockAxiosInstance.post.mockResolvedValue({ data: mockRelationship })

      const result = await apiClient.causal.createLink('event1', 'event2', relationshipData)

      expect(mockAxiosInstance.post).toHaveBeenCalledWith('/causal-relationships', {
        cause_event_id: 'event1',
        effect_event_id: 'event2',
        ...relationshipData
      })
      expect(result).toEqual(mockRelationship)
    })

    it('should find causal chain', async () => {
      const mockChain = [{
        events: [],
        relationships: [mockRelationship],
        totalWeight: 0.8,
        confidence: 0.9
      }]
      mockAxiosInstance.get.mockResolvedValue({ data: mockChain })

      const result = await apiClient.causal.findChain('event1', 3)

      expect(mockAxiosInstance.get).toHaveBeenCalledWith('/causal-relationships/chain', {
        params: { start_event_id: 'event1', max_depth: 3 }
      })
      expect(result).toEqual(mockChain)
    })

    it('should get causal suggestions', async () => {
      const mockSuggestions = [{
        id: '1',
        cause_event_id: 'event1',
        effect_event_id: 'event2',
        suggested_weight: 0.7,
        confidence: 0.8,
        reasoning: 'Test reasoning'
      }]
      mockAxiosInstance.get.mockResolvedValue({ data: mockSuggestions })

      const result = await apiClient.causal.getSuggestions('event1')

      expect(mockAxiosInstance.get).toHaveBeenCalledWith('/causal-relationships/suggestions', {
        params: { event_id: 'event1' }
      })
      expect(result).toEqual(mockSuggestions)
    })
  })

  describe('Graph Operations', () => {
    const mockCopyResult = {
      id: 'copy1',
      name: 'Test Copy',
      status: 'completed' as const,
      progress: 100,
      created_at: '2024-01-01T00:00:00Z'
    }

    it('should copy full graph', async () => {
      mockAxiosInstance.post.mockResolvedValue({ data: mockCopyResult })

      const result = await apiClient.graph.copyFull('Test Copy')

      expect(mockAxiosInstance.post).toHaveBeenCalledWith('/graph/copy', {
        target_name: 'Test Copy',
        copy_type: 'full'
      })
      expect(result).toEqual(mockCopyResult)
    })

    it('should copy graph by time range', async () => {
      const timeRange = {
        start: new Date('2024-01-01'),
        end: new Date('2024-01-02')
      }
      mockAxiosInstance.post.mockResolvedValue({ data: mockCopyResult })

      const result = await apiClient.graph.copyByTimeRange(timeRange, 'Test Copy')

      expect(mockAxiosInstance.post).toHaveBeenCalledWith('/graph/copy', {
        target_name: 'Test Copy',
        copy_type: 'time_range',
        start_time: timeRange.start.toISOString(),
        end_time: timeRange.end.toISOString()
      })
      expect(result).toEqual(mockCopyResult)
    })

    it('should get copy status', async () => {
      mockAxiosInstance.get.mockResolvedValue({ data: mockCopyResult })

      const result = await apiClient.graph.getCopyStatus('copy1')

      expect(mockAxiosInstance.get).toHaveBeenCalledWith('/graph/copy/copy1')
      expect(result).toEqual(mockCopyResult)
    })
  })
})