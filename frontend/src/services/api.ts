import axios from 'axios'
import type { AxiosInstance, AxiosResponse, AxiosError } from 'axios'
import { 
  Event, 
  Arc, 
  CausalRelationship, 
  InferredPressure,
  CreateEventRequest,
  UpdateEventRequest,
  CreateArcRequest,
  UpdateArcRequest,
  CausalRelationshipData,
  EventFilters,
  ArcFilters,
  CausalPath,
  CausalSuggestion,
  EventCluster,
  Pattern,
  CopyResult,
  EntityFilter,
  TimeRange
} from '@/types'

// API client configuration
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000/api'

// Custom error class for API errors
export class APIError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string,
    public details?: any
  ) {
    super(message)
    this.name = 'APIError'
  }
}

// Error handler utility
function handleAPIError(error: AxiosError): never {
  if (error.response) {
    // Server responded with error status
    const { status, data } = error.response
    const message = (data as any)?.message || error.message
    const code = (data as any)?.code
    const details = (data as any)?.details
    throw new APIError(message, status, code, details)
  } else if (error.request) {
    // Network error
    throw new APIError('Network error - please check your connection', 0, 'NETWORK_ERROR')
  } else {
    // Other error
    throw new APIError(error.message, 0, 'UNKNOWN_ERROR')
  }
}

class APIClient {
    private client: AxiosInstance

    constructor() {
        this.client = axios.create({
            baseURL: API_BASE_URL,
            timeout: 10000,
            headers: {
                'Content-Type': 'application/json',
            },
        })

        // Request interceptor
        this.client.interceptors.request.use(
            (config) => {
                // Add auth token if available
                const token = localStorage.getItem('auth_token')
                if (token) {
                    config.headers.Authorization = `Bearer ${token}`
                }
                return config
            },
            (error) => Promise.reject(error)
        )

        // Response interceptor
        this.client.interceptors.response.use(
            (response) => response,
            (error: AxiosError) => {
                // Handle common errors
                if (error.response?.status === 401) {
                    // Handle unauthorized
                    localStorage.removeItem('auth_token')
                    // Don't redirect in test environment
                    if (typeof window !== 'undefined' && !window.location.href.includes('test')) {
                        window.location.href = '/login'
                    }
                }
                
                // Log error for debugging
                console.error('API Error:', {
                    url: error.config?.url,
                    method: error.config?.method,
                    status: error.response?.status,
                    message: error.message,
                    data: error.response?.data
                })
                
                return Promise.reject(error)
            }
        )
    }

    // Event operations
    events = {
        getAll: async (filters?: EventFilters): Promise<Event[]> => {
            try {
                const response: AxiosResponse<Event[]> = await this.client.get('/events', { params: filters })
                return response.data
            } catch (error) {
                handleAPIError(error as AxiosError)
            }
        },

        getById: async (id: string): Promise<Event> => {
            try {
                const response: AxiosResponse<Event> = await this.client.get(`/events/${id}`)
                return response.data
            } catch (error) {
                handleAPIError(error as AxiosError)
            }
        },

        create: async (data: CreateEventRequest): Promise<Event> => {
            try {
                const response: AxiosResponse<Event> = await this.client.post('/events', data)
                return response.data
            } catch (error) {
                handleAPIError(error as AxiosError)
            }
        },

        update: async (id: string, data: UpdateEventRequest): Promise<Event> => {
            try {
                const response: AxiosResponse<Event> = await this.client.put(`/events/${id}`, data)
                return response.data
            } catch (error) {
                handleAPIError(error as AxiosError)
            }
        },

        delete: async (id: string): Promise<void> => {
            try {
                await this.client.delete(`/events/${id}`)
            } catch (error) {
                handleAPIError(error as AxiosError)
            }
        },

        search: async (query: string, filters?: EventFilters): Promise<Event[]> => {
            try {
                const response: AxiosResponse<Event[]> = await this.client.get('/events/search', {
                    params: { q: query, ...filters }
                })
                return response.data
            } catch (error) {
                handleAPIError(error as AxiosError)
            }
        },
    }

    // Arc operations
    arcs = {
        getAll: async (filters?: ArcFilters): Promise<Arc[]> => {
            try {
                const response: AxiosResponse<Arc[]> = await this.client.get('/arcs', { params: filters })
                return response.data
            } catch (error) {
                handleAPIError(error as AxiosError)
            }
        },

        getById: async (id: string): Promise<Arc> => {
            try {
                const response: AxiosResponse<Arc> = await this.client.get(`/arcs/${id}`)
                return response.data
            } catch (error) {
                handleAPIError(error as AxiosError)
            }
        },

        create: async (data: CreateArcRequest): Promise<Arc> => {
            try {
                const response: AxiosResponse<Arc> = await this.client.post('/arcs', data)
                return response.data
            } catch (error) {
                handleAPIError(error as AxiosError)
            }
        },

        update: async (id: string, data: UpdateArcRequest): Promise<Arc> => {
            try {
                const response: AxiosResponse<Arc> = await this.client.put(`/arcs/${id}`, data)
                return response.data
            } catch (error) {
                handleAPIError(error as AxiosError)
            }
        },

        delete: async (id: string): Promise<void> => {
            try {
                await this.client.delete(`/arcs/${id}`)
            } catch (error) {
                handleAPIError(error as AxiosError)
            }
        },

        getHierarchy: async (): Promise<Arc[]> => {
            try {
                const response: AxiosResponse<Arc[]> = await this.client.get('/arcs/hierarchy')
                return response.data
            } catch (error) {
                handleAPIError(error as AxiosError)
            }
        },
    }

    // Causal operations
    causal = {
        getRelationships: async (eventId?: string): Promise<CausalRelationship[]> => {
            try {
                const response: AxiosResponse<CausalRelationship[]> = await this.client.get('/causal-relationships', {
                    params: eventId ? { event_id: eventId } : undefined
                })
                return response.data
            } catch (error) {
                handleAPIError(error as AxiosError)
            }
        },

        createLink: async (causeId: string, effectId: string, relationship: CausalRelationshipData): Promise<CausalRelationship> => {
            try {
                const data = {
                    cause_event_id: causeId,
                    effect_event_id: effectId,
                    ...relationship
                }
                const response: AxiosResponse<CausalRelationship> = await this.client.post('/causal-relationships', data)
                return response.data
            } catch (error) {
                handleAPIError(error as AxiosError)
            }
        },

        updateLink: async (id: string, data: Partial<CausalRelationship>): Promise<CausalRelationship> => {
            try {
                const response: AxiosResponse<CausalRelationship> = await this.client.put(`/causal-relationships/${id}`, data)
                return response.data
            } catch (error) {
                handleAPIError(error as AxiosError)
            }
        },

        deleteLink: async (id: string): Promise<void> => {
            try {
                await this.client.delete(`/causal-relationships/${id}`)
            } catch (error) {
                handleAPIError(error as AxiosError)
            }
        },

        findChain: async (startEventId: string, maxDepth: number = 3): Promise<CausalPath[]> => {
            try {
                const response: AxiosResponse<CausalPath[]> = await this.client.get('/causal-relationships/chain', {
                    params: { start_event_id: startEventId, max_depth: maxDepth }
                })
                return response.data
            } catch (error) {
                handleAPIError(error as AxiosError)
            }
        },

        getSuggestions: async (eventId: string): Promise<CausalSuggestion[]> => {
            try {
                const response: AxiosResponse<CausalSuggestion[]> = await this.client.get('/causal-relationships/suggestions', {
                    params: { event_id: eventId }
                })
                return response.data
            } catch (error) {
                handleAPIError(error as AxiosError)
            }
        },
    }

    // Inference operations
    inference = {
        getPressures: async (arcId?: string): Promise<InferredPressure[]> => {
            try {
                const response: AxiosResponse<InferredPressure[]> = await this.client.get('/inferred-pressures', {
                    params: arcId ? { arc_id: arcId } : undefined
                })
                return response.data
            } catch (error) {
                handleAPIError(error as AxiosError)
            }
        },

        analyzeClusters: async (events: Event[]): Promise<EventCluster[]> => {
            try {
                const response: AxiosResponse<EventCluster[]> = await this.client.post('/inference/clusters', {
                    event_ids: events.map(e => e.id)
                })
                return response.data
            } catch (error) {
                handleAPIError(error as AxiosError)
            }
        },

        getPatterns: async (timeRange: TimeRange): Promise<Pattern[]> => {
            try {
                const response: AxiosResponse<Pattern[]> = await this.client.get('/inference/patterns', {
                    params: {
                        start_time: timeRange.start.toISOString(),
                        end_time: timeRange.end.toISOString()
                    }
                })
                return response.data
            } catch (error) {
                handleAPIError(error as AxiosError)
            }
        },
    }

    // Graph operations
    graph = {
        copyFull: async (targetName: string): Promise<CopyResult> => {
            try {
                const response: AxiosResponse<CopyResult> = await this.client.post('/graph/copy', {
                    target_name: targetName,
                    copy_type: 'full'
                })
                return response.data
            } catch (error) {
                handleAPIError(error as AxiosError)
            }
        },

        copyByTimeRange: async (timeRange: TimeRange, targetName: string): Promise<CopyResult> => {
            try {
                const response: AxiosResponse<CopyResult> = await this.client.post('/graph/copy', {
                    target_name: targetName,
                    copy_type: 'time_range',
                    start_time: timeRange.start.toISOString(),
                    end_time: timeRange.end.toISOString()
                })
                return response.data
            } catch (error) {
                handleAPIError(error as AxiosError)
            }
        },

        copyByFilter: async (filter: EntityFilter, targetName: string): Promise<CopyResult> => {
            try {
                const response: AxiosResponse<CopyResult> = await this.client.post('/graph/copy', {
                    target_name: targetName,
                    copy_type: 'filtered',
                    filter
                })
                return response.data
            } catch (error) {
                handleAPIError(error as AxiosError)
            }
        },

        getCopyStatus: async (copyId: string): Promise<CopyResult> => {
            try {
                const response: AxiosResponse<CopyResult> = await this.client.get(`/graph/copy/${copyId}`)
                return response.data
            } catch (error) {
                handleAPIError(error as AxiosError)
            }
        },
    }
}

export const apiClient = new APIClient()