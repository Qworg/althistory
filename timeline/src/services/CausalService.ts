import { Event } from '@/models';
import { CausalRelationship, CausalPath, CausalCycle, CausalSuggestion, CausalValidationResult } from '@/models/relationships';
import { getDatabaseManager } from '@/utils/database';
import { CausalParadoxError, ValidationError, DatabaseError } from '@/utils/errors';
import { getCacheManager, CacheKeyGenerator } from '@/utils/cache';
import { CacheInvalidationService } from './CacheInvalidationService';

/**
 * Service for managing causal relationships and chain analysis
 */
export class CausalService {
  private cacheManager = getCacheManager();
  private cacheInvalidationService = new CacheInvalidationService();
  /**
   * Create a causal link between two events
   * Validates the relationship and prevents temporal paradoxes
   */
  async createCausalLink(cause: Event, effect: Event, relationship: CausalRelationship): Promise<void> {
    // Validate the causal relationship
    const validation = this.validateCausalRelationship(cause, effect, relationship);
    if (!validation.isValid) {
      throw new ValidationError(
        `Causal relationship validation failed: ${validation.errors.join(', ')}`,
        'causalRelationship',
        relationship,
        validation.errors
      );
    }

    // Check for temporal paradox
    this.preventTemporalParadox(cause, effect);

    // Create the relationship in the database
    await this.storeCausalRelationship(cause, effect, relationship);

    // Invalidate related cache entries
    await this.cacheInvalidationService.invalidateCausalCache();
  }

  /**
   * Find causal chain starting from an event with configurable depth traversal and caching
   */
  async findCausalChain(startEvent: Event, maxDepth: number): Promise<CausalPath[]> {
    if (maxDepth <= 0) {
      throw new ValidationError('Max depth must be greater than 0', 'maxDepth', maxDepth);
    }

    const cacheKey = CacheKeyGenerator.causalChain(startEvent.id, maxDepth);
    
    // Try to get from cache first
    const cachedResult = await this.cacheManager.get<CausalPath[]>(cacheKey);
    if (cachedResult) {
      return cachedResult;
    }

    const session = getDatabaseManager().getNeo4jSession();
    
    try {
      const query = `
        MATCH path = (start:Event {id: $startEventId})-[:CAUSES*1..${maxDepth}]->(end:Event)
        WITH path, relationships(path) as rels, nodes(path) as events
        RETURN 
          [event in events | event.id] as eventIds,
          [rel in rels | rel.weight] as weights,
          [rel in rels | {
            weight: rel.weight,
            evidence: rel.evidence,
            confidence: rel.confidence,
            relationship_type: rel.relationship_type
          }] as relationships,
          length(path) as depth
        ORDER BY length(path), reduce(s = 0, rel in rels | s + rel.weight) DESC
      `;

      const result = await session.run(query, {
        startEventId: startEvent.id
      });

      const paths: CausalPath[] = result.records.map(record => {
        const eventIds = record.get('eventIds') as string[];
        const weights = record.get('weights') as number[];
        const depth = record.get('depth') as number;
        
        const totalStrength = this.calculatePathStrength(weights);

        return {
          events: eventIds,
          total_strength: totalStrength,
          relationship_weights: weights,
          depth: depth
        };
      });

      // Cache the result
      await this.cacheManager.set(cacheKey, paths);

      return paths;
    } catch (error) {
      throw new DatabaseError(
        'Failed to find causal chains',
        'findCausalChain',
        error as Error
      );
    } finally {
      await session.close();
    }
  }

  /**
   * Calculate the strength of a causal path based on relationship weights
   */
  calculateCausalStrength(path: CausalPath): number {
    if (!path.relationship_weights || path.relationship_weights.length === 0) {
      return 0;
    }

    return this.calculatePathStrength(path.relationship_weights);
  }

  /**
   * Detect causal cycles that would create temporal paradoxes with caching
   */
  async detectCausalCycles(): Promise<CausalCycle[]> {
    const cacheKey = CacheKeyGenerator.causalCycles();
    
    // Try to get from cache first
    const cachedResult = await this.cacheManager.get<CausalCycle[]>(cacheKey);
    if (cachedResult) {
      return cachedResult;
    }

    const session = getDatabaseManager().getNeo4jSession();
    
    try {
      const query = `
        MATCH path = (start:Event)-[:CAUSES*2..]->(start)
        WITH path, relationships(path) as rels, nodes(path) as events
        WITH events, rels,
             [event in events | event.timestamp] as timestamps,
             [event in events | event.id] as eventIds
        WHERE any(i in range(0, size(timestamps)-2) WHERE timestamps[i] >= timestamps[i+1])
        RETURN 
          eventIds,
          [rel in rels | {
            weight: rel.weight,
            evidence: rel.evidence,
            confidence: rel.confidence,
            relationship_type: rel.relationship_type
          }] as relationships,
          reduce(severity = 0, i in range(0, size(timestamps)-2) | 
            CASE WHEN timestamps[i] >= timestamps[i+1] 
            THEN severity + 1 
            ELSE severity END
          ) as paradoxSeverity
        ORDER BY paradoxSeverity DESC
      `;

      const result = await session.run(query);

      const cycles: CausalCycle[] = result.records.map(record => {
        const eventIds = record.get('eventIds') as string[];
        const relationshipData = record.get('relationships') as any[];
        const paradoxSeverity = record.get('paradoxSeverity') as number;

        const relationships: CausalRelationship[] = relationshipData.map(rel => ({
          weight: rel.weight,
          evidence: rel.evidence,
          confidence: rel.confidence,
          relationship_type: rel.relationship_type
        }));

        return {
          events: eventIds,
          relationships: relationships,
          paradox_severity: paradoxSeverity
        };
      });

      // Cache the result with shorter expiration since cycles are critical
      await this.cacheManager.set(cacheKey, cycles, 60000); // 1 minute cache

      return cycles;
    } catch (error) {
      throw new DatabaseError(
        'Failed to detect causal cycles',
        'detectCausalCycles',
        error as Error
      );
    } finally {
      await session.close();
    }
  }

  /**
   * Validates a causal relationship between two events
   */
  private validateCausalRelationship(cause: Event, effect: Event, relationship: CausalRelationship): CausalValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Validate weight (0.0 to 1.0)
    if (typeof relationship.weight !== 'number' || relationship.weight < 0.0 || relationship.weight > 1.0) {
      errors.push('Weight must be a number between 0.0 and 1.0');
    }

    // Validate confidence (0.0 to 1.0)
    if (typeof relationship.confidence !== 'number' || relationship.confidence < 0.0 || relationship.confidence > 1.0) {
      errors.push('Confidence must be a number between 0.0 and 1.0');
    }

    // Validate evidence
    if (!relationship.evidence || typeof relationship.evidence !== 'string' || relationship.evidence.trim().length === 0) {
      errors.push('Evidence is required and must be a non-empty string');
    }

    // Validate relationship type
    const validTypes = ['direct', 'indirect', 'contributory'];
    if (!validTypes.includes(relationship.relationship_type)) {
      errors.push(`Relationship type must be one of: ${validTypes.join(', ')}`);
    }

    // Validate that cause and effect are different events
    if (cause.id === effect.id) {
      errors.push('An event cannot be causally related to itself');
    }

    // Check for reasonable confidence-weight relationship
    if (relationship.confidence < 0.5 && relationship.weight > 0.8) {
      warnings.push('High weight with low confidence may indicate uncertain causal relationship');
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings
    };
  }

  /**
   * Prevents temporal paradoxes by ensuring cause precedes effect
   */
  private preventTemporalParadox(cause: Event, effect: Event): void {
    if (cause.timestamp >= effect.timestamp) {
      throw new CausalParadoxError(
        `Causal paradox detected: cause event "${cause.id}" at ${cause.timestamp.toISOString()} cannot occur after or simultaneously with effect event "${effect.id}" at ${effect.timestamp.toISOString()}`,
        cause.id,
        effect.id,
        cause.timestamp,
        effect.timestamp
      );
    }
  }

  /**
   * Calculate the strength of a path based on relationship weights
   * Uses geometric mean to prevent single weak links from dominating
   */
  private calculatePathStrength(weights: number[]): number {
    if (weights.length === 0) {
      return 0;
    }

    // Use geometric mean for path strength calculation
    // This ensures that weak links significantly reduce overall strength
    const product = weights.reduce((acc, weight) => acc * weight, 1);
    return Math.pow(product, 1 / weights.length);
  }

  /**
   * Stores the causal relationship in the Neo4j database
   */
  private async storeCausalRelationship(cause: Event, effect: Event, relationship: CausalRelationship): Promise<void> {
    const session = getDatabaseManager().getNeo4jSession();
    
    try {
      const query = `
        MATCH (cause:Event {id: $causeId})
        MATCH (effect:Event {id: $effectId})
        CREATE (cause)-[r:CAUSES {
          weight: $weight,
          evidence: $evidence,
          confidence: $confidence,
          relationship_type: $relationshipType,
          created_at: datetime()
        }]->(effect)
        RETURN r
      `;

      const result = await session.run(query, {
        causeId: cause.id,
        effectId: effect.id,
        weight: relationship.weight,
        evidence: relationship.evidence,
        confidence: relationship.confidence,
        relationshipType: relationship.relationship_type
      });

      if (result.records.length === 0) {
        throw new DatabaseError(
          'Failed to create causal relationship - one or both events may not exist',
          'createCausalRelationship'
        );
      }
    } catch (error) {
      if (error instanceof DatabaseError) {
        throw error;
      }
      throw new DatabaseError(
        'Failed to store causal relationship in database',
        'createCausalRelationship',
        error as Error
      );
    } finally {
      await session.close();
    }
  }
}