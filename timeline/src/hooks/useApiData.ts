import { useState, useEffect, useCallback, useRef } from 'react';
import { apiService, ApiError } from '@/services/ApiService';

/**
 * Generic API data hook state
 */
export interface ApiDataState<T> {
  data: T | null;
  loading: boolean;
  error: ApiError | null;
  refetch: () => Promise<void>;
}

/**
 * Generic hook for API data fetching
 */
export function useApiData<T>(
  fetcher: () => Promise<T>,
  dependencies: any[] = [],
  options: {
    immediate?: boolean;
    refreshInterval?: number;
  } = {}
): ApiDataState<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  const { immediate = true, refreshInterval } = options;

  const fetchData = useCallback(async () => {
    // Cancel previous request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    abortControllerRef.current = new AbortController();
    setLoading(true);
    setError(null);

    try {
      const result = await fetcher();
      setData(result);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err);
      } else {
        setError(new ApiError(
          err instanceof Error ? err.message : 'Unknown error',
          0,
          { originalError: err }
        ));
      }
    } finally {
      setLoading(false);
    }
  }, [fetcher]);

  // Initial fetch
  useEffect(() => {
    if (immediate) {
      fetchData();
    }
  }, [fetchData, immediate, ...dependencies]);

  // Set up refresh interval
  useEffect(() => {
    if (refreshInterval && refreshInterval > 0) {
      intervalRef.current = setInterval(fetchData, refreshInterval);
      
      return () => {
        if (intervalRef.current) {
          clearInterval(intervalRef.current);
        }
      };
    }
  }, [fetchData, refreshInterval]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, []);

  return {
    data,
    loading,
    error,
    refetch: fetchData
  };
}

/**
 * Hook for fetching events with filtering
 */
export function useEvents(params?: {
  actor?: string;
  target?: string;
  startTime?: string;
  endTime?: string;
  limit?: number;
  offset?: number;
}, options?: { refreshInterval?: number }) {
  return useApiData(
    () => apiService.getEvents(params),
    [JSON.stringify(params)],
    options
  );
}

/**
 * Hook for fetching a single event
 */
export function useEvent(id: string | null) {
  return useApiData(
    () => id ? apiService.getEvent(id) : Promise.resolve(null),
    [id],
    { immediate: !!id }
  );
}

/**
 * Hook for fetching arcs with filtering
 */
export function useArcs(params?: {
  level?: number;
  startTime?: string;
  endTime?: string;
  limit?: number;
  offset?: number;
}, options?: { refreshInterval?: number }) {
  return useApiData(
    () => apiService.getArcs(params),
    [JSON.stringify(params)],
    options
  );
}

/**
 * Hook for fetching causal relationships
 */
export function useCausalRelationships(params?: {
  eventId?: string;
  minWeight?: number;
  limit?: number;
  offset?: number;
}, options?: { refreshInterval?: number }) {
  return useApiData(
    () => apiService.getCausalRelationships(params),
    [JSON.stringify(params)],
    options
  );
}

/**
 * Hook for fetching causal chain
 */
export function useCausalChain(eventId: string | null, params?: {
  maxDepth?: number;
  direction?: 'forward' | 'backward' | 'both';
}) {
  return useApiData(
    () => eventId ? apiService.getCausalChain(eventId, params) : Promise.resolve(null),
    [eventId, JSON.stringify(params)],
    { immediate: !!eventId }
  );
}

/**
 * Hook for API health status
 */
export function useApiHealth(refreshInterval: number = 30000) {
  return useApiData(
    () => apiService.getHealth(),
    [],
    { refreshInterval }
  );
}