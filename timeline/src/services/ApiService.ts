/**
 * API service for communicating with the backend
 */
export class ApiService {
  private baseUrl: string;
  private defaultHeaders: Record<string, string>;

  constructor(baseUrl: string = '/api') {
    this.baseUrl = baseUrl;
    this.defaultHeaders = {
      'Content-Type': 'application/json',
    };
  }

  /**
   * Make HTTP request with error handling
   */
  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;
    
    const config: RequestInit = {
      ...options,
      headers: {
        ...this.defaultHeaders,
        ...options.headers,
      },
    };

    try {
      const response = await fetch(url, config);
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new ApiError(
          errorData.error?.message || `HTTP ${response.status}: ${response.statusText}`,
          response.status,
          errorData
        );
      }

      return await response.json();
    } catch (error) {
      if (error instanceof ApiError) {
        throw error;
      }
      
      throw new ApiError(
        error instanceof Error ? error.message : 'Network error',
        0,
        { originalError: error }
      );
    }
  }

  /**
   * GET request
   */
  async get<T>(endpoint: string, params?: Record<string, any>): Promise<T> {
    const url = params ? `${endpoint}?${new URLSearchParams(params)}` : endpoint;
    return this.request<T>(url, { method: 'GET' });
  }

  /**
   * POST request
   */
  async post<T>(endpoint: string, data?: any): Promise<T> {
    return this.request<T>(endpoint, {
      method: 'POST',
      body: data ? JSON.stringify(data) : undefined,
    });
  }

  /**
   * PUT request
   */
  async put<T>(endpoint: string, data?: any): Promise<T> {
    return this.request<T>(endpoint, {
      method: 'PUT',
      body: data ? JSON.stringify(data) : undefined,
    });
  }

  /**
   * DELETE request
   */
  async delete<T>(endpoint: string): Promise<T> {
    return this.request<T>(endpoint, { method: 'DELETE' });
  }

  // Event API methods
  async getEvents(params?: {
    actor?: string;
    target?: string;
    startTime?: string;
    endTime?: string;
    limit?: number;
    offset?: number;
  }) {
    return this.get('/events', params);
  }

  async getEvent(id: string) {
    return this.get(`/events/${id}`);
  }

  async createEvent(eventData: any) {
    return this.post('/events', eventData);
  }

  async updateEvent(id: string, eventData: any) {
    return this.put(`/events/${id}`, eventData);
  }

  async deleteEvent(id: string) {
    return this.delete(`/events/${id}`);
  }

  async getEventCount(params?: {
    actor?: string;
    startTime?: string;
    endTime?: string;
  }) {
    return this.get('/events/stats/count', params);
  }

  // Arc API methods (placeholder for future implementation)
  async getArcs(params?: {
    level?: number;
    startTime?: string;
    endTime?: string;
    limit?: number;
    offset?: number;
  }) {
    return this.get('/arcs', params);
  }

  async getArc(id: string) {
    return this.get(`/arcs/${id}`);
  }

  async createArc(arcData: any) {
    return this.post('/arcs', arcData);
  }

  async updateArc(id: string, arcData: any) {
    return this.put(`/arcs/${id}`, arcData);
  }

  async deleteArc(id: string) {
    return this.delete(`/arcs/${id}`);
  }

  // Causal relationship API methods (placeholder for future implementation)
  async getCausalRelationships(params?: {
    eventId?: string;
    minWeight?: number;
    limit?: number;
    offset?: number;
  }) {
    return this.get('/causal/relationships', params);
  }

  async createCausalRelationship(relationshipData: any) {
    return this.post('/causal/relationships', relationshipData);
  }

  async getCausalChain(eventId: string, params?: {
    maxDepth?: number;
    direction?: 'forward' | 'backward' | 'both';
  }) {
    return this.get(`/events/${eventId}/causal-chain`, params);
  }

  // Health check
  async getHealth() {
    return this.get('/health');
  }

  async getApiInfo() {
    return this.get('/info');
  }
}

/**
 * API Error class
 */
export class ApiError extends Error {
  constructor(
    message: string,
    public statusCode: number,
    public details?: any
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * Default API service instance
 */
export const apiService = new ApiService();