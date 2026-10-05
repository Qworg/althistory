/**
 * Value types accepted in a query-string parameter bag.
 */
type QueryParamValue = string | number | boolean | undefined;

type QueryParams = Record<string, QueryParamValue>;

/**
 * Narrow an unknown value to a plain object so its properties can be read.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Pull `error.message` out of an error response body, if it has that shape.
 */
function extractErrorMessage(payload: unknown): string | undefined {
  if (!isRecord(payload) || !isRecord(payload.error)) {
    return undefined;
  }
  return typeof payload.error.message === 'string' ? payload.error.message : undefined;
}

/**
 * Build a query string from a parameter bag. Values are stringified the same way
 * `URLSearchParams` would stringify them for a record.
 */
function toSearchParams(params: QueryParams): URLSearchParams {
  return new URLSearchParams(
    Object.entries(params).map(([key, value]) => [key, String(value)])
  );
}

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
        const errorData: unknown = await response.json().catch(() => ({}));
        throw new ApiError(
          extractErrorMessage(errorData) ?? `HTTP ${response.status}: ${response.statusText}`,
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
  async get<T>(endpoint: string, params?: QueryParams): Promise<T> {
    const url = params ? `${endpoint}?${toSearchParams(params)}` : endpoint;
    return this.request<T>(url, { method: 'GET' });
  }

  /**
   * POST request
   */
  async post<T>(endpoint: string, data?: unknown): Promise<T> {
    return this.request<T>(endpoint, {
      method: 'POST',
      body: data ? JSON.stringify(data) : undefined,
    });
  }

  /**
   * PUT request
   */
  async put<T>(endpoint: string, data?: unknown): Promise<T> {
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

  async createEvent(eventData: unknown) {
    return this.post('/events', eventData);
  }

  async updateEvent(id: string, eventData: unknown) {
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

  async createArc(arcData: unknown) {
    return this.post('/arcs', arcData);
  }

  async updateArc(id: string, arcData: unknown) {
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

  async createCausalRelationship(relationshipData: unknown) {
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
    public details?: unknown
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * Default API service instance
 */
export const apiService = new ApiService();