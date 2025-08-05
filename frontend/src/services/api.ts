import axios from 'axios'
import type { AxiosInstance, AxiosResponse } from 'axios'
import { Event, Arc, CausalRelationship, InferredPressure } from '@/types'

// API client configuration
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000/api'

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
            (error) => {
                // Handle common errors
                if (error.response?.status === 401) {
                    // Handle unauthorized
                    localStorage.removeItem('auth_token')
                    window.location.href = '/login'
                }
                return Promise.reject(error)
            }
        )
    }

    // Event operations
    events = {
        getAll: async (filters?: Record<string, any>): Promise<Event[]> => {
            const response: AxiosResponse<Event[]> = await this.client.get('/events', { params: filters })
            return response.data
        },

        getById: async (id: string): Promise<Event> => {
            const response: AxiosResponse<Event> = await this.client.get(`/events/${id}`)
            return response.data
        },

        create: async (data: Omit<Event, 'id' | 'created_at' | 'updated_at'>): Promise<Event> => {
            const response: AxiosResponse<Event> = await this.client.post('/events', data)
            return response.data
        },

        update: async (id: string, data: Partial<Event>): Promise<Event> => {
            const response: AxiosResponse<Event> = await this.client.put(`/events/${id}`, data)
            return response.data
        },

        delete: async (id: string): Promise<void> => {
            await this.client.delete(`/events/${id}`)
        },

        search: async (query: string, filters?: Record<string, any>): Promise<Event[]> => {
            const response: AxiosResponse<Event[]> = await this.client.get('/events/search', {
                params: { q: query, ...filters }
            })
            return response.data
        },
    }

    // Arc operations
    arcs = {
        getAll: async (filters?: Record<string, any>): Promise<Arc[]> => {
            const response: AxiosResponse<Arc[]> = await this.client.get('/arcs', { params: filters })
            return response.data
        },

        getById: async (id: string): Promise<Arc> => {
            const response: AxiosResponse<Arc> = await this.client.get(`/arcs/${id}`)
            return response.data
        },

        create: async (data: Omit<Arc, 'id' | 'created_at' | 'updated_at'>): Promise<Arc> => {
            const response: AxiosResponse<Arc> = await this.client.post('/arcs', data)
            return response.data
        },

        update: async (id: string, data: Partial<Arc>): Promise<Arc> => {
            const response: AxiosResponse<Arc> = await this.client.put(`/arcs/${id}`, data)
            return response.data
        },

        delete: async (id: string): Promise<void> => {
            await this.client.delete(`/arcs/${id}`)
        },

        getHierarchy: async (): Promise<Arc[]> => {
            const response: AxiosResponse<Arc[]> = await this.client.get('/arcs/hierarchy')
            return response.data
        },
    }

    // Causal operations
    causal = {
        getRelationships: async (eventId?: string): Promise<CausalRelationship[]> => {
            const response: AxiosResponse<CausalRelationship[]> = await this.client.get('/causal-relationships', {
                params: eventId ? { event_id: eventId } : undefined
            })
            return response.data
        },

        createLink: async (data: Omit<CausalRelationship, 'id' | 'created_at' | 'updated_at'>): Promise<CausalRelationship> => {
            const response: AxiosResponse<CausalRelationship> = await this.client.post('/causal-relationships', data)
            return response.data
        },

        updateLink: async (id: string, data: Partial<CausalRelationship>): Promise<CausalRelationship> => {
            const response: AxiosResponse<CausalRelationship> = await this.client.put(`/causal-relationships/${id}`, data)
            return response.data
        },

        deleteLink: async (id: string): Promise<void> => {
            await this.client.delete(`/causal-relationships/${id}`)
        },
    }

    // Inference operations
    inference = {
        getPressures: async (arcId?: string): Promise<InferredPressure[]> => {
            const response: AxiosResponse<InferredPressure[]> = await this.client.get('/inferred-pressures', {
                params: arcId ? { arc_id: arcId } : undefined
            })
            return response.data
        },
    }
}

export const apiClient = new APIClient()