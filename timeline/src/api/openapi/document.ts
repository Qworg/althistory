import type { RouteEntry } from './routeInventory'
import { OPERATIONS, OperationSpec } from './operations'

/**
 * The OpenAPI 3.0 description of the HTTP API.
 *
 * The PATHS and the METHODS come from the live Express router, and what each
 * operation does comes from `operations.ts`. The two are checked against each
 * other in `openapi.test.ts`, and the builder THROWS for a route that has no
 * description -- so a route that is added and not documented fails the build
 * rather than being given a generic summary.
 */

const API_VERSION = '1.0.0'

/** The parts of a path Express declares as parameters. */
const PATH_PARAMETER = /:([A-Za-z0-9_]+)/g

/**
 * An Express path in OpenAPI's templating: `/graphs/:id` becomes
 * `/graphs/{id}`.
 *
 * The inventory keeps the Express form, because that is what the router
 * declares; only the document uses the template.
 */
export function toOpenApiPath(path: string): string {
  return path.replace(PATH_PARAMETER, '{$1}')
}

/** The path parameters a route declares, as OpenAPI parameters. */
function pathParameters(path: string): Array<Record<string, unknown>> {
  const names = new Set<string>()
  for (const match of path.matchAll(PATH_PARAMETER)) {
    names.add(match[1])
  }

  return [...names].map((name) => ({
    name,
    in: 'path',
    required: true,
    schema: { type: 'string' },
    description: `The ${name} identifier.`,
  }))
}

/** The header that scopes a request to a graph, for the routes that honour it. */
const GRAPH_HEADER_PARAMETER = {
  name: 'X-Graph-Id',
  in: 'header',
  required: false,
  schema: { type: 'string' },
  description:
    'The graph the request is about. Without it the active graph is used; ' +
    'a graph that does not exist is a 404.',
}

/**
 * The error responses a route can answer with.
 *
 * The 401 and the 403 belong to the routes that require a key: a route that
 * does not mount `requireAuth` cannot answer 401, whatever it is sent.
 */
const ERROR_RESPONSES: Record<string, string> = {
  400: 'The request was malformed or failed validation.',
  404: 'The graph, entity or job does not exist.',
  409: 'The operation conflicts with the current state.',
  500: 'The server failed to complete the request.',
}

const AUTH_ERROR_RESPONSES: Record<string, string> = {
  401: 'No API key was presented, or the key is not valid.',
  403: 'The key may not perform this operation on this graph.',
}

const SCHEMAS: Record<string, Record<string, unknown>> = {
  /**
   * The shape of a request or response this document does not describe in
   * detail. The routes that use it take and return their own bodies.
   */
  GenericObject: {
    type: 'object',
    description: 'An object whose properties depend on the operation.',
    additionalProperties: true,
  },
  Graph: {
    type: 'object',
    properties: {
      id: { type: 'string' },
      name: { type: 'string' },
      description: { type: 'string' },
      status: { type: 'string', enum: ['active', 'archived', 'deleted'] },
      version: { type: 'integer' },
      parentGraphId: { type: 'string' },
      createdAt: { type: 'string', format: 'date-time' },
      updatedAt: { type: 'string', format: 'date-time' },
    },
    required: ['id', 'name', 'status', 'version'],
  },
  GraphRequest: {
    type: 'object',
    properties: {
      name: { type: 'string' },
      description: { type: 'string' },
    },
    required: ['name'],
  },
  GraphUpdate: {
    type: 'object',
    properties: {
      name: { type: 'string' },
      description: { type: 'string' },
      status: { type: 'string', enum: ['active', 'archived'] },
    },
  },
  BranchGraphRequest: {
    type: 'object',
    properties: {
      name: { type: 'string' },
      description: { type: 'string' },
    },
    required: ['name'],
  },
  CopyGraphRequest: {
    type: 'object',
    properties: {
      targetName: { type: 'string' },
      copyType: { type: 'string', enum: ['full', 'time_range', 'filtered'] },
      timeRange: { type: 'object' },
      filter: { type: 'object' },
    },
    required: ['targetName'],
  },
  CopyProgress: {
    type: 'object',
    properties: {
      id: { type: 'string' },
      status: { type: 'string' },
      progress: { type: 'number' },
      copiedNodes: { type: 'integer' },
      copiedRelationships: { type: 'integer' },
    },
  },
  GraphVersion: {
    type: 'object',
    properties: {
      version: { type: 'integer' },
      parentVersion: { type: 'integer', nullable: true },
      operation: { type: 'string' },
      description: { type: 'string' },
      timestamp: { type: 'string', format: 'date-time' },
      userId: { type: 'string' },
    },
    required: ['version', 'operation', 'timestamp'],
  },
  GraphData: {
    type: 'object',
    properties: {
      events: { type: 'object' },
      arcs: { type: 'object' },
      relationships: { type: 'object' },
      pressures: { type: 'object' },
    },
  },
  MergeRequest: {
    type: 'object',
    properties: {
      sourceGraphId: { type: 'string' },
      conflictResolution: {
        type: 'string',
        enum: ['keep-target', 'keep-source', 'manual'],
      },
      manualResolutions: { type: 'object' },
      dryRun: { type: 'boolean' },
    },
    required: ['sourceGraphId'],
  },
  MergeResult: {
    type: 'object',
    properties: {
      success: { type: 'boolean' },
      conflicts: { type: 'array', items: { type: 'object' } },
      anomalies: { type: 'array', items: { type: 'object' } },
      mergedGraph: { $ref: '#/components/schemas/Graph' },
      newVersion: { type: 'integer' },
      dryRun: { type: 'boolean' },
    },
    required: ['success'],
  },
  Event: {
    type: 'object',
    properties: {
      id: { type: 'string' },
      description: { type: 'string' },
      actor: { type: 'string' },
      target: { type: 'string' },
      timestamp: { type: 'string', format: 'date-time' },
      metadata: { type: 'object' },
    },
    required: ['id', 'description', 'actor', 'target', 'timestamp'],
  },
  EventRequest: {
    type: 'object',
    properties: {
      description: { type: 'string' },
      actor: { type: 'string' },
      target: { type: 'string' },
      timestamp: { type: 'string', format: 'date-time' },
      metadata: { type: 'object' },
    },
    required: ['description', 'actor', 'target', 'timestamp'],
  },
  EventUpdate: {
    type: 'object',
    properties: {
      description: { type: 'string' },
      actor: { type: 'string' },
      target: { type: 'string' },
      timestamp: { type: 'string', format: 'date-time' },
      metadata: { type: 'object' },
    },
  },
  Arc: {
    type: 'object',
    properties: {
      id: { type: 'string' },
      name: { type: 'string' },
      description: { type: 'string' },
      start_time: { type: 'string', format: 'date-time' },
      end_time: { type: 'string', format: 'date-time' },
      level: { type: 'integer' },
    },
    required: ['id', 'name', 'start_time', 'end_time', 'level'],
  },
  ArcRequest: {
    type: 'object',
    properties: {
      name: { type: 'string' },
      description: { type: 'string' },
      start_time: { type: 'string', format: 'date-time' },
      end_time: { type: 'string', format: 'date-time' },
      level: { type: 'integer' },
      parent_arc_id: { type: 'string', nullable: true },
    },
    required: ['name', 'start_time', 'end_time', 'level'],
  },
  ArcUpdate: {
    type: 'object',
    properties: {
      name: { type: 'string' },
      description: { type: 'string' },
      start_time: { type: 'string', format: 'date-time' },
      end_time: { type: 'string', format: 'date-time' },
      level: { type: 'integer' },
    },
  },
  CausalRelationship: {
    type: 'object',
    properties: {
      id: { type: 'string' },
      cause_event_id: { type: 'string' },
      effect_event_id: { type: 'string' },
      weight: { type: 'number' },
      evidence: { type: 'string' },
      confidence: { type: 'number' },
      relationship_type: {
        type: 'string',
        enum: ['direct', 'indirect', 'contributory'],
      },
    },
    required: ['id', 'cause_event_id', 'effect_event_id'],
  },
  CausalLinkRequest: {
    type: 'object',
    properties: {
      causeEventId: { type: 'string' },
      effectEventId: { type: 'string' },
      relationship: {
        type: 'object',
        description:
          'Give the type as `type` or `relationship_type`, and the strength as `strength` or `weight`; one of each pair is required.',
        properties: {
          type: {
            type: 'string',
            enum: ['direct', 'indirect', 'contributory'],
            description: 'The kind of link. Alias: `relationship_type`.',
          },
          relationship_type: {
            type: 'string',
            enum: ['direct', 'indirect', 'contributory'],
            description: 'Alias of `type`; the name the link is stored under.',
          },
          strength: {
            type: 'number',
            minimum: 0,
            maximum: 1,
            description: 'How strongly the cause drives the effect, 0 to 1. Alias: `weight`.',
          },
          weight: {
            type: 'number',
            minimum: 0,
            maximum: 1,
            description: 'Alias of `strength`; the name the link is stored under.',
          },
          confidence: { type: 'number', minimum: 0, maximum: 1 },
          evidence: { type: 'string', minLength: 1, description: 'Why the link holds. Must not be empty.' },
        },
        required: ['confidence', 'evidence'],
      },
    },
    required: ['causeEventId', 'effectEventId', 'relationship'],
  },
  CausalLinkUpdate: {
    type: 'object',
    properties: {
      causeEventId: { type: 'string' },
      effectEventId: { type: 'string' },
      relationship: { type: 'object' },
    },
    required: ['causeEventId', 'effectEventId'],
  },
  CausalLinkDelete: {
    type: 'object',
    properties: {
      causeEventId: { type: 'string' },
      effectEventId: { type: 'string' },
    },
    required: ['causeEventId', 'effectEventId'],
  },
  InferredPressure: {
    type: 'object',
    properties: {
      id: { type: 'string' },
      description: { type: 'string' },
      confidence_score: { type: 'number' },
      pressure_type: {
        type: 'string',
        enum: ['economic', 'social', 'environmental', 'political'],
      },
      // The evidence as display strings, the ids of the events the inference
      // rests on, and the period it was inferred over.
      evidence: { type: 'array', items: { type: 'string' } },
      evidence_event_ids: { type: 'array', items: { type: 'string' } },
      time_range: {
        type: 'object',
        properties: {
          start: { type: 'string', format: 'date-time' },
          end: { type: 'string', format: 'date-time' },
        },
      },
    },
    required: ['id', 'description', 'confidence_score', 'pressure_type', 'evidence'],
  },
  ExportRequest: {
    type: 'object',
    properties: {
      graphId: { type: 'string' },
      scope: { type: 'string', enum: ['full', 'filtered'] },
      filters: { type: 'object' },
      includeProvenance: { type: 'boolean' },
      embedReferences: { type: 'boolean' },
      version: { type: 'integer' },
      webhook: { type: 'string' },
    },
    required: ['scope'],
  },
  ExportDocument: {
    type: 'object',
    properties: {
      version: { type: 'string' },
      metadata: { type: 'object' },
      data: { type: 'object' },
      provenance: { type: 'object' },
    },
    required: ['version', 'metadata', 'data'],
  },

  ImportJob: {
    type: 'object',
    properties: {
      id: { type: 'string' },
      status: { type: 'string' },
      progress: { type: 'number' },
      result: { type: 'object' },
    },
  },

  BatchResult: {
    type: 'object',
    properties: {
      success: { type: 'boolean' },
      created: { type: 'integer' },
      failed: { type: 'integer' },
      errors: { type: 'array', items: { type: 'object' } },
    },
  },
  ApiKey: {
    type: 'object',
    properties: {
      id: { type: 'string' },
      name: { type: 'string' },
      keyPrefix: { type: 'string' },
      permissions: { type: 'array', items: { type: 'string' } },
      allowedGraphs: { type: 'array', items: { type: 'string' } },
      isActive: { type: 'boolean' },
      expiresAt: { type: 'string', format: 'date-time' },
    },
  },
  ApiKeyUsage: {
    type: 'object',
    required: ['keyId', 'rateLimit', 'currentUsage'],
    properties: {
      keyId: { type: 'string' },
      rateLimit: { $ref: '#/components/schemas/ApiKeyRateLimit' },
      currentUsage: {
        type: 'object',
        required: ['minute', 'hour', 'day'],
        properties: {
          minute: { $ref: '#/components/schemas/ApiKeyUsageWindow' },
          hour: { $ref: '#/components/schemas/ApiKeyUsageWindow' },
          day: { $ref: '#/components/schemas/ApiKeyUsageWindow' },
        },
      },
    },
  },
  ApiKeyRateLimit: {
    type: 'object',
    required: [
      'requestsPerMinute',
      'requestsPerHour',
      'requestsPerDay',
      'batchSizeLimit',
      'concurrentStreams',
    ],
    properties: {
      requestsPerMinute: { type: 'integer' },
      requestsPerHour: { type: 'integer' },
      requestsPerDay: { type: 'integer' },
      batchSizeLimit: { type: 'integer' },
      concurrentStreams: { type: 'integer' },
    },
  },
  ApiKeyUsageWindow: {
    type: 'object',
    required: ['count', 'resetAt'],
    properties: {
      count: { type: 'integer' },
      resetAt: {
        type: 'integer',
        nullable: true,
        description:
          'When the window resets, or null when no window is running -- the ' +
          'key was never used, or the window it used has ended.',
      },
    },
  },
  CreateApiKeyResponse: {
    type: 'object',
    properties: {
      id: { type: 'string' },
      name: { type: 'string' },
      key: { type: 'string' },
      permissions: { type: 'array', items: { type: 'string' } },
      allowedGraphs: { type: 'array', items: { type: 'string' } },
      rateLimit: { type: 'object' },
    },
    required: ['id', 'key'],
  },
  ApiKeyRequest: {
    type: 'object',
    properties: {
      name: { type: 'string' },
      permissions: { type: 'array', items: { type: 'string' } },
      allowedGraphs: { type: 'array', items: { type: 'string' } },
      expiresAt: { type: 'string', format: 'date-time' },
    },
    required: ['name', 'permissions'],
  },
  Job: {
    type: 'object',
    properties: {
      id: { type: 'string' },
      type: { type: 'string' },
      status: { type: 'string' },
      progress: { type: 'number' },
      createdAt: { type: 'string', format: 'date-time' },
      result: { type: 'object' },
      error: { type: 'string' },
    },
  },
  ValidationReport: {
    type: 'object',
    properties: {
      valid: { type: 'boolean' },
      errors: { type: 'array', items: { type: 'object' } },
      warnings: { type: 'array', items: { type: 'object' } },
    },
    required: ['valid'],
  },
  IngestPreview: {
    type: 'object',
    properties: {
      id: { type: 'string' },
      status: { type: 'string' },
      extraction: { type: 'object' },
    },
  },
  Error: {
    type: 'object',
    description:
      'The shape the error handler answers with. The import routes answer a ' +
      'variant in which `error` is a string.',
    properties: {
      error: {
        description: 'The error itself: an object for most routes, a string for the import routes.',
        oneOf: [
          {
            type: 'object',
            properties: {
              message: { type: 'string' },
              code: { type: 'string' },
              details: { type: 'object' },
              timestamp: { type: 'string', format: 'date-time' },
              path: { type: 'string' },
              requestId: { type: 'string' },
            },
          },
          { type: 'string' },
        ],
      },
      message: { type: 'string' },
    },
  },
  Suggestions: {
    type: 'object',
    description: 'A set of suggestions.',
    properties: {
      suggestions: { type: 'array', items: { type: 'object' } },
    },
  },
  ArcEvents: {
    type: 'object',
    properties: {
      arc: { $ref: '#/components/schemas/Arc' },
      events: { type: 'array', items: { $ref: '#/components/schemas/Event' } },
    },
  },
  ArcChildren: {
    type: 'object',
    properties: {
      parent: { $ref: '#/components/schemas/Arc' },
      children: { type: 'array', items: { $ref: '#/components/schemas/Arc' } },
    },
  },
  EventRelationships: {
    type: 'object',
    properties: {
      event: { $ref: '#/components/schemas/Event' },
      relationships: { type: 'object' },
    },
  },
  ApiKeyList: {
    type: 'object',
    properties: {
      keys: { type: 'array', items: { $ref: '#/components/schemas/ApiKey' } },
      pagination: { type: 'object' },
    },
  },
  ExportJobCreated: {
    type: 'object',
    properties: {
      jobId: { type: 'string' },
      estimatedSize: { type: 'number' },
      estimatedTime: { type: 'number' },
    },
    required: ['jobId'],
  },
  IncrementalValidationRequest: {
    type: 'object',
    properties: {
      graphId: { type: 'string' },
      additions: { type: 'object' },
    },
    required: ['graphId', 'additions'],
  },
  ImportPreviewRequest: {
    type: 'object',
    properties: {
      targetGraphId: { type: 'string' },
      data: { type: 'object' },
      mode: { type: 'string', enum: ['merge', 'replace', 'create-new'] },
    },
    required: ['targetGraphId', 'data'],
  },
  ImportRequest: {
    type: 'object',
    properties: {
      targetGraphId: { type: 'string' },
      data: { type: 'object' },
      mode: { type: 'string', enum: ['merge', 'replace', 'create-new'] },
      conflictResolution: {
        type: 'string',
        enum: ['skip', 'overwrite', 'rename', 'manual'],
      },
      manualResolutions: { type: 'object' },
    },
    required: ['data'],
  },
  IngestUrlRequest: {
    type: 'object',
    properties: {
      url: { type: 'string' },
      strategy: { type: 'string', enum: ['wikipedia', 'auto'] },
      context: { type: 'string' },
    },
    required: ['url'],
  },
  IngestWikidataRequest: {
    type: 'object',
    properties: {
      queryType: { type: 'string' },
      parameters: { type: 'object' },
      customQuery: { type: 'string' },
      limit: { type: 'integer' },
    },
    required: ['queryType'],
  },
  IngestTextRequest: {
    type: 'object',
    properties: {
      text: { type: 'string' },
      useLLM: { type: 'boolean' },
      context: { type: 'string' },
    },
    required: ['text'],
  },
  StreamTokenRequest: {
    type: 'object',
    properties: {
      graphId: { type: 'string' },
    },
  },
  StreamToken: {
    type: 'object',
    properties: {
      token: { type: 'string' },
      expiresIn: { type: 'number' },
      graphId: { type: 'string' },
      permissions: { type: 'array', items: { type: 'string' } },
      concurrentStreams: { type: 'number' },
    },
    required: ['token'],
  },
  BatchEventsRequest: {
    type: 'object',
    properties: {
      graphId: { type: 'string' },
      events: { type: 'array', items: { type: 'object' } },
      validation: { type: 'string', enum: ['strict', 'lenient', 'skip'] },
      onError: { type: 'string', enum: ['abort', 'continue'] },
    },
    required: ['graphId', 'events'],
  },
  BatchArcsRequest: {
    type: 'object',
    properties: {
      graphId: { type: 'string' },
      arcs: { type: 'array', items: { type: 'object' } },
      validation: { type: 'string', enum: ['strict', 'lenient', 'skip'] },
      onError: { type: 'string', enum: ['abort', 'continue'] },
    },
    required: ['graphId', 'arcs'],
  },
  BatchRelationshipsRequest: {
    type: 'object',
    properties: {
      graphId: { type: 'string' },
      relationships: { type: 'array', items: { type: 'object' } },
      validation: { type: 'string', enum: ['strict', 'lenient', 'skip'] },
      onError: { type: 'string', enum: ['abort', 'continue'] },
    },
    required: ['graphId', 'relationships'],
  },
  BatchTransactionRequest: {
    type: 'object',
    properties: {
      graphId: { type: 'string' },
      operations: { type: 'array', items: { type: 'object' } },
      atomic: { type: 'boolean' },
    },
    required: ['graphId', 'operations'],
  },
  BatchTransactionResult: {
    type: 'object',
    properties: {
      success: { type: 'boolean' },
      results: { type: 'array', items: { type: 'object' } },
      rollbackPerformed: { type: 'boolean' },
    },
    required: ['success'],
  },
  ApiKeyUpdate: {
    type: 'object',
    description: 'Every field is optional: only the ones that are given are changed.',
    properties: {
      name: { type: 'string' },
      permissions: { type: 'array', items: { type: 'string' } },
      allowedGraphs: { type: 'array', items: { type: 'string' } },
    },
  },
  ServiceInfo: {
    type: 'object',
    properties: {
      name: { type: 'string' },
      version: { type: 'string' },
      description: { type: 'string' },
      endpoints: { type: 'object' },
      features: { type: 'object' },
    },
  },
  Health: {
    type: 'object',
    properties: {
      status: { type: 'string' },
      timestamp: { type: 'string', format: 'date-time' },
      service: { type: 'string' },
    },
    required: ['status'],
  },
}

/** The envelope the routes wrap their payload in. */
function envelopeSchema(itemSchema: string, isList: boolean): Record<string, unknown> {
  return {
    type: 'object',
    properties: {
      success: { type: 'boolean' },
      data: isList
        ? { type: 'array', items: { $ref: `#/components/schemas/${itemSchema}` } }
        : { $ref: `#/components/schemas/${itemSchema}` },
      message: { type: 'string' },
      requestId: { type: 'string' },
    },
  }
}

/**
 * The tag an operation carries: the area of the API its path belongs to.
 *
 * The areas are the path prefixes, so the tag is derived rather than written
 * twice. The prefix is the first segment after `/api`, except for the two
 * groups that have a sub-prefix of their own.
 */
const AREA_TAGS: Array<{ prefix: string; tag: string }> = [
  { prefix: '/api/graphs', tag: 'graphs' },
  { prefix: '/api/events', tag: 'events' },
  { prefix: '/api/arcs', tag: 'arcs' },
  { prefix: '/api/causal', tag: 'causal' },
  { prefix: '/api/temporal', tag: 'temporal' },
  { prefix: '/api/inference', tag: 'inference' },
  { prefix: '/api/suggest', tag: 'suggest' },
  { prefix: '/api/validate', tag: 'validate' },
  { prefix: '/api/export', tag: 'export' },
  { prefix: '/api/import', tag: 'import' },
  { prefix: '/api/ingest', tag: 'ingest' },
  { prefix: '/api/keys', tag: 'keys' },
  { prefix: '/api/batch', tag: 'batch' },
  { prefix: '/api/stream', tag: 'stream' },
  { prefix: '/api', tag: 'service' },
]

function tagFor(path: string): string {
  let best = 'service'
  let bestLength = -1

  for (const area of AREA_TAGS) {
    if (path.startsWith(area.prefix) && area.prefix.length > bestLength) {
      best = area.tag
      bestLength = area.prefix.length
    }
  }

  return best
}

/**
 * A JSON response carrying the payload.
 *
 * `envelope` says whether the route wraps the payload in
 * `{ success, data, message, requestId }` or answers it directly. The routes
 * differ: the entity routes use the envelope, and the key, import, ingestion,
 * suggestion, validation and batch routes answer the payload itself.
 */
function jsonResponse(
  description: string,
  itemSchema?: string,
  isList = false,
  envelope: 'data' | 'bare' = 'data'
): Record<string, unknown> {
  return {
    description,
    content: {
      'application/json': {
        schema: itemSchema
          ? envelope === 'data'
            ? envelopeSchema(itemSchema, isList)
            : isList
              ? { type: 'array', items: { $ref: `#/components/schemas/${itemSchema}` } }
              : { $ref: `#/components/schemas/${itemSchema}` }
          : { type: 'object', additionalProperties: true },
      },
    },
  }
}

/** An error response, with the shape the error handler sends. */
function errorResponse(description: string): Record<string, unknown> {
  return {
    description,
    content: {
      'application/json': { schema: { $ref: '#/components/schemas/Error' } },
    },
  }
}

/**
 * Build the OpenAPI document for the given routes.
 *
 * Throws when a route has no description: the description table is the
 * contract, and a route that is not in it is a route nobody has described.
 */
export function buildOpenApiDocument(routes: RouteEntry[]): Record<string, unknown> {
  const paths: Record<string, Record<string, unknown>> = {}
  const undescribed: string[] = []

  for (const route of routes) {
    const key = `${route.method} ${route.path}`
    const spec: OperationSpec | undefined = OPERATIONS[key]

    if (!spec) {
      undescribed.push(key)
      continue
    }

    const parameters = pathParameters(route.path)
    if (spec.graphScoped) {
      parameters.push(GRAPH_HEADER_PARAMETER)
    }

    const successStatus = String(spec.status ?? 200)
    const operation: Record<string, unknown> = {
      operationId: operationIdOf(route.method, route.path),
      summary: spec.summary,
      tags: [tagFor(route.path)],
      parameters: [
        ...parameters,
        ...(spec.query ?? []).map((parameter) => ({
          name: parameter.name,
          in: 'query',
          required: parameter.required ?? false,
          schema: { type: parameter.type ?? 'string' },
          description: parameter.description ?? '',
        })),
      ],
      responses: {
        [successStatus]: jsonResponse(
          'The result.',
          spec.response,
          spec.responseIsList,
          spec.envelope ?? 'data'
        ),
        ...Object.fromEntries(
          Object.entries(ERROR_RESPONSES).map(([code, description]) => [
            code,
            errorResponse(description),
          ])
        ),
        ...(spec.auth === 'required'
          ? Object.fromEntries(
              Object.entries(AUTH_ERROR_RESPONSES).map(([code, description]) => [
                code,
                errorResponse(description),
              ])
            )
          : {}),
        ...Object.fromEntries(
          Object.entries(spec.responses ?? {}).map(([code, description]) => [
            code,
            { description },
          ])
        ),
      },
      // A route that does not require a key says so: it mounts no `requireAuth`,
      // so a keyless request reaches its handler and only the routes that ask
      // for a permission refuse one.
      security:
        spec.auth === 'required' ? [{ apiKey: [] }, { bearer: [] }] : [],
    }

    if (spec.request) {
      operation.requestBody = {
        // A body is not required unless the operation says so: the routes that
        // take an optional body (an update, a suggestion) would otherwise be
        // published as requiring one.
        required: spec.requestRequired ?? false,
        content: {
          'application/json': {
            schema: { $ref: `#/components/schemas/${spec.request}` },
          },
        },
      }
    }

    if (spec.producesFile) {
      operation.responses = {
        ...(operation.responses as Record<string, unknown>),
        [successStatus]: {
          description: 'The exported file.',
          content: { 'application/json': { schema: { type: 'string' } } },
          headers: {
            'Content-Disposition': {
              description: 'The file name.',
              schema: { type: 'string' },
            },
          },
        },
      }
    }

    const path = toOpenApiPath(route.path)
    const pathItem = (paths[path] ?? {}) as Record<string, unknown>
    pathItem[route.method.toLowerCase()] = operation
    paths[path] = pathItem
  }

  if (undescribed.length > 0) {
    throw new Error(
      `These routes have no description in the OpenAPI document: ${undescribed.join(', ')}. ` +
        'Add them to src/api/openapi/operations.ts.'
    )
  }

  return {
    openapi: '3.0.3',
    info: {
      title: 'Althistory API',
      version: API_VERSION,
      description:
        'The HTTP API of Althistory: a versioned, multi-graph timeline of historical events, ' +
        'with narrative arcs, causal relationships, inferred pressures, and import/export between ' +
        'graphs.\n\n' +
        'The API key is presented in the `X-API-Key` header, and each operation ' +
        'states whether it needs one. The event, arc, causal, temporal, inference ' +
        'and service routes do not; the graph, suggestion, validation, export, ' +
        'import, ingestion, key, batch and stream routes do.',
      license: { name: 'MIT' },
    },
    // The paths already carry the `/api` prefix, so the server is the root.
    // The description covers the API under /api; the few routes registered on
    // the application itself (its own /health and /) are not part of it.
    servers: [{ url: '/', description: 'The API is mounted under /api.' }],
    tags: [
      { name: 'service', description: 'Service information and health.' },
      { name: 'graphs', description: 'Multi-graph management.' },
      { name: 'events', description: 'Historical events.' },
      { name: 'arcs', description: 'Narrative arcs and their hierarchy.' },
      { name: 'causal', description: 'Causal relationships between events.' },
      { name: 'temporal', description: 'Temporal analysis of the graph.' },
      { name: 'inference', description: 'Inference over the graph.' },
      { name: 'suggest', description: 'Suggestions over the graph.' },
      { name: 'validate', description: 'Validation of a graph.' },
      { name: 'export', description: 'Exporting graphs and export jobs.' },
      { name: 'import', description: 'Importing export files.' },
      { name: 'ingest', description: 'Extracting entities from the web.' },
      { name: 'keys', description: 'API key management.' },
      { name: 'batch', description: 'Batch operations.' },
      { name: 'stream', description: 'WebSocket write sessions.' },
    ],
    paths,
    components: {
      securitySchemes: {
        apiKey: {
          type: 'apiKey',
          in: 'header',
          name: 'X-API-Key',
          description: 'An API key with the permissions the operation needs.',
        },
        bearer: {
          type: 'http',
          scheme: 'bearer',
          description: 'The same key, presented as a bearer token.',
        },
      },
      schemas: SCHEMAS,
    },
  }
}

/** A stable, unique name for an operation, for generated clients. */
function operationIdOf(method: string, path: string): string {
  const parts = path
    .split('/')
    .filter(Boolean)
    .map((part) =>
      part.startsWith(':')
        ? `By${part.slice(1).replace(/^./, (c) => c.toUpperCase())}`
        : part.replace(/^./, (c) => c.toUpperCase())
    )

  // A client generator turns the operation id into a method name, so it has to
  // be an identifier: letters, digits and underscores only.
  const name = `${method.toLowerCase()}${parts.join('')}`
  return name.replace(/[^A-Za-z0-9_]/g, '')
}
