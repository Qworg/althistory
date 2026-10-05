import { useState, useEffect } from 'react';

export interface ApiResponse<T> {
  success: boolean;
  data: T;
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

export const useEvents = (filters?: any): UseApiDataResult<Event[]> => {
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

export const useArcs = (filters?: any): UseApiDataResult<Arc[]> => {
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

export const useCausalRelationships = (filters?: any): UseApiDataResult<CausalRelationship[]> => {
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

export const useCausalChain = (filters?: any): UseApiDataResult<CausalChain> => {
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
  constructor(message: string, public statusCode: number, public details?: any) {
    super(message);
    this.name = 'ApiError';
  }
}