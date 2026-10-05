import { Event, InferredPressure, PressureType } from '@/models';
import { CausalSuggestion, CausalRelationshipType, DrivenByRelationship } from '@/models/relationships';

/**
 * Represents a cluster of temporally related events
 */
interface EventCluster {
  events: Event[];
  timeRange: { start: Date; end: Date };
  actors: Set<string>;
  targets: Set<string>;
  density: number;
  centroid: Date;
}

/**
 * Pattern detection result
 */
interface PatternDetectionResult {
  clusters: EventCluster[];
  pressures: InferredPressure[];
  causalSuggestions: CausalSuggestion[];
}

/**
 * Service for pattern detection and pressure inference
 */
export class InferenceService {
  private readonly TEMPORAL_WINDOW_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
  private readonly MIN_CLUSTER_SIZE = 2; // Reduced from 3 to 2
  private readonly MIN_DENSITY_THRESHOLD = 0.1; // Reduced from 0.3 to 0.1
  private readonly HIGH_CONFIDENCE_THRESHOLD = 0.8;
  private readonly MEDIUM_CONFIDENCE_THRESHOLD = 0.3; // Reduced from 0.5 to 0.3

  /**
   * Analyze event clusters to identify patterns and infer pressures
   */
  analyzeEventClusters(events: Event[]): InferredPressure[] {
    if (events.length === 0) {
      return [];
    }

    // Sort events by timestamp for temporal analysis
    const sortedEvents = [...events].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
    
    // Perform temporal clustering
    const clusters = this.performTemporalClustering(sortedEvents);
    
    // Analyze each cluster for pressure patterns
    const pressures: InferredPressure[] = [];
    
    for (const cluster of clusters) {
      const clusterPressures = this.analyzeClusterForPressures(cluster);
      pressures.push(...clusterPressures);
    }

    return pressures;
  }

  /**
   * Suggest potential causal links based on temporal and actor patterns
   */
  suggestCausalLinks(events: Event[]): CausalSuggestion[] {
    if (events.length < 2) {
      return [];
    }

    const suggestions: CausalSuggestion[] = [];
    const sortedEvents = [...events].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

    for (let i = 0; i < sortedEvents.length - 1; i++) {
      for (let j = i + 1; j < sortedEvents.length; j++) {
        const causeEvent = sortedEvents[i];
        const effectEvent = sortedEvents[j];
        
        const suggestion = this.evaluateCausalRelationship(causeEvent, effectEvent);
        if (suggestion) {
          suggestions.push(suggestion);
        }
      }
    }

    // Sort by confidence and return top suggestions
    return suggestions
      .sort((a, b) => b.suggested_relationship.confidence - a.suggested_relationship.confidence)
      .slice(0, 10); // Limit to top 10 suggestions
  }

  /**
   * Perform temporal clustering of events using sliding window approach
   */
  private performTemporalClustering(sortedEvents: Event[]): EventCluster[] {
    const clusters: EventCluster[] = [];
    let currentCluster: Event[] = [];
    let windowStart = sortedEvents[0].timestamp;

    for (const event of sortedEvents) {
      const timeDiff = event.timestamp.getTime() - windowStart.getTime();
      
      if (timeDiff <= this.TEMPORAL_WINDOW_MS) {
        // Event fits in current window
        currentCluster.push(event);
      } else {
        // Process current cluster if it meets minimum size
        if (currentCluster.length >= this.MIN_CLUSTER_SIZE) {
          const cluster = this.createEventCluster(currentCluster);
          if (cluster.density >= this.MIN_DENSITY_THRESHOLD) {
            clusters.push(cluster);
          }
        }
        
        // Start new cluster
        currentCluster = [event];
        windowStart = event.timestamp;
      }
    }

    // Process final cluster
    if (currentCluster.length >= this.MIN_CLUSTER_SIZE) {
      const cluster = this.createEventCluster(currentCluster);
      if (cluster.density >= this.MIN_DENSITY_THRESHOLD) {
        clusters.push(cluster);
      }
    }

    return clusters;
  }

  /**
   * Create an EventCluster from a group of events
   */
  private createEventCluster(events: Event[]): EventCluster {
    const timestamps = events.map(e => e.timestamp.getTime());
    const start = new Date(Math.min(...timestamps));
    const end = new Date(Math.max(...timestamps));
    
    const actors = new Set(events.map(e => e.actor));
    const targets = new Set(events.map(e => e.target));
    
    // Calculate density based on event frequency and actor/target overlap
    const timeSpan = end.getTime() - start.getTime();
    const temporalDensity = timeSpan > 0 ? Math.min(1.0, events.length / (timeSpan / (24 * 60 * 60 * 1000))) : 1; // events per day, capped at 1
    const actorOverlap = this.calculateOverlapRatio(actors, targets);
    const density = Math.min(1.0, Math.max(0.1, (temporalDensity * 0.7) + (actorOverlap * 0.3))); // Ensure minimum density of 0.1
    
    // Calculate centroid (median timestamp)
    const sortedTimestamps = timestamps.sort((a, b) => a - b);
    const medianIndex = Math.floor(sortedTimestamps.length / 2);
    const centroid = new Date(sortedTimestamps[medianIndex]);

    return {
      events,
      timeRange: { start, end },
      actors,
      targets,
      density,
      centroid
    };
  }

  /**
   * Analyze a cluster to identify potential pressures
   */
  private analyzeClusterForPressures(cluster: EventCluster): InferredPressure[] {
    const pressures: InferredPressure[] = [];
    
    // Analyze for different pressure types
    const economicPressure = this.detectEconomicPressure(cluster);
    if (economicPressure) pressures.push(economicPressure);
    
    const socialPressure = this.detectSocialPressure(cluster);
    if (socialPressure) pressures.push(socialPressure);
    
    const politicalPressure = this.detectPoliticalPressure(cluster);
    if (politicalPressure) pressures.push(politicalPressure);
    
    const environmentalPressure = this.detectEnvironmentalPressure(cluster);
    if (environmentalPressure) pressures.push(environmentalPressure);

    return pressures;
  }

  /**
   * Detect economic pressure patterns in a cluster
   */
  private detectEconomicPressure(cluster: EventCluster): InferredPressure | null {
    const economicKeywords = ['trade', 'market', 'economy', 'financial', 'commerce', 'tax', 'currency', 'debt', 'inflation', 'recession', 'stock', 'bank', 'unemployment', 'industrial', 'production'];
    const economicEvents = cluster.events.filter(event => 
      economicKeywords.some(keyword => 
        event.description.toLowerCase().includes(keyword) ||
        event.actor.toLowerCase().includes(keyword) ||
        event.target.toLowerCase().includes(keyword)
      )
    );

    if (economicEvents.length < 2) return null;

    const confidence = this.calculateConfidenceScore(economicEvents, cluster.events, cluster.density);
    if (confidence < this.MEDIUM_CONFIDENCE_THRESHOLD) return null;

    const evidence = economicEvents.map(e => `Event: ${e.description} (${e.timestamp.toISOString()})`);
    
    return new InferredPressure({
      description: `Economic pressure detected in cluster from ${cluster.timeRange.start.toDateString()} to ${cluster.timeRange.end.toDateString()}`,
      confidence_score: confidence,
      pressure_type: 'economic',
      evidence
    });
  }

  /**
   * Detect social pressure patterns in a cluster
   */
  private detectSocialPressure(cluster: EventCluster): InferredPressure | null {
    const socialKeywords = ['protest', 'movement', 'social', 'community', 'public', 'civil', 'rights', 'demonstration', 'uprising', 'reform'];
    const socialEvents = cluster.events.filter(event => 
      socialKeywords.some(keyword => 
        event.description.toLowerCase().includes(keyword) ||
        event.actor.toLowerCase().includes(keyword) ||
        event.target.toLowerCase().includes(keyword)
      )
    );

    if (socialEvents.length < 2) return null;

    const confidence = this.calculateConfidenceScore(socialEvents, cluster.events, cluster.density);
    if (confidence < this.MEDIUM_CONFIDENCE_THRESHOLD) return null;

    const evidence = socialEvents.map(e => `Event: ${e.description} (${e.timestamp.toISOString()})`);
    
    return new InferredPressure({
      description: `Social pressure detected in cluster from ${cluster.timeRange.start.toDateString()} to ${cluster.timeRange.end.toDateString()}`,
      confidence_score: confidence,
      pressure_type: 'social',
      evidence
    });
  }

  /**
   * Detect political pressure patterns in a cluster
   */
  private detectPoliticalPressure(cluster: EventCluster): InferredPressure | null {
    const politicalKeywords = ['government', 'political', 'policy', 'law', 'election', 'parliament', 'congress', 'minister', 'president', 'legislation'];
    const politicalEvents = cluster.events.filter(event => 
      politicalKeywords.some(keyword => 
        event.description.toLowerCase().includes(keyword) ||
        event.actor.toLowerCase().includes(keyword) ||
        event.target.toLowerCase().includes(keyword)
      )
    );

    if (politicalEvents.length < 2) return null;

    const confidence = this.calculateConfidenceScore(politicalEvents, cluster.events, cluster.density);
    if (confidence < this.MEDIUM_CONFIDENCE_THRESHOLD) return null;

    const evidence = politicalEvents.map(e => `Event: ${e.description} (${e.timestamp.toISOString()})`);
    
    return new InferredPressure({
      description: `Political pressure detected in cluster from ${cluster.timeRange.start.toDateString()} to ${cluster.timeRange.end.toDateString()}`,
      confidence_score: confidence,
      pressure_type: 'political',
      evidence
    });
  }

  /**
   * Detect environmental pressure patterns in a cluster
   */
  private detectEnvironmentalPressure(cluster: EventCluster): InferredPressure | null {
    const environmentalKeywords = ['climate', 'environment', 'pollution', 'natural', 'disaster', 'weather', 'drought', 'flood', 'earthquake', 'resource'];
    const environmentalEvents = cluster.events.filter(event => 
      environmentalKeywords.some(keyword => 
        event.description.toLowerCase().includes(keyword) ||
        event.actor.toLowerCase().includes(keyword) ||
        event.target.toLowerCase().includes(keyword)
      )
    );

    if (environmentalEvents.length < 2) return null;

    const confidence = this.calculateConfidenceScore(environmentalEvents, cluster.events, cluster.density);
    if (confidence < this.MEDIUM_CONFIDENCE_THRESHOLD) return null;

    const evidence = environmentalEvents.map(e => `Event: ${e.description} (${e.timestamp.toISOString()})`);
    
    return new InferredPressure({
      description: `Environmental pressure detected in cluster from ${cluster.timeRange.start.toDateString()} to ${cluster.timeRange.end.toDateString()}`,
      confidence_score: confidence,
      pressure_type: 'environmental',
      evidence
    });
  }

  /**
   * Calculate confidence score based on event density and relationships
   */
  private calculateConfidenceScore(relevantEvents: Event[], allEvents: Event[], clusterDensity: number): number {
    const relevanceRatio = relevantEvents.length / allEvents.length;
    const densityBonus = clusterDensity * 0.2;
    const sizeBonus = Math.min(0.3, relevantEvents.length * 0.1);
    
    // Base confidence starts higher for keyword matches
    const baseConfidence = 0.4;
    
    return Math.min(1.0, baseConfidence + relevanceRatio * 0.3 + densityBonus + sizeBonus);
  }

  /**
   * Calculate overlap ratio between two sets
   */
  private calculateOverlapRatio(set1: Set<string>, set2: Set<string>): number {
    const intersection = new Set([...set1].filter(x => set2.has(x)));
    const union = new Set([...set1, ...set2]);
    return union.size > 0 ? intersection.size / union.size : 0;
  }

  /**
   * Evaluate potential causal relationship between two events
   */
  private evaluateCausalRelationship(causeEvent: Event, effectEvent: Event): CausalSuggestion | null {
    // Check temporal ordering (cause must precede effect)
    if (causeEvent.timestamp >= effectEvent.timestamp) {
      return null;
    }

    // Check temporal proximity (events should be reasonably close in time)
    const timeDiff = effectEvent.timestamp.getTime() - causeEvent.timestamp.getTime();
    if (timeDiff > this.TEMPORAL_WINDOW_MS) {
      return null;
    }

    // Calculate relationship strength based on various factors
    const actorTargetMatch = this.calculateActorTargetSimilarity(causeEvent, effectEvent);
    const temporalProximity = this.calculateTemporalProximity(timeDiff);
    const contextualSimilarity = this.calculateContextualSimilarity(causeEvent, effectEvent);
    
    const confidence = (actorTargetMatch * 0.4) + (temporalProximity * 0.3) + (contextualSimilarity * 0.3);
    
    if (confidence < 0.2) {
      return null;
    }

    // Determine relationship type based on confidence and characteristics
    let relationshipType: CausalRelationshipType = 'indirect';
    if (confidence > 0.5 && actorTargetMatch > 0.3) {
      relationshipType = 'direct';
    } else if (confidence > 0.3) {
      relationshipType = 'contributory';
    }

    return {
      cause_event_id: causeEvent.id,
      effect_event_id: effectEvent.id,
      suggested_relationship: {
        weight: confidence,
        evidence: `Temporal proximity and actor-target relationship suggest causal link`,
        confidence,
        relationship_type: relationshipType
      },
      reasoning: `Events show ${relationshipType} causal relationship based on temporal proximity (${Math.round(timeDiff / (24 * 60 * 60 * 1000))} days apart) and actor-target similarity (${Math.round(actorTargetMatch * 100)}% match)`
    };
  }

  /**
   * Calculate similarity between actors and targets of two events
   */
  private calculateActorTargetSimilarity(event1: Event, event2: Event): number {
    let similarity = 0;
    
    // Direct actor-target connections
    if (event1.actor === event2.actor) similarity += 0.3;
    if (event1.target === event2.target) similarity += 0.3;
    if (event1.target === event2.actor) similarity += 0.4; // Target becomes actor
    if (event1.actor === event2.target) similarity += 0.2; // Actor becomes target
    
    return Math.min(1.0, similarity);
  }

  /**
   * Calculate temporal proximity score (closer events have higher scores)
   */
  private calculateTemporalProximity(timeDiffMs: number): number {
    const maxTime = this.TEMPORAL_WINDOW_MS;
    return Math.max(0, 1 - (timeDiffMs / maxTime));
  }

  /**
   * Calculate contextual similarity based on description keywords
   */
  private calculateContextualSimilarity(event1: Event, event2: Event): number {
    const words1 = this.extractKeywords(event1.description);
    const words2 = this.extractKeywords(event2.description);
    
    if (words1.length === 0 || words2.length === 0) return 0;
    
    const intersection = words1.filter(word => words2.includes(word));
    const union = [...new Set([...words1, ...words2])];
    
    return intersection.length / union.length;
  }

  /**
   * Extract meaningful keywords from text
   */
  private extractKeywords(text: string): string[] {
    const stopWords = new Set(['the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'is', 'was', 'are', 'were', 'be', 'been', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should']);
    
    return text
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(word => word.length > 2 && !stopWords.has(word))
      .slice(0, 10); // Limit to top 10 keywords
  }

  /**
   * Update pressure confidence based on new evidence
   */
  updatePressureConfidence(pressure: InferredPressure, newEvidence: Event[]): InferredPressure {
    if (newEvidence.length === 0) {
      return pressure;
    }

    // Analyze new evidence for relevance to the pressure type
    const relevantEvidence = this.filterRelevantEvidence(newEvidence, pressure.pressure_type);
    
    if (relevantEvidence.length === 0) {
      return pressure;
    }

    // Calculate confidence adjustment based on new evidence
    const evidenceStrength = this.calculateEvidenceStrength(relevantEvidence, pressure.pressure_type);
    const currentConfidence = pressure.confidence_score;
    
    // Apply Bayesian-like update: new confidence is weighted average of old and new evidence
    const evidenceWeight = Math.min(0.4, relevantEvidence.length * 0.15); // Cap influence of new evidence
    const updatedConfidence = Math.min(1.0, 
      Math.max(currentConfidence, currentConfidence * (1 - evidenceWeight) + evidenceStrength * evidenceWeight)
    );

    // Add new evidence descriptions
    const newEvidenceDescriptions = relevantEvidence.map(e => 
      `Event: ${e.description} (${e.timestamp.toISOString()})`
    );

    return pressure.addEvidence(newEvidenceDescriptions, updatedConfidence);
  }

  /**
   * Run periodic inference to update pressures
   * This would typically be called by a background job
   */
  runPeriodicInference(): void {
    // This is a placeholder for a background process that would:
    // 1. Fetch recent events from the database
    // 2. Analyze them for new patterns
    // 3. Update existing pressure confidences
    // 4. Create new pressure inferences
    
    // In a real implementation, this would integrate with the repository layer
    console.log('Periodic inference would run here - requires database integration');
  }

  /**
   * Create DRIVEN_BY relationships between arcs and inferred pressures
   */
  linkPressuresToArcs(pressures: InferredPressure[], arcIds: string[]): DrivenByRelationship[] {
    const relationships: DrivenByRelationship[] = [];

    for (const pressure of pressures) {
      for (const arcId of arcIds) {
        // Calculate influence strength based on pressure confidence and type
        const influenceStrength = this.calculateInfluenceStrength(pressure, arcId);
        
        if (influenceStrength > 0.3) { // Only create relationships with meaningful influence
          relationships.push({
            influence_strength: influenceStrength
          });
        }
      }
    }

    return relationships;
  }

  /**
   * Filter events that are relevant to a specific pressure type
   */
  private filterRelevantEvidence(events: Event[], pressureType: PressureType): Event[] {
    const keywords = this.getKeywordsForPressureType(pressureType);
    
    return events.filter(event => 
      keywords.some(keyword => 
        event.description.toLowerCase().includes(keyword) ||
        event.actor.toLowerCase().includes(keyword) ||
        event.target.toLowerCase().includes(keyword)
      )
    );
  }

  /**
   * Get keywords for a specific pressure type
   */
  private getKeywordsForPressureType(pressureType: PressureType): string[] {
    switch (pressureType) {
      case 'economic':
        return ['trade', 'market', 'economy', 'financial', 'commerce', 'tax', 'currency', 'debt', 'inflation', 'recession', 'stock', 'bank', 'unemployment', 'industrial', 'production'];
      case 'social':
        return ['protest', 'movement', 'social', 'community', 'public', 'civil', 'rights', 'demonstration', 'uprising', 'reform'];
      case 'political':
        return ['government', 'political', 'policy', 'law', 'election', 'parliament', 'congress', 'minister', 'president', 'legislation'];
      case 'environmental':
        return ['climate', 'environment', 'pollution', 'natural', 'disaster', 'weather', 'drought', 'flood', 'earthquake', 'resource'];
      default:
        return [];
    }
  }

  /**
   * Calculate evidence strength for new events
   */
  private calculateEvidenceStrength(events: Event[], pressureType: PressureType): number {
    const keywords = this.getKeywordsForPressureType(pressureType);
    let totalStrength = 0;

    for (const event of events) {
      const matchingKeywords = keywords.filter(keyword =>
        event.description.toLowerCase().includes(keyword) ||
        event.actor.toLowerCase().includes(keyword) ||
        event.target.toLowerCase().includes(keyword)
      );

      // Strength based on keyword matches and description length
      const keywordStrength = Math.min(1.0, matchingKeywords.length * 0.2);
      const descriptionStrength = Math.min(0.3, event.description.length / 200); // Longer descriptions may be more detailed
      
      totalStrength += keywordStrength + descriptionStrength;
    }

    return Math.min(1.0, totalStrength / events.length);
  }

  /**
   * Calculate influence strength between a pressure and an arc
   */
  private calculateInfluenceStrength(pressure: InferredPressure, arcId: string): number {
    // Base influence on pressure confidence
    let influence = pressure.confidence_score * 0.7;
    
    // Add bonus for high-confidence pressures
    if (pressure.confidence_score > this.HIGH_CONFIDENCE_THRESHOLD) {
      influence += 0.2;
    }
    
    // Add bonus based on evidence quantity
    const evidenceBonus = Math.min(0.1, pressure.evidence.length * 0.02);
    influence += evidenceBonus;

    return Math.min(1.0, influence);
  }
}