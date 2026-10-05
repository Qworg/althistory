import { useState, useEffect } from 'react';
import { CausalRelationshipType } from '@/models/relationships';

export interface ApiResponse<T> {
  success: boolean;
  data: T;
}

/**
 * Query filters accepted by the data hooks.
 *
 * This is the union of the query parameters used by the underlying endpoints
 * (events, arcs and causal relationships). The hooks below do not talk to the
 * HTTP API yet (the fetch is simulated), so the shape is documented here rather
 * than enforced end-to-end.
 */
export interface ApiFilters {
  actor?: string;
  target?: string;
  startTime?: string;
  endTime?: string;
  limit?: number;
  /** Arc hierarchy level (`useArcs`). */
  level?: number;
  /** Minimum causal weight threshold (`useCausalRelationships`). */
  minWeight?: number;
  timeRange?: {
    start: Date;
    end: Date;
  };
}

/**
 * Per-hook options. `refreshInterval` is accepted so callers can express their
 * intent; the simulated fetch below still runs exactly once per filter change.
 */
export interface ApiOptions {
  refreshInterval?: number;
}

export interface Event {
  id: string;
  description: string;
  actor: string;
  target: string;
  timestamp: string;
}

export interface Arc {
  id: string;
  name: string;
  start_time: string;
  end_time: string;
  level: number;
}

export interface CausalRelationship {
  id: string;
  source: string;
  target: string;
  weight: number;
  evidence: string;
  confidence: number;
  /**
   * Present on the causal API payload; optional here because it is missing from
   * some legacy payloads (consumers fall back to 'direct').
   */
  relationship_type?: CausalRelationshipType;
}

export interface CausalChain {
  events: Event[];
  relationships: CausalRelationship[];
}

export interface UseApiDataResult<T> {
  data: ApiResponse<T> | null;
  loading: boolean;
  error: Error | null;
  refetch: () => void;
}

export const useEvents = (filters?: ApiFilters, _options?: ApiOptions): UseApiDataResult<Event[]> => {
  const [data, setData] = useState<ApiResponse<Event[]> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const refetch = () => {
    setLoading(true);
    setError(null);
    // Simulate API call
    setTimeout(() => {
      setData({ success: true, data: [] });
      setLoading(false);
    }, 100);
  };

  useEffect(() => {
    refetch();
  }, [filters]);

  return { data, loading, error, refetch };
};

export const useArcs = (filters?: ApiFilters, _options?: ApiOptions): UseApiDataResult<Arc[]> => {
  const [data, setData] = useState<ApiResponse<Arc[]> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const refetch = () => {
    setLoading(true);
    setError(null);
    // Simulate API call
    setTimeout(() => {
      setData({ success: true, data: [] });
      setLoading(false);
    }, 100);
  };

  useEffect(() => {
    refetch();
  }, [filters]);

  return { data, loading, error, refetch };
};

export const useCausalRelationships = (filters?: ApiFilters, _options?: ApiOptions): UseApiDataResult<CausalRelationship[]> => {
  const [data, setData] = useState<ApiResponse<CausalRelationship[]> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const refetch = () => {
    setLoading(true);
    setError(null);
    // Simulate API call
    setTimeout(() => {
      setData({ success: true, data: [] });
      setLoading(false);
    }, 100);
  };

  useEffect(() => {
    refetch();
  }, [filters]);

  return { data, loading, error, refetch };
};

export const useCausalChain = (filters?: ApiFilters, _options?: ApiOptions): UseApiDataResult<CausalChain> => {
  const [data, setData] = useState<ApiResponse<CausalChain> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const refetch = () => {
    setLoading(true);
    setError(null);
    // Simulate API call
    setTimeout(() => {
      setData({ 
        success: true, 
        data: { 
          events: [], 
          relationships: [] 
        } 
      });
      setLoading(false);
    }, 100);
  };

  useEffect(() => {
    refetch();
  }, [filters]);

  return { data, loading, error, refetch };
};

export class ApiError extends Error {
  constructor(message: string, public statusCode: number, public details?: unknown) {
    super(message);
    this.name = 'ApiError';
  }
}