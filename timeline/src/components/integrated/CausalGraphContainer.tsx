import React, { useState } from 'react';
import { useEvents, useCausalRelationships } from '@/hooks/useApiData';

interface CausalGraphContainerProps {
  /** Reserved for wiring up event selection; not rendered yet. */
  onEventSelect?: (eventId: string) => void;
}

export const CausalGraphContainer: React.FC<CausalGraphContainerProps> = () => {
  const [minWeight, setMinWeight] = useState(0);
  const { data: eventsData, loading: eventsLoading, error: eventsError } = useEvents();
  const { data: relationshipsData, loading: relationshipsLoading, error: relationshipsError } = useCausalRelationships();

  if (eventsLoading || relationshipsLoading) {
    return <div>Loading causal graph data...</div>;
  }

  if (eventsError || relationshipsError) {
    return (
      <div>
        <div>Error Loading Causal Graph</div>
        <div>{eventsError?.message || relationshipsError?.message}</div>
      </div>
    );
  }

  if (!relationshipsData?.data?.length) {
    return <div>No causal relationships found. Try adjusting your filters.</div>;
  }

  const eventCount = eventsData?.data?.length || 0;
  const relationshipCount = relationshipsData?.data?.length || 0;

  return (
    <div>
      <div>{eventCount} events, {relationshipCount} relationships</div>
      <div>
        <label>Min Weight:</label>
        <input 
          type="range" 
          min="0" 
          max="1" 
          step="0.1" 
          value={minWeight}
          onChange={(e) => setMinWeight(parseFloat(e.target.value))}
        />
        <span>{Math.round(minWeight * 100)}%</span>
      </div>
      {/* Causal graph visualization would go here */}
    </div>
  );
};