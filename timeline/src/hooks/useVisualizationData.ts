import { useState, useEffect, useCallback, useMemo } from 'react';
import { useEvents, useArcs, useCausalRelationships, Event as ApiEvent, Arc as ApiArc, CausalRelationship as ApiCausalRelationship } from './useApiData';
import { TimelineData } from '@/components/timeline/types';
import { CausalGraphData } from '@/components/causal/types';
import { IEvent } from '@/models/Event';
import { IArc } from '@/models/Arc';

/**
 * Time range for filtering data
 */
export interface TimeRange {
  start: Date;
  end: Date;
}

/**
 * Visualization filters
 */
export interface VisualizationFilters {
  timeRange?: TimeRange;
  actor?: string;
  target?: string;
  minCausalWeight?: number;
  arcLevel?: number;
}

/**
 * The API serialises dates as ISO strings; the models use `Date`. Convert once
 * here so the rest of the visualization stack can rely on real `Date` objects.
 */
function toIEvent(event: ApiEvent): IEvent {
  return {
    id: event.id,
    description: event.description,
    actor: event.actor,
    target: event.target,
    timestamp: new Date(event.timestamp)
  };
}

function toIArc(arc: ApiArc): IArc {
  return {
    id: arc.id,
    name: arc.name,
    start_time: new Date(arc.start_time),
    end_time: new Date(arc.end_time),
    level: arc.level
  };
}

/**
 * Hook for timeline visualization data
 */
export function useTimelineData(
  filters: VisualizationFilters = {},
  options: { refreshInterval?: number } = {}
) {
  const [timeRange, setTimeRange] = useState<TimeRange | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  // Fetch events with filters
  const eventsQuery = useEvents({
    actor: filters.actor,
    target: filters.target,
    startTime: filters.timeRange?.start.toISOString(),
    endTime: filters.timeRange?.end.toISOString(),
    limit: 1000 // Reasonable limit for visualization
  }, options);

  // Fetch arcs with filters
  const arcsQuery = useArcs({
    level: filters.arcLevel,
    startTime: filters.timeRange?.start.toISOString(),
    endTime: filters.timeRange?.end.toISOString(),
    limit: 500
  }, options);

  // Calculate overall time range from data
  useEffect(() => {
    if (eventsQuery.data?.data && arcsQuery.data?.data) {
      const events = eventsQuery.data.data.map(toIEvent);
      const arcs = arcsQuery.data.data.map(toIArc);
      
      if (events.length === 0 && arcs.length === 0) {
        setTimeRange(null);
        return;
      }

      const allDates: Date[] = [];
      
      // Add event timestamps
      events.forEach(event => {
        allDates.push(event.timestamp);
      });
      
      // Add arc start and end times
      arcs.forEach(arc => {
        allDates.push(arc.start_time);
        allDates.push(arc.end_time);
      });

      if (allDates.length > 0) {
        const minDate = new Date(Math.min(...allDates.map(d => d.getTime())));
        const maxDate = new Date(Math.max(...allDates.map(d => d.getTime())));
        
        // Add some padding
        const padding = (maxDate.getTime() - minDate.getTime()) * 0.1;
        setTimeRange({
          start: new Date(minDate.getTime() - padding),
          end: new Date(maxDate.getTime() + padding)
        });
      }
    }
  }, [eventsQuery.data, arcsQuery.data]);

  // Update loading and error states
  useEffect(() => {
    setLoading(eventsQuery.loading || arcsQuery.loading);
    setError(eventsQuery.error || arcsQuery.error);
  }, [eventsQuery.loading, arcsQuery.loading, eventsQuery.error, arcsQuery.error]);

  // Memoized timeline data
  const timelineData: TimelineData | null = useMemo(() => {
    if (!eventsQuery.data?.data || !arcsQuery.data?.data || !timeRange) {
      return null;
    }

    const events = eventsQuery.data.data.map(toIEvent);
    const arcs = arcsQuery.data.data.map(toIArc);

    return {
      events,
      arcs,
      timeRange
    };
  }, [eventsQuery.data, arcsQuery.data, timeRange]);

  const refetch = useCallback(async () => {
    await Promise.all([eventsQuery.refetch(), arcsQuery.refetch()]);
  }, [eventsQuery.refetch, arcsQuery.refetch]);

  return {
    data: timelineData,
    loading,
    error,
    refetch,
    setTimeRange: (range: TimeRange) => {
      // This would trigger a re-fetch with new time range
      // For now, we'll just update the local state
      setTimeRange(range);
    }
  };
}

/**
 * Hook for causal graph visualization data
 */
export function useCausalGraphData(
  filters: VisualizationFilters = {},
  options: { refreshInterval?: number } = {}
) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  // Fetch events
  const eventsQuery = useEvents({
    actor: filters.actor,
    target: filters.target,
    startTime: filters.timeRange?.start.toISOString(),
    endTime: filters.timeRange?.end.toISOString(),
    limit: 500 // Reasonable limit for graph visualization
  }, options);

  // Fetch causal relationships
  const relationshipsQuery = useCausalRelationships({
    minWeight: filters.minCausalWeight || 0.1,
    limit: 1000
  }, options);

  // Update loading and error states
  useEffect(() => {
    setLoading(eventsQuery.loading || relationshipsQuery.loading);
    setError(eventsQuery.error || relationshipsQuery.error);
  }, [eventsQuery.loading, relationshipsQuery.loading, eventsQuery.error, relationshipsQuery.error]);

  // Memoized causal graph data
  const causalGraphData: CausalGraphData | null = useMemo(() => {
    if (!eventsQuery.data?.data || !relationshipsQuery.data?.data) {
      return null;
    }

    const events = eventsQuery.data.data.map(toIEvent);
    const relationships: ApiCausalRelationship[] = relationshipsQuery.data.data || [];

    // Filter events that have causal relationships
    const eventIds = new Set([
      ...relationships.map(r => r.source),
      ...relationships.map(r => r.target)
    ]);

    const filteredEvents = events.filter(event => eventIds.has(event.id));

    return {
      events: filteredEvents,
      relationships: relationships.map(rel => ({
        id: rel.id || `${rel.source}-${rel.target}`,
        source: rel.source,
        target: rel.target,
        weight: rel.weight,
        evidence: rel.evidence || '',
        confidence: rel.confidence || rel.weight,
        relationship_type: rel.relationship_type ?? 'direct'
      }))
    };
  }, [eventsQuery.data, relationshipsQuery.data]);

  const refetch = useCallback(async () => {
    await Promise.all([eventsQuery.refetch(), relationshipsQuery.refetch()]);
  }, [eventsQuery.refetch, relationshipsQuery.refetch]);

  return {
    data: causalGraphData,
    loading,
    error,
    refetch
  };
}

/**
 * Hook for managing visualization state and interactions
 */
export function useVisualizationState() {
  const [selectedEvent, setSelectedEvent] = useState<IEvent | null>(null);
  const [selectedArc, setSelectedArc] = useState<IArc | null>(null);
  const [hoveredEvent, setHoveredEvent] = useState<IEvent | null>(null);
  const [hoveredArc, setHoveredArc] = useState<IArc | null>(null);
  const [filters, setFilters] = useState<VisualizationFilters>({});
  const [viewMode, setViewMode] = useState<'timeline' | 'causal' | 'both'>('timeline');

  // Update filters
  const updateFilters = useCallback((newFilters: Partial<VisualizationFilters>) => {
    setFilters(prev => ({ ...prev, ...newFilters }));
  }, []);

  // Clear selections
  const clearSelections = useCallback(() => {
    setSelectedEvent(null);
    setSelectedArc(null);
    setHoveredEvent(null);
    setHoveredArc(null);
  }, []);

  return {
    selectedEvent,
    setSelectedEvent,
    selectedArc,
    setSelectedArc,
    hoveredEvent,
    setHoveredEvent,
    hoveredArc,
    setHoveredArc,
    filters,
    updateFilters,
    viewMode,
    setViewMode,
    clearSelections
  };
}

/**
 * Hook for real-time data updates using WebSocket or polling
 */
export function useRealTimeUpdates(
  onEventUpdate?: (event: IEvent) => void,
  onArcUpdate?: (arc: IArc) => void
) {
  const [isConnected, setIsConnected] = useState(false);
  // `_setLastUpdate` is intentionally unused: it is only called by the WebSocket
  // handler below, which is still commented out. Keep the state (and therefore
  // the `lastUpdate` field of the hook's result) until that handler lands.
  const [lastUpdate, _setLastUpdate] = useState<Date | null>(null);

  // For now, we'll use polling. In a real implementation, 
  // this would use WebSocket connections
  useEffect(() => {
    // Placeholder for WebSocket connection
    // const ws = new WebSocket('ws://localhost:3000/ws');
    
    // ws.onopen = () => setIsConnected(true);
    // ws.onclose = () => setIsConnected(false);
    // ws.onmessage = (event) => {
    //   const data = JSON.parse(event.data);
    //   if (data.type === 'event_update') {
    //     onEventUpdate?.(data.event);
    //   } else if (data.type === 'arc_update') {
    //     onArcUpdate?.(data.arc);
    //   }
    //   setLastUpdate(new Date());
    // };

    // For now, simulate connection
    setIsConnected(true);
    
    // Cleanup
    return () => {
      // ws.close();
      setIsConnected(false);
    };
  }, [onEventUpdate, onArcUpdate]);

  return {
    isConnected,
    lastUpdate
  };
}