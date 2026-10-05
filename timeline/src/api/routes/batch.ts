/**
 * Batch operations API routes
 */

import { Router, Request, Response, RequestHandler } from 'express';
import {
  AuthenticatedRequest,
  authenticate,
  requireAuth,
  authorize,
  rateLimit,
  authorizeGraphAccess,
  resolveGraphContext,
  asyncHandler,
} from '../middleware';
import { Permission } from '@/models/ApiKey';
import { IEvent } from '@/models/Event';
import { IArc } from '@/models/Arc';
import { CausalService } from '@/services/CausalService';
import { createLogger } from '@/utils/logger';

const logger = createLogger('BatchRoutes');

export const batchRoutes = Router();

/**
 * `CausalService` bound to the graph this request resolved to.
 *
 * The container exposes `graphScopedRepositories` but not yet a scoped causal
 * service, so build one from the same cached store those repositories use.
 * Binding it keeps batch relationship reads, writes and caches inside the
 * request's graph instead of the process-wide legacy store.
 */
async function graphScopedCausalService(req: Request): Promise<CausalService> {
  const store = await req.container.graphContextStore.getStore(req.graphId);
  return new CausalService({ graphStore: store, graphId: req.graphId });
}

// Batch operation types
type ValidationMode = 'strict' | 'lenient' | 'skip';
type ErrorHandlingMode = 'abort' | 'skip' | 'collect';

interface BatchEventRequest {
  graphId: string;
  events: Array<Omit<IEvent, 'id' | 'created_at' | 'updated_at'>>;
  validation?: ValidationMode;
  onError?: ErrorHandlingMode;
}

interface BatchArcRequest {
  graphId: string;
  arcs: Array<Omit<IArc, 'id' | 'created_at' | 'updated_at'>>;
  validation?: ValidationMode;
  onError?: ErrorHandlingMode;
}

interface BatchRelationshipRequest {
  graphId: string;
  relationships: Array<{
    cause_event_id: string;
    effect_event_id: string;
    weight?: number;
    evidence?: string;
    confidence?: number;
    relationship_type?: 'direct' | 'indirect' | 'contributory';
  }>;
  validation?: ValidationMode;
  onError?: ErrorHandlingMode;
}

interface BatchOperation {
  type:
    | 'create_event'
    | 'create_arc'
    | 'update_event'
    | 'update_arc'
    | 'delete_event'
    | 'delete_arc'
    | 'create_relationship'
    | 'update_relationship'
    | 'delete_relationship';
  data: Record<string, unknown>;
}

interface BatchTransactionRequest {
  graphId: string;
  operations: BatchOperation[];
  atomic?: boolean;
}

interface BatchResult {
  success: boolean;
  created: string[];
  failed: Array<{ index: number; error: string }>;
  validationWarnings?: Array<{ index: number; warning: string }>;
}

interface TransactionResult {
  success: boolean;
  results: Array<{ index: number; type: string; id?: string; success: boolean; error?: string }>;
  rollbackPerformed?: boolean;
}

const MAX_BATCH_SIZE = 1000;

/**
 * Standard error response format for batch operations
 */
interface BatchErrorResponse {
  error: {
    code: string;
    message: string;
    details?: {
      failedIndex?: number;
      created?: string[];
      path?: string;
      timestamp?: string;
    };
  };
}

/**
 * Create standardized batch error response
 */
function createBatchError(
  code: string,
  message: string,
  details?: BatchErrorResponse['error']['details']
): BatchErrorResponse {
  return {
    error: {
      code,
      message,
      details: {
        ...details,
        timestamp: new Date().toISOString(),
      },
    },
  };
}

/**
 * Batch create events
 * POST /api/batch/events
 */
batchRoutes.post(
  '/events',
  authenticate as RequestHandler,
  requireAuth as RequestHandler,
  authorize('write:events') as RequestHandler,
  rateLimit() as RequestHandler,
  resolveGraphContext() as RequestHandler,
  authorizeGraphAccess((req) => (req as AuthenticatedRequest).graphId) as RequestHandler,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const request = req.body as BatchEventRequest;

    // Validate request
    const validationError = validateBatchRequest(request, 'events');
    if (validationError) {
      return res.status(400).json(createBatchError('VALIDATION_ERROR', validationError));
    }

    const validation = request.validation || 'strict';
    const onError = request.onError || 'abort';
    const { graphId, events } = request;

    const result: BatchResult = {
      success: true,
      created: [],
      failed: [],
      validationWarnings: [],
    };

    const { eventRepository } = await req.container.graphScopedRepositories(req.graphId);

    for (let i = 0; i < events.length; i++) {
      const eventData = events[i];

      try {
        // Validate if not skipping
        if (validation !== 'skip') {
          const warnings = validateEventData(eventData);
          if (warnings.length > 0) {
            result.validationWarnings!.push(...warnings.map((w) => ({ index: i, warning: w })));
            
            if (validation === 'strict') {
              throw new Error(`Validation failed: ${warnings.join(', ')}`);
            }
          }
        }

        // Create the event
        const createdEvent = await eventRepository.create({
          ...eventData,
          metadata: {
            ...(eventData as Record<string, unknown>).metadata as Record<string, unknown>,
            graphId,
            batchImport: true,
          },
        } as Parameters<typeof eventRepository.create>[0]);

        result.created.push(createdEvent.id);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';

        if (onError === 'abort') {
          return res.status(400).json(createBatchError(
            'BATCH_ABORTED',
            `Batch aborted at index ${i}: ${errorMessage}`,
            { failedIndex: i, created: result.created }
          ));
        }

        result.failed.push({ index: i, error: errorMessage });
        result.success = false;
      }
    }

    // Set success based on failure count
    result.success = result.failed.length === 0;

    res.status(result.success ? 201 : 207).json(result);
  })
);

/**
 * Batch create arcs
 * POST /api/batch/arcs
 */
batchRoutes.post(
  '/arcs',
  authenticate as RequestHandler,
  requireAuth as RequestHandler,
  authorize('write:arcs') as RequestHandler,
  rateLimit() as RequestHandler,
  resolveGraphContext() as RequestHandler,
  authorizeGraphAccess((req) => (req as AuthenticatedRequest).graphId) as RequestHandler,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const request = req.body as BatchArcRequest;

    // Validate request
    const validationError = validateBatchRequest(request, 'arcs');
    if (validationError) {
      return res.status(400).json(createBatchError('VALIDATION_ERROR', validationError));
    }

    const validation = request.validation || 'strict';
    const onError = request.onError || 'abort';
    const { graphId, arcs } = request;

    const result: BatchResult = {
      success: true,
      created: [],
      failed: [],
      validationWarnings: [],
    };

    const { arcRepository } = await req.container.graphScopedRepositories(req.graphId);

    for (let i = 0; i < arcs.length; i++) {
      const arcData = arcs[i];

      try {
        // Validate if not skipping
        if (validation !== 'skip') {
          const warnings = validateArcData(arcData);
          if (warnings.length > 0) {
            result.validationWarnings!.push(...warnings.map((w) => ({ index: i, warning: w })));
            
            if (validation === 'strict') {
              throw new Error(`Validation failed: ${warnings.join(', ')}`);
            }
          }
        }

        // Create the arc
        const createdArc = await arcRepository.create({
          ...arcData,
          metadata: {
            ...(arcData as Record<string, unknown>).metadata as Record<string, unknown>,
            graphId,
            batchImport: true,
          },
        } as Parameters<typeof arcRepository.create>[0]);

        result.created.push(createdArc.id);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';

        if (onError === 'abort') {
          return res.status(400).json(createBatchError(
            'BATCH_ABORTED',
            `Batch aborted at index ${i}: ${errorMessage}`,
            { failedIndex: i, created: result.created }
          ));
        }

        result.failed.push({ index: i, error: errorMessage });
        result.success = false;
      }
    }

    result.success = result.failed.length === 0;

    res.status(result.success ? 201 : 207).json(result);
  })
);

/**
 * Batch create relationships
 * POST /api/batch/relationships
 */
batchRoutes.post(
  '/relationships',
  authenticate as RequestHandler,
  requireAuth as RequestHandler,
  authorize('write:relationships') as RequestHandler,
  rateLimit() as RequestHandler,
  resolveGraphContext() as RequestHandler,
  authorizeGraphAccess((req) => (req as AuthenticatedRequest).graphId) as RequestHandler,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const request = req.body as BatchRelationshipRequest;

    // Validate request
    const validationError = validateBatchRequest(request, 'relationships');
    if (validationError) {
      return res.status(400).json(createBatchError('VALIDATION_ERROR', validationError));
    }

    const validation = request.validation || 'strict';
    const onError = request.onError || 'abort';
    const { relationships } = request;

    const result: BatchResult = {
      success: true,
      created: [],
      failed: [],
      validationWarnings: [],
    };

    const causalService = await graphScopedCausalService(req);
    const { eventRepository } = await req.container.graphScopedRepositories(req.graphId);

    for (let i = 0; i < relationships.length; i++) {
      const relData = relationships[i];

      try {
        // Validate if not skipping
        if (validation !== 'skip') {
          const warnings = validateRelationshipData(relData);
          if (warnings.length > 0) {
            result.validationWarnings!.push(...warnings.map((w) => ({ index: i, warning: w })));
            
            if (validation === 'strict') {
              throw new Error(`Validation failed: ${warnings.join(', ')}`);
            }
          }
        }

        // Get cause and effect events
        const causeEvent = await eventRepository.findById(relData.cause_event_id);
        const effectEvent = await eventRepository.findById(relData.effect_event_id);

        if (!causeEvent) {
          throw new Error(`Cause event not found: ${relData.cause_event_id}`);
        }
        if (!effectEvent) {
          throw new Error(`Effect event not found: ${relData.effect_event_id}`);
        }

        // Create the relationship using createCausalLink
        await causalService.createCausalLink(
          causeEvent,
          effectEvent,
          {
            weight: relData.weight || 0.5,
            evidence: relData.evidence || '',
            confidence: relData.confidence || 0.5,
            relationship_type: relData.relationship_type || 'direct',
          }
        );

        // Generate relationship ID
        const relId = `${relData.cause_event_id}_${relData.effect_event_id}`;
        result.created.push(relId);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';

        if (onError === 'abort') {
          return res.status(400).json(createBatchError(
            'BATCH_ABORTED',
            `Batch aborted at index ${i}: ${errorMessage}`,
            { failedIndex: i, created: result.created }
          ));
        }

        result.failed.push({ index: i, error: errorMessage });
        result.success = false;
      }
    }

    result.success = result.failed.length === 0;

    res.status(result.success ? 201 : 207).json(result);
  })
);

/**
 * Determine required permissions based on operation types in transaction
 */
function getRequiredPermissions(operations: BatchOperation[]): Set<string> {
  const permissions = new Set<string>();
  
  for (const op of operations) {
    switch (op.type) {
      case 'create_event':
      case 'update_event':
      case 'delete_event':
        permissions.add('write:events');
        break;
      case 'create_arc':
      case 'update_arc':
      case 'delete_arc':
        permissions.add('write:arcs');
        break;
      case 'create_relationship':
      case 'update_relationship':
      case 'delete_relationship':
        permissions.add('write:relationships');
        break;
    }
  }
  
  return permissions;
}

/**
 * Batch transaction (atomic operations)
 * POST /api/batch/transaction
 * 
 * Permissions are checked dynamically based on operation types
 */
batchRoutes.post(
  '/transaction',
  authenticate as RequestHandler,
  requireAuth as RequestHandler,
  rateLimit() as RequestHandler,
  resolveGraphContext() as RequestHandler,
  authorizeGraphAccess((req) => (req as AuthenticatedRequest).graphId) as RequestHandler,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const request = req.body as BatchTransactionRequest;
    const { eventRepository, arcRepository } = await req.container.graphScopedRepositories(
      req.graphId
    );
    const causalService = await graphScopedCausalService(req);
    
    // Dynamic permission check based on operation types
    const requiredPermissions = getRequiredPermissions(request.operations || []);
    
    if (requiredPermissions.size > 0 && req.apiKey) {
      const missingPermissions = Array.from(requiredPermissions).filter(
        (p) => !req.apiKey!.hasPermission(p as Permission)
      );
      
      if (missingPermissions.length > 0) {
        return res.status(403).json(createBatchError(
          'PERMISSION_DENIED',
          `Missing required permissions: ${missingPermissions.join(', ')}`,
          { path: req.path }
        ));
      }
    }

    // Validate request
    if (!request.graphId) {
      return res.status(400).json(createBatchError('VALIDATION_ERROR', 'graphId is required'));
    }

    if (!request.operations || !Array.isArray(request.operations)) {
      return res.status(400).json(createBatchError('VALIDATION_ERROR', 'operations array is required'));
    }

    if (request.operations.length > MAX_BATCH_SIZE) {
      return res.status(400).json(createBatchError(
        'VALIDATION_ERROR',
        `Maximum ${MAX_BATCH_SIZE} operations per transaction`
      ));
    }

    const atomic = request.atomic !== false; // Default to atomic
    const { operations } = request;

    const result: TransactionResult = {
      success: true,
      results: [],
      rollbackPerformed: false,
    };

    const createdIds: Array<{ type: string; id: string }> = [];

    for (let i = 0; i < operations.length; i++) {
      const op = operations[i];
      let opResult: { success: boolean; id?: string; error?: string } = { success: false };

      try {
        switch (op.type) {
          case 'create_event': {
            const event = await eventRepository.create(
              op.data as unknown as Parameters<typeof eventRepository.create>[0]
            );
            opResult = { success: true, id: event.id };
            createdIds.push({ type: 'event', id: event.id });
            break;
          }

          case 'create_arc': {
            const arc = await arcRepository.create(
              op.data as unknown as Parameters<typeof arcRepository.create>[0]
            );
            opResult = { success: true, id: arc.id };
            createdIds.push({ type: 'arc', id: arc.id });
            break;
          }

          case 'update_event': {
            const { id: eventId, ...eventUpdates } = op.data as { id: string } & Record<string, unknown>;
            const updatedEvent = await eventRepository.update(eventId, eventUpdates);
            opResult = { success: !!updatedEvent, id: eventId };
            break;
          }

          case 'update_arc': {
            const { id: arcId, ...arcUpdates } = op.data as { id: string } & Record<string, unknown>;
            const updatedArc = await arcRepository.update(arcId, arcUpdates);
            opResult = { success: !!updatedArc, id: arcId };
            break;
          }

          case 'delete_event': {
            const deleteEventId = (op.data as { id: string }).id;
            const deletedEvent = await eventRepository.delete(deleteEventId);
            opResult = { success: deletedEvent, id: deleteEventId };
            break;
          }

          case 'delete_arc': {
            const deleteArcId = (op.data as { id: string }).id;
            const deletedArc = await arcRepository.delete(deleteArcId);
            opResult = { success: deletedArc, id: deleteArcId };
            break;
          }

          case 'create_relationship': {
            const relData = op.data as {
              cause_event_id: string;
              effect_event_id: string;
              weight?: number;
              evidence?: string;
              confidence?: number;
              relationship_type?: 'direct' | 'indirect' | 'contributory';
            };
            const causeEvent = await eventRepository.findById(relData.cause_event_id);
            const effectEvent = await eventRepository.findById(relData.effect_event_id);
            if (!causeEvent) throw new Error(`Cause event not found: ${relData.cause_event_id}`);
            if (!effectEvent) throw new Error(`Effect event not found: ${relData.effect_event_id}`);
            await causalService.createCausalLink(causeEvent, effectEvent, {
              weight: relData.weight || 0.5,
              evidence: relData.evidence || '',
              confidence: relData.confidence || 0.5,
              relationship_type: relData.relationship_type || 'direct',
            });
            const relId = `${relData.cause_event_id}_${relData.effect_event_id}`;
            opResult = { success: true, id: relId };
            createdIds.push({ type: 'relationship', id: relId });
            break;
          }

          case 'update_relationship': {
            // Permission accounting above recognises this operation, but the
            // transaction executor has no implementation for it yet.
            throw new Error(`Operation type not supported in transactions: ${op.type}`);
          }

          case 'delete_relationship': {
            const deleteRelData = op.data as { cause_event_id: string; effect_event_id: string };
            await causalService.deleteCausalLink(
              deleteRelData.cause_event_id,
              deleteRelData.effect_event_id
            );
            opResult = { success: true, id: `${deleteRelData.cause_event_id}_${deleteRelData.effect_event_id}` };
            break;
          }

          default:
            throw new Error(`Unknown operation type: ${op.type}`);
        }

        result.results.push({ index: i, type: op.type, ...opResult });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        result.results.push({ index: i, type: op.type, success: false, error: errorMessage });
        result.success = false;

        if (atomic) {
          // Rollback all created entities
          for (const created of createdIds.reverse()) {
            try {
              switch (created.type) {
                case 'event':
                  await eventRepository.delete(created.id);
                  break;
                case 'arc':
                  await arcRepository.delete(created.id);
                  break;
                case 'relationship': {
                  // Relationship ID format: cause_effect
                  const [causeId, effectId] = created.id.split('_');
                  if (causeId && effectId) {
                    await causalService.deleteCausalLink(causeId, effectId);
                  }
                  break;
                }
              }
            } catch (rollbackError) {
              logger.error('Rollback failed', rollbackError, { type: created.type, id: created.id });
            }
          }

          result.rollbackPerformed = true;

          return res.status(400).json({
            ...createBatchError(
              'TRANSACTION_FAILED',
              `Transaction failed at operation ${i}: ${errorMessage}`,
              { failedIndex: i }
            ),
            result,
          });
        }
      }
    }

    res.status(result.success ? 200 : 207).json(result);
  })
);

// Validation helpers

function validateBatchRequest(
  request: BatchEventRequest | BatchArcRequest | BatchRelationshipRequest,
  type: 'events' | 'arcs' | 'relationships'
): string | null {
  if (!request.graphId) {
    return 'graphId is required';
  }

  const items = (request as unknown as Record<string, unknown[]>)[type];
  if (!items || !Array.isArray(items)) {
    return `${type} array is required`;
  }

  if (items.length === 0) {
    return `${type} array cannot be empty`;
  }

  if (items.length > MAX_BATCH_SIZE) {
    return `Maximum ${MAX_BATCH_SIZE} ${type} per batch`;
  }

  return null;
}

function validateEventData(data: Partial<IEvent>): string[] {
  const warnings: string[] = [];

  if (!data.description || typeof data.description !== 'string') {
    warnings.push('description is required');
  }

  if (!data.timestamp) {
    warnings.push('timestamp is required');
  } else if (isNaN(new Date(data.timestamp).getTime())) {
    warnings.push('timestamp is invalid');
  }

  return warnings;
}

function validateArcData(data: Partial<IArc>): string[] {
  const warnings: string[] = [];

  if (!data.name || typeof data.name !== 'string') {
    warnings.push('name is required');
  }

  if (!data.start_time) {
    warnings.push('start_time is required');
  }

  if (!data.end_time) {
    warnings.push('end_time is required');
  }

  if (data.start_time && data.end_time) {
    const start = new Date(data.start_time);
    const end = new Date(data.end_time);
    if (start >= end) {
      warnings.push('start_time must be before end_time');
    }
  }

  return warnings;
}

function validateRelationshipData(data: {
  cause_event_id: string;
  effect_event_id: string;
}): string[] {
  const warnings: string[] = [];

  if (!data.cause_event_id) {
    warnings.push('cause_event_id is required');
  }

  if (!data.effect_event_id) {
    warnings.push('effect_event_id is required');
  }

  if (data.cause_event_id === data.effect_event_id) {
    warnings.push('cause_event_id and effect_event_id cannot be the same');
  }

  return warnings;
}
