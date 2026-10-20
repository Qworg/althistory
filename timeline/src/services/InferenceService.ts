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
 * Event shape required to build arc suggestions.
 *
 * Contract: `timestamp` is already a parsed `Date`. The service neither
 * validates nor transforms the input -- a malformed date reaches the
 * algorithm as an Invalid Date -- so the caller has to reject it. The route
 * does not do that yet, which is a known gap, not a guarantee of this
 * contract.
 */
export interface ArcClusterEvent {
  id: string;
  description: string;
  actor: string;
  target: string;
  timestamp: Date;
}

/**
 * An API-friendly arc suggestion: a group of events that a user may promote
 * into a narrative arc. The shape IS the wire format of
 * `POST /api/suggest/arcs` -- the route passes it through unchanged -- so it
 * is deliberately flat and free of model classes. A change here is a change to
 * the public API.
 */
export interface ArcSuggestion {
  name: string;
  description: string;
  start_time: string;
  end_time: string;
  eventIds: string[];
  confidence: number;
  reason: string;
}

/**
 * Minimal event shape required to analyze graph completeness.
 *
 * Contract: `timestamp` is an ISO-8601 string; the service parses it so the
 * caller does not have to. Events are treated as immutable.
 */
export interface CompletenessEvent {
  id: string;
  description: string;
  actor: string;
  target: string;
  timestamp: string;
}

/**
 * A causal relationship as far as completeness analysis is concerned: only the
 * two endpoint ids matter.
 */
export interface CausalRelationshipRef {
  cause_event_id: string;
  effect_event_id: string;
}

/** A period of time longer than the temporal gap threshold with no events. */
export interface TemporalGap {
  start: string;
  end: string;
  durationDays: number;
  suggestion: string;
}

/** An actor that has not been seen for longer than the actor gap threshold. */
export interface ActorGap {
  actor: string;
  lastSeen: string;
  daysSinceLastSeen: number;
  suggestion: string;
}

/** An event that is missing a cause and/or an effect relationship. */
export interface CausalGap {
  eventId: string;
  description: string;
  missingCause: boolean;
  missingEffect: boolean;
  suggestion: string;
}

/**
 * The result of a completeness analysis: the gaps that were found, an overall
 * completeness score in [0, 1] and human-readable suggestions.
 */
export interface CompletenessResponse {
  gaps: {
    temporalGaps: TemporalGap[];
    actorGaps: ActorGap[];
    causalGaps: CausalGap[];
  };
  overallCompleteness: number;
  suggestions: string[];
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

  // Completeness analysis thresholds (in days)
  private readonly TEMPORAL_GAP_THRESHOLD_DAYS = 90;
  private readonly ACTOR_GAP_THRESHOLD_DAYS = 180;

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
   * Group events into candidate narrative arcs by temporal proximity.
   *
   * Contract:
   * - Input: events with already-parsed `Date` timestamps, a window size in
   *   days and the smallest number of events a group must contain to be
   *   reported.
   * - Clustering is adjacency-based: consecutive events (after sorting by
   *   timestamp) stay in the same group while the distance to the previous
   *   event is at most `temporalWindowDays`. A chain of close events therefore
   *   forms one group even when its total span exceeds the window.
   * - Groups smaller than `minClusterSize` are dropped.
   * - Output: one `ArcSuggestion` per surviving group, in chronological order.
   *   The service neither validates nor transforms the input; a caller that
   *   passes a malformed date gets an Invalid Date back, not an error.
   */
  clusterEventsIntoArcs(
    events: ArcClusterEvent[],
    temporalWindowDays: number,
    minClusterSize: number
  ): ArcSuggestion[] {
    if (events.length === 0) {
      return [];
    }

    const suggestions: ArcSuggestion[] = [];
    const windowMs = temporalWindowDays * 24 * 60 * 60 * 1000;

    // Sort events by timestamp
    const sortedEvents = [...events].sort(
      (a, b) => a.timestamp.getTime() - b.timestamp.getTime()
    );

    // Cluster by temporal proximity
    const clusters: ArcClusterEvent[][] = [];
    let currentCluster: ArcClusterEvent[] = [sortedEvents[0]];

    for (let i = 1; i < sortedEvents.length; i++) {
      const prevTime = sortedEvents[i - 1].timestamp.getTime();
      const currTime = sortedEvents[i].timestamp.getTime();

      if (currTime - prevTime <= windowMs) {
        currentCluster.push(sortedEvents[i]);
      } else {
        if (currentCluster.length >= minClusterSize) {
          clusters.push(currentCluster);
        }
        currentCluster = [sortedEvents[i]];
      }
    }

    if (currentCluster.length >= minClusterSize) {
      clusters.push(currentCluster);
    }

    // Create arc suggestions for each cluster
    for (const cluster of clusters) {
      const startTime = cluster[0].timestamp;
      const endTime = cluster[cluster.length - 1].timestamp;
      const actors = [...new Set(cluster.map((e) => e.actor))];
      const durationDays = Math.ceil(
        (endTime.getTime() - startTime.getTime()) / (24 * 60 * 60 * 1000)
      );

      // Generate a descriptive name based on actors and time
      const actorStr = actors.length <= 2 ? actors.join(' & ') : `${actors.length} actors`;
      const name = `${actorStr} (${durationDays} days)`;

      suggestions.push({
        name,
        description: `Cluster of ${cluster.length} events involving ${actorStr}`,
        start_time: startTime.toISOString(),
        end_time: endTime.toISOString(),
        eventIds: cluster.map((e) => e.id),
        confidence: Math.min(0.9, 0.5 + cluster.length * 0.05),
        reason: `${cluster.length} temporally related events within ${temporalWindowDays}-day window`,
      });
    }

    return suggestions;
  }

  /**
   * Analyze how complete a graph is: which periods, actors and events are
   * missing coverage.
   *
   * Contract:
   * - Input: events with ISO-8601 `timestamp` strings plus the causal
   *   relationships that exist between them (only endpoint ids are used).
   * - Events are sorted by timestamp before the analysis; the first and last
   *   event are never reported as missing a cause or an effect, because it is
   *   natural for a boundary event to have only one side.
   * - Output: a `CompletenessResponse` with the temporal, actor and causal
   *   gaps that were found, an `overallCompleteness` score in [0, 1] and
   *   human-readable suggestions. The response is always populated, including
   *   for an empty graph.
   */
  analyzeCompleteness(
    events: CompletenessEvent[],
    relationships: CausalRelationshipRef[]
  ): CompletenessResponse {
    const response: CompletenessResponse = {
      gaps: {
        temporalGaps: [],
        actorGaps: [],
        causalGaps: [],
      },
      overallCompleteness: 0,
      suggestions: [],
    };

    if (events.length === 0) {
      response.suggestions.push('No events found. Start by adding historical events.');
      return response;
    }

    // Sort events by timestamp
    const sortedEvents = [...events].sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );

    // Find temporal gaps (periods > TEMPORAL_GAP_THRESHOLD_DAYS with no events)
    const temporalGapThreshold = this.daysToMs(this.TEMPORAL_GAP_THRESHOLD_DAYS);
    for (let i = 1; i < sortedEvents.length; i++) {
      const prevTime = new Date(sortedEvents[i - 1].timestamp).getTime();
      const currTime = new Date(sortedEvents[i].timestamp).getTime();
      const gap = currTime - prevTime;

      if (gap > temporalGapThreshold) {
        const durationDays = Math.round(gap / (24 * 60 * 60 * 1000));
        response.gaps.temporalGaps.push({
          start: sortedEvents[i - 1].timestamp,
          end: sortedEvents[i].timestamp,
          durationDays,
          suggestion: `Consider adding events for the ${durationDays}-day period between these events`,
        });
      }
    }

    // Find actor gaps (actors not seen in last 180 days)
    const actorLastSeen = new Map<string, string>();
    for (const event of sortedEvents) {
      actorLastSeen.set(event.actor, event.timestamp);
    }

    const latestEventTime = new Date(sortedEvents[sortedEvents.length - 1].timestamp).getTime();
    const actorGapThreshold = this.daysToMs(this.ACTOR_GAP_THRESHOLD_DAYS);

    for (const [actor, lastSeen] of actorLastSeen) {
      const lastSeenTime = new Date(lastSeen).getTime();
      const gap = latestEventTime - lastSeenTime;

      if (gap > actorGapThreshold) {
        const daysSince = Math.round(gap / (24 * 60 * 60 * 1000));
        response.gaps.actorGaps.push({
          actor,
          lastSeen,
          daysSinceLastSeen: daysSince,
          suggestion: `Actor "${actor}" hasn't appeared in ${daysSince} days. Consider adding recent events.`,
        });
      }
    }

    // Find causal gaps (events with no causes or effects)
    const causesSet = new Set(relationships.map((r) => r.effect_event_id));
    const effectsSet = new Set(relationships.map((r) => r.cause_event_id));

    // Skip first and last events (natural to not have cause/effect)
    for (let i = 1; i < sortedEvents.length - 1; i++) {
      const event = sortedEvents[i];
      const hasCause = causesSet.has(event.id);
      const hasEffect = effectsSet.has(event.id);

      if (!hasCause || !hasEffect) {
        response.gaps.causalGaps.push({
          eventId: event.id,
          description: event.description.substring(0, 100),
          missingCause: !hasCause,
          missingEffect: !hasEffect,
          suggestion: !hasCause && !hasEffect
            ? 'Consider adding both cause and effect relationships'
            : !hasCause
              ? 'Consider adding a cause relationship'
              : 'Consider adding an effect relationship',
        });
      }
    }

    // Calculate overall completeness score
    let completenessScore = 1.0;

    // Deduct for temporal gaps
    completenessScore -= Math.min(0.3, response.gaps.temporalGaps.length * 0.1);

    // Deduct for actor gaps
    completenessScore -= Math.min(0.2, response.gaps.actorGaps.length * 0.05);

    // Deduct for causal gaps
    const causalGapRatio = response.gaps.causalGaps.length / Math.max(1, events.length - 2);
    completenessScore -= Math.min(0.4, causalGapRatio * 0.4);

    // Bonus for having relationships
    if (relationships.length > 0) {
      const relationshipRatio = relationships.length / events.length;
      completenessScore = Math.min(1.0, completenessScore + relationshipRatio * 0.1);
    }

    response.overallCompleteness = Math.max(0, Math.min(1, completenessScore));

    // Generate overall suggestions
    if (response.gaps.temporalGaps.length > 0) {
      response.suggestions.push(
        `Found ${response.gaps.temporalGaps.length} temporal gap(s). Consider adding events to fill these periods.`
      );
    }

    if (response.gaps.actorGaps.length > 0) {
      response.suggestions.push(
        `${response.gaps.actorGaps.length} actor(s) haven't appeared recently. Consider adding their recent activities.`
      );
    }

    if (response.gaps.causalGaps.length > 0) {
      response.suggestions.push(
        `${response.gaps.causalGaps.length} event(s) lack causal relationships. Consider adding connections.`
      );
    }

    if (events.length > 0 && relationships.length === 0) {
      response.suggestions.push(
        'No causal relationships defined. Add relationships between events to show cause and effect.'
      );
    }

    if (response.suggestions.length === 0) {
      response.suggestions.push('Graph looks complete! Consider reviewing for accuracy.');
    }

    return response;
  }

  /**
   * Convert days to milliseconds
   */
  private daysToMs(days: number): number {
    return days * 24 * 60 * 60 * 1000;
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
  private calculateInfluenceStrength(pressure: InferredPressure, _arcId: string): number {
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