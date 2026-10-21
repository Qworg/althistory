import { Event } from '@/models';
import { CausalRelationship, CausalPath, CausalCycle, CausalRelationshipType, CausalValidationResult } from '@/models/relationships';
import { getDatabaseManager, DatabaseManager, LocalDatabaseManager, LocalSession } from '@/utils/database';
import { LocalGraphStore, GraphProperties, GraphParameters } from '@/utils/LocalGraphStore';
import { CausalParadoxError, ValidationError, DatabaseError, NotFoundError } from '@/utils/errors';
import { getCacheManager, CacheKeyGenerator } from '@/utils/cache';
import { CacheInvalidationService } from './CacheInvalidationService';
import { loadConfig } from '@/utils/config';
import { isTemporalInversion, isSimultaneous } from '@/utils/causalOrder';

/**
 * Property bag accepted by `LocalGraphStore.updateRelationship` for a CAUSES edge.
 * Only the properties being changed are set, plus the `updated_at` stamp.
 */
type RelationshipUpdateProperties = {
  weight?: number;
  confidence?: number;
  evidence?: string;
  relationship_type?: string;
  updated_at?: string;
};

/**
 * Query parameters for the dynamic Neo4j SET clause built in updateCausalLink.
 */
type RelationshipQueryParams = RelationshipUpdateProperties & {
  causeEventId: string;
  effectEventId: string;
  relationshipType?: string;
};

/**
 * Shape of the relationship maps returned by the causal-cycle Cypher query.
 */
type StoredRelationshipProperties = {
  weight: number;
  evidence: string;
  confidence: number;
  relationship_type: CausalRelationshipType;
};

/**
 * Property bags are untyped by nature, so read the values this service knows how
 * to handle and fall back when the stored value has a different shape.
 */
function readNumberProperty(properties: GraphProperties, key: string, fallback: number): number {
  const value = properties[key];
  return typeof value === 'number' ? value : fallback;
}

function readStringProperty(properties: GraphProperties, key: string, fallback: string): string {
  const value = properties[key];
  return typeof value === 'string' ? value : fallback;
}

function readRelationshipTypeProperty(properties: GraphProperties, fallback: CausalRelationshipType): CausalRelationshipType {
  const value = properties.relationship_type;
  return typeof value === 'string' && isCausalRelationshipType(value) ? value : fallback;
}

function isCausalRelationshipType(value: string): value is CausalRelationshipType {
  return value === 'direct' || value === 'indirect' || value === 'contributory';
}

/**
 * A causal relationship as stored in the live store, including its identity.
 *
 * `createCausalLink` / `updateCausalLink` return this (local mode uses the
 * `LocalGraphStore` edge id; cloud mode has no comparable id, so it falls back
 * to a deterministic `cause->effect` key). Callers that bridge the live store to
 * the version store need the id, which the plain `CausalRelationship` lacks.
 */
export interface StoredCausalRelationship {
  id: string;
  cause_event_id: string;
  effect_event_id: string;
  weight: number;
  evidence: string;
  confidence: number;
  relationship_type: CausalRelationshipType;
}

/**
 * Additive construction options for graph-scoped causal access.
 *
 * Both fields are optional so every pre-existing `new CausalService()` caller
 * keeps resolving the process-wide singleton. A request-scoped caller supplies
 * the graph's live store and id so reads, writes and caches stay inside one
 * graph.
 */
export interface CausalServiceOptions {
  /** Live store this service is bound to. Defaults to the singleton's store. */
  graphStore?: LocalGraphStore;
  /** Graph id used to namespace cached results so they cannot cross graphs. */
  graphId?: string;
}

/**
 * The slice of a driver session this service uses. Both `neo4j-driver`'s
 * `Session` and the local `LocalSession` satisfy it, so a graph-bound session
 * and the singleton session can flow through one typed accessor without `any`.
 */
interface CausalSession {
  run(query: string, parameters?: GraphParameters): Promise<CausalQueryResult>;
  close(): Promise<void>;
}

/** Structural record surface shared by the Neo4j and local drivers. */
interface CausalQueryRecord {
  get(key: string): unknown;
}

/** Result set whose records expose {@link CausalQueryRecord}. */
interface CausalQueryResult {
  records: readonly CausalQueryRecord[];
}

/**
 * Service for managing causal relationships and chain analysis
 */
/**
 * The problems with a causal relationship's own fields.
 *
 * The CLI's dry run asks the same question, so that the dry run and the
 * real run count the same links.
 */
export function validateCausalRelationshipFields(relationship: CausalRelationship): string[] {
  const errors: string[] = [];

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

  return errors;
}

export class CausalService {
  private cacheManager = getCacheManager();
  private cacheInvalidationService = new CacheInvalidationService();
  private readonly graphStore?: LocalGraphStore;
  private readonly graphId?: string;

  constructor(options: CausalServiceOptions = {}) {
    this.graphStore = options.graphStore;
    this.graphId = options.graphId;
  }

  /**
   * `getDatabaseManager()` is declared to return `DatabaseManager`, but when local
   * execution is enabled the singleton it holds is a `LocalDatabaseManager`
   * (see `initializeDatabaseManager`). This widens the type to the union the
   * singleton can actually hold, so callers can narrow it with a real runtime
   * check instead of an unchecked assertion. (Widening has to happen in a return
   * position: annotating a `const` does not widen the initializer's flow type.)
   */
  private getDatabaseManagerOrThrow(): DatabaseManager | LocalDatabaseManager {
    return getDatabaseManager();
  }

  /**
   * Resolve the LocalGraphStore for local-execution mode.
   *
   * A graph-scoped service returns the store it was constructed with; an
   * unscoped service keeps resolving the process singleton.
   */
  private getLocalGraphStore(): LocalGraphStore {
    if (this.graphStore) {
      return this.graphStore;
    }
    const dbManager = this.getDatabaseManagerOrThrow();
    if (!(dbManager instanceof LocalDatabaseManager)) {
      throw new DatabaseError(
        'Local execution is enabled but the database manager is not a LocalDatabaseManager',
        'getLocalGraphStore'
      );
    }
    return dbManager.getGraphStore();
  }

  /**
   * Resolve a session over the same store the service reads and writes through.
   *
   * The path and cycle queries are expressed in Cypher and run over whichever
   * store is in scope. A graph-bound service must not borrow the process
   * singleton's session: in local mode that session wraps the legacy global
   * store, so the query would read another graph's relationships.
   */
  private getSession(): CausalSession {
    if (this.graphStore) {
      return new LocalSession(this.graphStore);
    }
    return getDatabaseManager().getNeo4jSession();
  }

  /**
   * Namespace a cache key by graph so a cached chain or cycle set cannot be
   * served to a different graph. The graph id is appended (not prefixed) so the
   * existing `causal:*` invalidation patterns still match.
   */
  private scopedCacheKey(key: string): string {
    return this.graphId ? `${key}:graph:${this.graphId}` : key;
  }
  /**
   * Create a causal link between two events
   * Validates the relationship and prevents temporal paradoxes
   */
  async createCausalLink(cause: Event, effect: Event, relationship: CausalRelationship): Promise<StoredCausalRelationship> {
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

    // The project's rule lets a cause and an effect share a moment, so the
    // ordering check on its own no longer keeps the graph acyclic. It still
    // does for everything but one case: every other link moves forward in
    // time, and a path that came back would have to move backwards. A link
    // between two events at the same moment is the one that can close a
    // cycle, so that is the case that has to be checked.
    //
    // This is a guard, not a guarantee: an event that is re-timed after its
    // link was made, a graph that came in through the importer, or two
    // requests at the same moment can still leave a cycle behind. The
    // validator and the merge are the backstop -- they report the cycles
    // they find.
    //
    // The walk reads every relationship the service can see, and in cloud
    // mode that is every graph's relationships: the cloud data model has no
    // graph filter on the relationships yet, so a scoped service still sees
    // the whole database. That is the gap #59 tracks.
    if (isSimultaneous(cause.timestamp, effect.timestamp)) {
      const cycle = await this.findPathBetween(effect.id, cause.id);
      if (cycle) {
        throw new CausalParadoxError(
          `Causal cycle detected: the link "${cause.id}" -> "${effect.id}" would close the cycle ${cycle.join(' -> ')}`,
          cause.id,
          effect.id,
          cause.timestamp,
          effect.timestamp
        );
      }
    }

    // Create the relationship in the database
    const storedRelationship = await this.storeCausalRelationship(cause, effect, relationship);

    // Invalidate related cache entries
    await this.cacheInvalidationService.invalidateCausalCache();

    return storedRelationship;
  }

  /**
   * The events on a path from one event to another, or null when there is
   * no such path.
   *
   * The relationships are read in full, which is enough: the check only
   * runs for a link between two events at the same moment, and it is the
   * only way a cycle can be closed under the project's rule.
   */
  private async findPathBetween(fromEventId: string, toEventId: string): Promise<string[] | null> {
    const relationships = await this.getAllRelationships();

    const adjacency = new Map<string, string[]>();
    for (const relationship of relationships) {
      const targets = adjacency.get(relationship.cause_event_id) ?? [];
      targets.push(relationship.effect_event_id);
      adjacency.set(relationship.cause_event_id, targets);
    }

    // The walk keeps its own stack rather than recursing: a chain of
    // thousands of events would overflow the call stack, and the check runs
    // on every same-moment link.
    const visited = new Set<string>([fromEventId]);
    const path: string[] = [fromEventId];
    const stack: Array<{ id: string; next: number }> = [{ id: fromEventId, next: 0 }];

    while (stack.length > 0) {
      const frame = stack[stack.length - 1]!;

      if (frame.id === toEventId) {
        return path;
      }

      const targets = adjacency.get(frame.id) ?? [];
      if (frame.next >= targets.length) {
        stack.pop();
        path.pop();
        continue;
      }

      const nextId = targets[frame.next]!;
      frame.next += 1;
      if (visited.has(nextId)) continue;

      visited.add(nextId);
      path.push(nextId);
      stack.push({ id: nextId, next: 0 });
    }

    return null;
  }

  /**
   * Delete a causal link between two events
   */
  async deleteCausalLink(causeEventId: string, effectEventId: string): Promise<string> {
    const config = loadConfig();

    if (config.localExecution.enabled) {
      // Local mode: use LocalGraphStore
      const graphStore = this.getLocalGraphStore();

      const relationship = await graphStore.findRelationshipByNodes(causeEventId, effectEventId, 'CAUSES');
      if (!relationship) {
        throw new NotFoundError(
          `Causal relationship from ${causeEventId} to ${effectEventId} not found`,
          'CausalRelationship',
          `${causeEventId}->${effectEventId}`
        );
      }

      await graphStore.deleteRelationship(relationship.id);
      await graphStore.save();

      // Invalidate related cache entries
      await this.cacheInvalidationService.invalidateCausalCache();

      return relationship.id;
    } else {
      // Cloud mode: use Neo4j
      const session = getDatabaseManager().getNeo4jSession();

      try {
        const query = `
          MATCH (cause:Event {id: $causeEventId})-[r:CAUSES]->(effect:Event {id: $effectEventId})
          DELETE r
          RETURN count(r) as deletedCount
        `;

        const result = await session.run(query, { causeEventId, effectEventId });
        const deletedCount = result.records[0]?.get('deletedCount')?.toNumber?.() || result.records[0]?.get('deletedCount') || 0;

        if (deletedCount === 0) {
          throw new NotFoundError(
            `Causal relationship from ${causeEventId} to ${effectEventId} not found`,
            'CausalRelationship',
            `${causeEventId}->${effectEventId}`
          );
        }
      } catch (error) {
        if (error instanceof NotFoundError) {
          throw error;
        }
        throw new DatabaseError(
          'Failed to delete causal relationship',
          'deleteCausalLink',
          error as Error
        );
      } finally {
        await session.close();
      }
    }

    // Invalidate related cache entries
    await this.cacheInvalidationService.invalidateCausalCache();

    // Cloud mode has no persistent edge id, so use a deterministic key. The
    // version store is a local-mode feature, so this value is only used when a
    // caller bridges the two stores in a hybrid setup.
    return `${causeEventId}->${effectEventId}`;
  }

  /**
   * Update a causal link between two events
   */
  async updateCausalLink(
    causeEventId: string,
    effectEventId: string,
    updates: Partial<CausalRelationship>
  ): Promise<StoredCausalRelationship> {
    // Validate update values
    if (updates.weight !== undefined && (updates.weight < 0 || updates.weight > 1)) {
      throw new ValidationError('Weight must be between 0.0 and 1.0', 'weight', updates.weight);
    }
    if (updates.confidence !== undefined && (updates.confidence < 0 || updates.confidence > 1)) {
      throw new ValidationError('Confidence must be between 0.0 and 1.0', 'confidence', updates.confidence);
    }
    if (updates.relationship_type !== undefined && !['direct', 'indirect', 'contributory'].includes(updates.relationship_type)) {
      throw new ValidationError('Relationship type must be direct, indirect, or contributory', 'relationship_type', updates.relationship_type);
    }

    const config = loadConfig();
    let updatedRelationship: StoredCausalRelationship;

    if (config.localExecution.enabled) {
      // Local mode: use LocalGraphStore
      const graphStore = this.getLocalGraphStore();

      const relationship = await graphStore.findRelationshipByNodes(causeEventId, effectEventId, 'CAUSES');
      if (!relationship) {
        throw new NotFoundError(
          `Causal relationship from ${causeEventId} to ${effectEventId} not found`,
          'CausalRelationship',
          `${causeEventId}->${effectEventId}`
        );
      }

      const updateProps: RelationshipUpdateProperties = {};
      if (updates.weight !== undefined) updateProps.weight = updates.weight;
      if (updates.confidence !== undefined) updateProps.confidence = updates.confidence;
      if (updates.evidence !== undefined) updateProps.evidence = updates.evidence;
      if (updates.relationship_type !== undefined) updateProps.relationship_type = updates.relationship_type;
      updateProps.updated_at = new Date().toISOString();

      const updated = await graphStore.updateRelationship(relationship.id, updateProps);
      await graphStore.save();

      const properties = updated ? updated.properties : relationship.properties;
      updatedRelationship = {
        id: relationship.id,
        cause_event_id: causeEventId,
        effect_event_id: effectEventId,
        weight: readNumberProperty(properties, 'weight', updates.weight ?? 0),
        evidence: readStringProperty(properties, 'evidence', updates.evidence ?? ''),
        confidence: readNumberProperty(properties, 'confidence', updates.confidence ?? 0),
        relationship_type: readRelationshipTypeProperty(
          properties,
          updates.relationship_type ?? 'direct'
        )
      };
    } else {
      // Cloud mode: use Neo4j
      const session = getDatabaseManager().getNeo4jSession();

      try {
        // Build SET clauses dynamically
        const setClauses: string[] = [];
        const params: RelationshipQueryParams = { causeEventId, effectEventId };

        if (updates.weight !== undefined) {
          setClauses.push('r.weight = $weight');
          params.weight = updates.weight;
        }
        if (updates.confidence !== undefined) {
          setClauses.push('r.confidence = $confidence');
          params.confidence = updates.confidence;
        }
        if (updates.evidence !== undefined) {
          setClauses.push('r.evidence = $evidence');
          params.evidence = updates.evidence;
        }
        if (updates.relationship_type !== undefined) {
          setClauses.push('r.relationship_type = $relationshipType');
          params.relationshipType = updates.relationship_type;
        }
        setClauses.push('r.updated_at = datetime()');

        const query = `
          MATCH (cause:Event {id: $causeEventId})-[r:CAUSES]->(effect:Event {id: $effectEventId})
          SET ${setClauses.join(', ')}
          RETURN r
        `;

        const result = await session.run(query, params);

        if (result.records.length === 0) {
          throw new NotFoundError(
            `Causal relationship from ${causeEventId} to ${effectEventId} not found`,
            'CausalRelationship',
            `${causeEventId}->${effectEventId}`
          );
        }

        const rel = result.records[0].get('r');
        updatedRelationship = {
          id: `${causeEventId}->${effectEventId}`,
          cause_event_id: causeEventId,
          effect_event_id: effectEventId,
          weight: rel.properties.weight,
          evidence: rel.properties.evidence,
          confidence: rel.properties.confidence,
          relationship_type: rel.properties.relationship_type
        };
      } catch (error) {
        if (error instanceof NotFoundError || error instanceof ValidationError) {
          throw error;
        }
        throw new DatabaseError(
          'Failed to update causal relationship',
          'updateCausalLink',
          error as Error
        );
      } finally {
        await session.close();
      }
    }

    // Invalidate related cache entries
    await this.cacheInvalidationService.invalidateCausalCache();

    return updatedRelationship;
  }

  /**
   * Get all causal relationships in the system
   */
  async getAllRelationships(): Promise<Array<{
    id: string;
    cause_event_id: string;
    effect_event_id: string;
    weight: number;
    confidence: number;
    evidence: string;
    relationship_type: string;
  }>> {
    const config = loadConfig();

    if (config.localExecution.enabled) {
      // Local mode: use LocalGraphStore
      const graphStore = this.getLocalGraphStore();

      const relationships = await graphStore.findRelationshipsByType('CAUSES');
      return relationships.map(rel => ({
        id: rel.id,
        cause_event_id: rel.startNodeId,
        effect_event_id: rel.endNodeId,
        weight: readNumberProperty(rel.properties, 'weight', 0.5),
        confidence: readNumberProperty(rel.properties, 'confidence', 0.7),
        evidence: readStringProperty(rel.properties, 'evidence', ''),
        relationship_type: readStringProperty(rel.properties, 'relationship_type', 'direct')
      }));
    } else {
      // Cloud mode: use Neo4j
      const session = getDatabaseManager().getNeo4jSession();

      try {
        const query = `
          MATCH (cause:Event)-[r:CAUSES]->(effect:Event)
          RETURN r.id as id, cause.id as cause_event_id, effect.id as effect_event_id,
                 r.weight as weight, r.confidence as confidence,
                 r.evidence as evidence, r.relationship_type as relationship_type
        `;

        const result = await session.run(query);

        return result.records.map(record => ({
          id: record.get('id'),
          cause_event_id: record.get('cause_event_id'),
          effect_event_id: record.get('effect_event_id'),
          weight: record.get('weight') || 0.5,
          confidence: record.get('confidence') || 0.7,
          evidence: record.get('evidence') || '',
          relationship_type: record.get('relationship_type') || 'direct'
        }));
      } catch (error) {
        throw new DatabaseError(
          'Failed to get causal relationships',
          'getAllRelationships',
          error as Error
        );
      } finally {
        await session.close();
      }
    }
  }

  /**
   * Find causal chain starting from an event with configurable depth traversal and caching
   */
  async findCausalChain(startEvent: Event, maxDepth: number): Promise<CausalPath[]> {
    if (maxDepth <= 0) {
      throw new ValidationError('Max depth must be greater than 0', 'maxDepth', maxDepth);
    }

    const cacheKey = this.scopedCacheKey(CacheKeyGenerator.causalChain(startEvent.id, maxDepth));
    
    // Try to get from cache first
    const cachedResult = await this.cacheManager.get<CausalPath[]>(cacheKey);
    if (cachedResult) {
      return cachedResult;
    }

    const session = this.getSession();
    
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
    const cacheKey = this.scopedCacheKey(CacheKeyGenerator.causalCycles());
    
    // Try to get from cache first
    const cachedResult = await this.cacheManager.get<CausalCycle[]>(cacheKey);
    if (cachedResult) {
      return cachedResult;
    }

    const session = this.getSession();
    
    try {
      // A cycle needs a hop that does not move forward in time. A hop
      // between two events at the same moment is such a hop, so the cycle is
      // found with ">=" -- but only a hop that really is inverted counts
      // towards the severity, because a simultaneous hop is allowed by the
      // project's rule.
      //
      // The comments are outside the query on purpose: Cypher has no `--`
      // comment syntax, and one would make Neo4j reject the whole query.
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
            CASE WHEN timestamps[i] > timestamps[i+1] 
            THEN severity + 1 
            ELSE severity END
          ) as paradoxSeverity
        ORDER BY paradoxSeverity DESC
      `;

      const result = await session.run(query);

      const cycles: CausalCycle[] = result.records.map(record => {
        const eventIds = record.get('eventIds') as string[];
        const relationshipData = record.get('relationships') as StoredRelationshipProperties[];
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

    errors.push(...validateCausalRelationshipFields(relationship));

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
   * Prevents temporal paradoxes by ensuring cause does not follow effect.
   *
   * A cause at the same moment as its effect is allowed: the two can be part
   * of the same occurrence. The rule lives in `@/utils/causalOrder`, which
   * every other path uses too.
   */
  private preventTemporalParadox(cause: Event, effect: Event): void {
    if (isTemporalInversion(cause.timestamp, effect.timestamp)) {
      throw new CausalParadoxError(
        `Causal paradox detected: cause event "${cause.id}" at ${cause.timestamp.toISOString()} cannot occur after effect event "${effect.id}" at ${effect.timestamp.toISOString()}`,
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
   * Stores the causal relationship in the database (supports local and cloud modes)
   */
  private async storeCausalRelationship(cause: Event, effect: Event, relationship: CausalRelationship): Promise<StoredCausalRelationship> {
    const config = loadConfig();

    if (config.localExecution.enabled) {
      // Local mode: use LocalGraphStore
      const graphStore = this.getLocalGraphStore();

      // Verify both events exist
      const causeNode = await graphStore.getNode(cause.id);
      const effectNode = await graphStore.getNode(effect.id);

      if (!causeNode || !effectNode) {
        throw new DatabaseError(
          'Failed to create causal relationship - one or both events may not exist',
          'createCausalRelationship'
        );
      }

      // Create the relationship
      const result = await graphStore.createRelationship(
        cause.id,
        effect.id,
        'CAUSES',
        {
          weight: relationship.weight,
          evidence: relationship.evidence,
          confidence: relationship.confidence,
          relationship_type: relationship.relationship_type,
          created_at: new Date().toISOString()
        }
      );

      if (!result) {
        throw new DatabaseError(
          'Failed to create causal relationship - nodes may not exist in local store',
          'createCausalRelationship'
        );
      }

      await graphStore.save();

      return {
        id: result.id,
        cause_event_id: cause.id,
        effect_event_id: effect.id,
        weight: relationship.weight,
        evidence: relationship.evidence,
        confidence: relationship.confidence,
        relationship_type: relationship.relationship_type
      };
    } else {
      // Cloud mode: use Neo4j
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

        // Cloud mode has no persistent edge id; callers that bridge to the
        // version store only do so in local mode.
        return {
          id: `${cause.id}->${effect.id}`,
          cause_event_id: cause.id,
          effect_event_id: effect.id,
          weight: relationship.weight,
          evidence: relationship.evidence,
          confidence: relationship.confidence,
          relationship_type: relationship.relationship_type
        };
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
}