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
  TimeRange,
  Graph,
  GraphVersion,
  CreateGraphRequest,
  UpdateGraphRequest,
  BranchGraphRequest,
  MergeGraphRequest,
  ExportJob,
  CreateExportJobRequest,
  AlthistoryExport,
  ExportValidationResult,
  GraphStatus
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
                const response: AxiosResponse<{ success: boolean; data: Event[] }> = await this.client.get('/events', { params: filters })
                return response.data.data
            } catch (error) {
                handleAPIError(error as AxiosError)
            }
        },

        getById: async (id: string): Promise<Event> => {
            try {
                const response: AxiosResponse<{ success: boolean; data: Event }> = await this.client.get(`/events/${id}`)
                return response.data.data
            } catch (error) {
                handleAPIError(error as AxiosError)
            }
        },

        create: async (data: CreateEventRequest): Promise<Event> => {
            try {
                const response: AxiosResponse<{ success: boolean; data: Event }> = await this.client.post('/events', data)
                return response.data.data
            } catch (error) {
                handleAPIError(error as AxiosError)
            }
        },

        update: async (id: string, data: UpdateEventRequest): Promise<Event> => {
            try {
                const response: AxiosResponse<{ success: boolean; data: Event }> = await this.client.put(`/events/${id}`, data)
                return response.data.data
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
                const response: AxiosResponse<{ success: boolean; data: Event[] }> = await this.client.get('/events/search', {
                    params: { q: query, ...filters }
                })
                return response.data.data
            } catch (error) {
                handleAPIError(error as AxiosError)
            }
        },
    }

    // Arc operations
    arcs = {
        getAll: async (filters?: ArcFilters): Promise<Arc[]> => {
            try {
                const response: AxiosResponse<{ success: boolean; data: Arc[] }> = await this.client.get('/arcs', { params: filters })
                return response.data.data
            } catch (error) {
                handleAPIError(error as AxiosError)
            }
        },

        getById: async (id: string): Promise<Arc> => {
            try {
                const response: AxiosResponse<{ success: boolean; data: Arc }> = await this.client.get(`/arcs/${id}`)
                return response.data.data
            } catch (error) {
                handleAPIError(error as AxiosError)
            }
        },

        create: async (data: CreateArcRequest): Promise<Arc> => {
            try {
                const response: AxiosResponse<{ success: boolean; data: Arc }> = await this.client.post('/arcs', data)
                return response.data.data
            } catch (error) {
                handleAPIError(error as AxiosError)
            }
        },

        update: async (id: string, data: UpdateArcRequest): Promise<Arc> => {
            try {
                const response: AxiosResponse<{ success: boolean; data: Arc }> = await this.client.put(`/arcs/${id}`, data)
                return response.data.data
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
                const response: AxiosResponse<{ success: boolean; data: Arc[] }> = await this.client.get('/arcs/hierarchy')
                return response.data.data
            } catch (error) {
                handleAPIError(error as AxiosError)
            }
        },
    }

    // Causal operations
    causal = {
        getRelationships: async (eventId?: string): Promise<CausalRelationship[]> => {
            try {
                const response: AxiosResponse<{ success: boolean; data: CausalRelationship[] }> = await this.client.get('/causal/relationships', {
                    params: eventId ? { event_id: eventId } : undefined
                })
                return response.data.data
            } catch (error) {
                handleAPIError(error as AxiosError)
            }
        },

        createLink: async (causeId: string, effectId: string, relationshipData: CausalRelationshipData): Promise<CausalRelationship> => {
            try {
                // Transform to backend format: POST /causal/link expects causeEventId, effectEventId, relationship
                const data = {
                    causeEventId: causeId,
                    effectEventId: effectId,
                    relationship: {
                        type: relationshipData.relationship_type || 'direct',
                        strength: relationshipData.weight,
                        confidence: relationshipData.confidence,
                        evidence: relationshipData.evidence
                    }
                }
                const response: AxiosResponse<{ success: boolean; data: { cause: Event; effect: Event; relationship: any } }> = await this.client.post('/causal/link', data)
                // Transform response back to frontend format
                const now = new Date().toISOString()
                const result: CausalRelationship = {
                    id: `${causeId}_${effectId}`,
                    cause_event_id: causeId,
                    effect_event_id: effectId,
                    weight: response.data.data.relationship.strength || relationshipData.weight,
                    confidence: response.data.data.relationship.confidence || relationshipData.confidence,
                    evidence: response.data.data.relationship.evidence || relationshipData.evidence,
                    relationship_type: response.data.data.relationship.type || relationshipData.relationship_type || 'direct',
                    created_at: response.data.data.relationship.created_at || now,
                    updated_at: response.data.data.relationship.updated_at || now
                }
                return result
            } catch (error) {
                handleAPIError(error as AxiosError)
            }
        },

        updateLink: async (causeEventId: string, effectEventId: string, data: Partial<CausalRelationshipData>): Promise<CausalRelationship> => {
            try {
                const requestData = {
                    causeEventId,
                    effectEventId,
                    relationship: {
                        type: data.relationship_type,
                        weight: data.weight,
                        confidence: data.confidence,
                        evidence: data.evidence
                    }
                }
                const response: AxiosResponse<{ success: boolean; data: { cause: Event; effect: Event; relationship: any } }> = await this.client.put('/causal/link', requestData)
                // Transform response back to frontend format
                const now = new Date().toISOString()
                const result: CausalRelationship = {
                    id: `${causeEventId}_${effectEventId}`,
                    cause_event_id: causeEventId,
                    effect_event_id: effectEventId,
                    weight: response.data.data.relationship.weight ?? data.weight ?? 0,
                    confidence: response.data.data.relationship.confidence ?? data.confidence ?? 0,
                    evidence: response.data.data.relationship.evidence ?? data.evidence ?? '',
                    relationship_type: response.data.data.relationship.relationship_type || data.relationship_type || 'direct',
                    created_at: response.data.data.relationship.created_at || now,
                    updated_at: response.data.data.relationship.updated_at || now
                }
                return result
            } catch (error) {
                handleAPIError(error as AxiosError)
            }
        },

        deleteLink: async (causeEventId: string, effectEventId: string): Promise<void> => {
            try {
                await this.client.request({
                    method: 'DELETE',
                    url: '/causal/link',
                    data: { causeEventId, effectEventId }
                })
            } catch (error) {
                handleAPIError(error as AxiosError)
            }
        },

        findChain: async (startEventId: string, maxDepth: number = 3, signal?: AbortSignal): Promise<CausalPath[]> => {
            try {
                const response: AxiosResponse<{ success: boolean; data: CausalPath[] }> = await this.client.get(`/causal/chain/${startEventId}`, {
                    params: { max_depth: maxDepth },
                    signal
                })
                return response.data.data
            } catch (error) {
                handleAPIError(error as AxiosError)
            }
        },

        getSuggestions: async (eventId: string, signal?: AbortSignal): Promise<CausalSuggestion[]> => {
            try {
                const response: AxiosResponse<{ success: boolean; data: CausalSuggestion[] }> = await this.client.get('/causal/suggestions', {
                    params: { event_id: eventId },
                    signal
                })
                return response.data.data
            } catch (error) {
                handleAPIError(error as AxiosError)
            }
        },
    }

    // Inference operations
    inference = {
        getPressures: async (arcId?: string): Promise<InferredPressure[]> => {
            try {
                const response: AxiosResponse<{ success: boolean; data: InferredPressure[] }> = await this.client.get('/inferred-pressures', {
                    params: arcId ? { arc_id: arcId } : undefined
                })
                return response.data.data
            } catch (error) {
                handleAPIError(error as AxiosError)
            }
        },

        analyzeClusters: async (events: Event[]): Promise<EventCluster[]> => {
            try {
                const response: AxiosResponse<{ success: boolean; data: EventCluster[] }> = await this.client.post('/inference/clusters', {
                    event_ids: events.map(e => e.id)
                })
                return response.data.data
            } catch (error) {
                handleAPIError(error as AxiosError)
            }
        },

        getPatterns: async (timeRange: TimeRange): Promise<Pattern[]> => {
            try {
                const response: AxiosResponse<{ success: boolean; data: Pattern[] }> = await this.client.get('/inference/patterns', {
                    params: {
                        start_time: timeRange.start.toISOString(),
                        end_time: timeRange.end.toISOString()
                    }
                })
                return response.data.data
            } catch (error) {
                handleAPIError(error as AxiosError)
            }
        },
    }

    // Graph operations
    graph = {
        copyFull: async (targetName: string): Promise<CopyResult> => {
            try {
                const response: AxiosResponse<{ success: boolean; data: CopyResult }> = await this.client.post('/graph/copy', {
                    target_name: targetName,
                    copy_type: 'full'
                })
                return response.data.data
            } catch (error) {
                handleAPIError(error as AxiosError)
            }
        },

        copyByTimeRange: async (timeRange: TimeRange, targetName: string): Promise<CopyResult> => {
            try {
                const response: AxiosResponse<{ success: boolean; data: CopyResult }> = await this.client.post('/graph/copy', {
                    target_name: targetName,
                    copy_type: 'time_range',
                    start_time: timeRange.start.toISOString(),
                    end_time: timeRange.end.toISOString()
                })
                return response.data.data
            } catch (error) {
                handleAPIError(error as AxiosError)
            }
        },

        copyByFilter: async (filter: EntityFilter, targetName: string): Promise<CopyResult> => {
            try {
                const response: AxiosResponse<{ success: boolean; data: CopyResult }> = await this.client.post('/graph/copy', {
                    target_name: targetName,
                    copy_type: 'filtered',
                    filter
                })
                return response.data.data
            } catch (error) {
                handleAPIError(error as AxiosError)
            }
        },

        getCopyStatus: async (copyId: string): Promise<CopyResult> => {
            try {
                const response: AxiosResponse<{ success: boolean; data: CopyResult }> = await this.client.get(`/graph/copy/${copyId}`)
                return response.data.data
            } catch (error) {
                handleAPIError(error as AxiosError)
            }
        },
    }

    // Graph Management operations
    graphs = {
        getAll: async (options?: { status?: GraphStatus; limit?: number; offset?: number }): Promise<{ graphs: Graph[]; total: number }> => {
            try {
                const response: AxiosResponse<{ success: boolean; data: Graph[]; pagination: { total: number } }> = 
                    await this.client.get('/graphs', { params: options })
                return { graphs: response.data.data, total: response.data.pagination?.total || response.data.data.length }
            } catch (error) {
                handleAPIError(error as AxiosError)
            }
        },

        getById: async (id: string): Promise<Graph> => {
            try {
                const response: AxiosResponse<{ success: boolean; data: Graph }> = await this.client.get(`/graphs/${id}`)
                return response.data.data
            } catch (error) {
                handleAPIError(error as AxiosError)
            }
        },

        create: async (data: CreateGraphRequest): Promise<Graph> => {
            try {
                const response: AxiosResponse<{ success: boolean; data: Graph }> = await this.client.post('/graphs', data)
                return response.data.data
            } catch (error) {
                handleAPIError(error as AxiosError)
            }
        },

        update: async (id: string, data: UpdateGraphRequest): Promise<Graph> => {
            try {
                const response: AxiosResponse<{ success: boolean; data: Graph }> = await this.client.put(`/graphs/${id}`, data)
                return response.data.data
            } catch (error) {
                handleAPIError(error as AxiosError)
            }
        },

        delete: async (id: string): Promise<void> => {
            try {
                await this.client.delete(`/graphs/${id}`)
            } catch (error) {
                handleAPIError(error as AxiosError)
            }
        },

        // Branching
        branch: async (id: string, data: BranchGraphRequest): Promise<Graph> => {
            try {
                const response: AxiosResponse<{ success: boolean; data: Graph }> = 
                    await this.client.post(`/graphs/${id}/branch`, data)
                return response.data.data
            } catch (error) {
                handleAPIError(error as AxiosError)
            }
        },

        getBranches: async (id: string): Promise<Graph[]> => {
            try {
                const response: AxiosResponse<{ success: boolean; data: Graph[] }> = 
                    await this.client.get(`/graphs/${id}/branches`)
                return response.data.data
            } catch (error) {
                handleAPIError(error as AxiosError)
            }
        },

        merge: async (id: string, data: MergeGraphRequest): Promise<Graph> => {
            try {
                const response: AxiosResponse<{ success: boolean; data: Graph }> = 
                    await this.client.post(`/graphs/${id}/merge`, data)
                return response.data.data
            } catch (error) {
                handleAPIError(error as AxiosError)
            }
        },

        // Version history
        getVersions: async (id: string, limit?: number): Promise<GraphVersion[]> => {
            try {
                const response: AxiosResponse<{ success: boolean; data: GraphVersion[] }> = 
                    await this.client.get(`/graphs/${id}/versions`, { params: { limit } })
                return response.data.data
            } catch (error) {
                handleAPIError(error as AxiosError)
            }
        },

        rollback: async (id: string, version: number): Promise<Graph> => {
            try {
                const response: AxiosResponse<{ success: boolean; data: Graph }> = 
                    await this.client.post(`/graphs/${id}/rollback`, { version })
                return response.data.data
            } catch (error) {
                handleAPIError(error as AxiosError)
            }
        },

        // Switch active graph
        switch: async (id: string): Promise<void> => {
            // Store current graph ID in local storage for the app to use
            localStorage.setItem('active_graph_id', id)
            // Emit event for components to react to
            window.dispatchEvent(new CustomEvent('graph-switched', { detail: { graphId: id } }))
        },
    }

    // Export operations
    export = {
        createJob: async (data: CreateExportJobRequest): Promise<{ jobId: string; estimatedSize?: number; estimatedTime?: number }> => {
            try {
                const response: AxiosResponse<{ success: boolean; data: { jobId: string; estimatedSize?: number; estimatedTime?: number } }> = 
                    await this.client.post('/export/jobs', data)
                return response.data.data
            } catch (error) {
                handleAPIError(error as AxiosError)
            }
        },

        getJobs: async (options?: { status?: string; limit?: number; offset?: number }): Promise<ExportJob[]> => {
            try {
                const response: AxiosResponse<{ success: boolean; data: ExportJob[] }> = 
                    await this.client.get('/export/jobs', { params: options })
                return response.data.data
            } catch (error) {
                handleAPIError(error as AxiosError)
            }
        },

        getJob: async (jobId: string): Promise<ExportJob> => {
            try {
                const response: AxiosResponse<{ success: boolean; data: ExportJob }> = 
                    await this.client.get(`/export/jobs/${jobId}`)
                return response.data.data
            } catch (error) {
                handleAPIError(error as AxiosError)
            }
        },

        cancelJob: async (jobId: string): Promise<void> => {
            try {
                await this.client.delete(`/export/jobs/${jobId}`)
            } catch (error) {
                handleAPIError(error as AxiosError)
            }
        },

        downloadJob: async (jobId: string): Promise<Blob> => {
            try {
                const response = await this.client.get(`/export/jobs/${jobId}/download`, {
                    responseType: 'blob'
                })
                return response.data
            } catch (error) {
                handleAPIError(error as AxiosError)
            }
        },

        // Sync export for small graphs
        exportSync: async (data: CreateExportJobRequest): Promise<{ export: AlthistoryExport; size: number }> => {
            try {
                const response: AxiosResponse<{ success: boolean; data: AlthistoryExport; size: number }> = 
                    await this.client.post('/export/sync', data)
                return { export: response.data.data, size: response.data.size }
            } catch (error) {
                handleAPIError(error as AxiosError)
            }
        },

        validate: async (exportData: AlthistoryExport): Promise<ExportValidationResult> => {
            try {
                const response: AxiosResponse<{ success: boolean; data: ExportValidationResult }> = 
                    await this.client.post('/export/validate', exportData)
                return response.data.data
            } catch (error) {
                handleAPIError(error as AxiosError)
            }
        },

        getStats: async (): Promise<{ export: { total: number; pending: number; processing: number; completed: number; failed: number } }> => {
            try {
                const response: AxiosResponse<{ success: boolean; data: { export: { total: number; pending: number; processing: number; completed: number; failed: number } } }> = 
                    await this.client.get('/export/stats')
                return response.data.data
            } catch (error) {
                handleAPIError(error as AxiosError)
            }
        },
    }
}

export const apiClient = new APIClient()