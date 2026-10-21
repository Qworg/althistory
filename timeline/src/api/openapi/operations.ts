/**
 * What each operation of the API does.
 *
 * This table is REQUIRED: the document builder throws for a route that is not
 * in it, so a route that is added and not described fails the build rather
 * than being given a generic summary.
 *
 * The keys are `METHOD /path` in Express syntax (`:id` for a path parameter).
 *
 * The details here were read from the route source, not inferred from the path:
 * which middleware a route runs, what shape it answers, what it takes, and
 * what it answers with. An earlier version of this file inferred all of that
 * from the path prefix and got most of it wrong.
 */

export interface OperationSpec {
  /** One line: what the operation does. */
  summary: string
  /**
   * Whether the operation needs an API key.
   *
   * `optional` means the route does not require one: the global
   * `authenticate` middleware lets a keyless request through, and only the
   * routes that ask for a permission refuse it.
   */
  auth: 'required' | 'optional'
  /** The schema of the request body, when the operation takes one. */
  request?: string
  /** Whether the request body is required. */
  requestRequired?: boolean
  /** The schema of the payload the operation returns. */
  response?: string
  /**
   * How the payload is wrapped.
   *
   * `data` -- the routes that answer `{ success, data, message, requestId }`.
   * `bare` -- the routes that answer the payload itself.
   */
  envelope?: 'data' | 'bare'
  /** Whether the payload is a list of the response schema. */
  responseIsList?: boolean
  /** The status code of a successful response. */
  status?: number
  /** Whether the operation is scoped to a graph by the `X-Graph-Id` header. */
  graphScoped?: boolean
  /** Query parameters the operation takes. */
  query?: Array<{ name: string; type?: string; required?: boolean; description?: string }>
  /** Response codes this operation can answer with, beyond the usual ones. */
  responses?: Record<string, string>
  /** Whether the operation answers with a file rather than JSON. */
  producesFile?: boolean
}

/** The pagination parameters the list routes take. */
const PAGE = [
  { name: 'page', type: 'integer', description: 'The page to read, from 1.' },
  { name: 'pageSize', type: 'integer', description: 'How many entries a page holds.' },
]

const LIMIT_OFFSET = [
  { name: 'limit', type: 'integer', description: 'How many entries to return.' },
  { name: 'offset', type: 'integer', description: 'How many entries to skip.' },
]

const TIME_RANGE = [
  { name: 'startTime', type: 'string', required: true, description: 'The start of the range, as an ISO date.' },
  { name: 'endTime', type: 'string', required: true, description: 'The end of the range, as an ISO date.' },
]

export const OPERATIONS: Record<string, OperationSpec> = {
  // --- service -------------------------------------------------------------
  'GET /api': {
    summary: 'What this service is and where its parts live.',
    response: 'ServiceInfo',
    envelope: 'bare',
    auth: 'optional',
  },
  'GET /api/health': {
    summary: 'Whether the service is up.',
    response: 'Health',
    envelope: 'bare',
    auth: 'optional',
  },
  'GET /api/info': {
    summary: 'The API description, its features and its endpoints.',
    response: 'ServiceInfo',
    envelope: 'bare',
    auth: 'optional',
  },
  'GET /api/openapi.json': {
    summary: 'This document: the OpenAPI description of the API.',
    response: 'GenericObject',
    envelope: 'bare',
    auth: 'optional',
  },

  // --- graphs --------------------------------------------------------------
  'GET /api/graphs': {
    summary: 'List the graphs.',
    response: 'Graph',
    responseIsList: true,
    auth: 'required',
    query: [
      { name: 'status', type: 'string', description: 'Only the graphs with this status.' },
      ...LIMIT_OFFSET,
    ],
  },
  'POST /api/graphs': {
    summary: 'Create a graph.',
    request: 'GraphRequest',
    requestRequired: true,
    response: 'Graph',
    status: 201,
    auth: 'required',
  },
  'GET /api/graphs/active': {
    summary: 'The graph that requests without a graph header are about.',
    response: 'Graph',
    auth: 'required',
  },
  'GET /api/graphs/:id': {
    summary: 'Read one graph.',
    response: 'Graph',
    auth: 'required',
  },
  'PUT /api/graphs/:id': {
    summary: 'Rename a graph, change its description or archive it.',
    request: 'GraphUpdate',
    response: 'Graph',
    auth: 'required',
  },
  'DELETE /api/graphs/:id': {
    summary: 'Delete a graph. The deletion is soft: the graph keeps its data and is marked deleted.',
    response: 'GenericObject',
    auth: 'required',
  },
  'POST /api/graphs/:id/activate': {
    summary: 'Make a graph the active one.',
    response: 'GenericObject',
    auth: 'required',
    responses: { 400: 'The graph does not exist.' },
  },
  'GET /api/graphs/:id/versions': {
    summary: 'The version history of a graph.',
    response: 'GraphVersion',
    responseIsList: true,
    auth: 'required',
    query: [...LIMIT_OFFSET],
  },
  'POST /api/graphs/:id/rollback/:version': {
    summary: 'Roll a graph back to an earlier version.',
    response: 'Graph',
    auth: 'required',
  },
  'POST /api/graphs/:id/branch': {
    summary: 'Branch a graph: copy it at its head, under a new name.',
    request: 'BranchGraphRequest',
    requestRequired: true,
    response: 'Graph',
    status: 201,
    auth: 'required',
  },
  'GET /api/graphs/:id/branches': {
    summary: 'The branches of a graph.',
    response: 'Graph',
    responseIsList: true,
    auth: 'required',
  },
  'POST /api/graphs/:id/merge': {
    summary: 'Merge a source graph into this one.',
    request: 'MergeRequest',
    requestRequired: true,
    // The merged graph, with the merge result (the new version, the conflicts
    // and the anomalies) beside it.
    response: 'Graph',
    auth: 'required',
    responses: {
      409: 'The merge was refused: conflicts that need a resolution, or anomalies in the result.',
    },
  },
  'GET /api/graphs/:id/data': {
    summary: 'The contents of a graph at its head.',
    response: 'GraphData',
    auth: 'required',
  },
  'POST /api/graphs/:id/gc': {
    summary: 'Collect the objects no version of a graph refers to any more.',
    response: 'GenericObject',
    auth: 'required',
  },
  'POST /api/graphs/copy': {
    summary: 'Copy a graph, in full or in part.',
    request: 'CopyGraphRequest',
    requestRequired: true,
    response: 'GenericObject',
    status: 201,
    auth: 'required',
  },
  'GET /api/graphs/copy/:copyId': {
    summary: 'The progress of a copy.',
    response: 'CopyProgress',
    auth: 'required',
  },

  // --- events --------------------------------------------------------------
  'GET /api/events': {
    summary: 'List the events of a graph, with filters and pagination.',
    response: 'Event',
    responseIsList: true,
    auth: 'optional',
    graphScoped: true,
    query: [
      { name: 'actor', type: 'string', description: 'Only the events of this actor.' },
      { name: 'target', type: 'string', description: 'Only the events with this target.' },
      { name: 'startTime', type: 'string', description: 'Only the events from this instant.' },
      { name: 'endTime', type: 'string', description: 'Only the events up to this instant.' },
      ...LIMIT_OFFSET,
    ],
  },
  'POST /api/events': {
    summary: 'Create an event.',
    request: 'EventRequest',
    requestRequired: true,
    response: 'Event',
    status: 201,
    auth: 'optional',
    graphScoped: true,
  },
  'GET /api/events/:id': {
    summary: 'Read one event.',
    response: 'Event',
    auth: 'optional',
    graphScoped: true,
  },
  'PUT /api/events/:id': {
    summary: 'Change an event. Only the fields that are given are changed.',
    request: 'EventUpdate',
    response: 'Event',
    auth: 'optional',
    graphScoped: true,
  },
  'DELETE /api/events/:id': {
    summary: 'Delete an event, and the relationships that refer to it.',
    response: 'GenericObject',
    auth: 'optional',
    graphScoped: true,
  },
  'GET /api/events/stats/count': {
    summary: 'How many events a graph has, with the filters applied.',
    response: 'GenericObject',
    auth: 'optional',
    graphScoped: true,
  },

  // --- arcs ----------------------------------------------------------------
  'GET /api/arcs': {
    summary: 'List the arcs of a graph, with filters and pagination.',
    response: 'Arc',
    responseIsList: true,
    auth: 'optional',
    graphScoped: true,
    query: [
      { name: 'level', type: 'integer', description: 'Only the arcs at this level.' },
      { name: 'startTime', type: 'string', description: 'Only the arcs that start after this instant.' },
      { name: 'endTime', type: 'string', description: 'Only the arcs that end before this instant.' },
      ...LIMIT_OFFSET,
    ],
  },
  'POST /api/arcs': {
    summary: 'Create an arc.',
    request: 'ArcRequest',
    requestRequired: true,
    response: 'Arc',
    status: 201,
    auth: 'optional',
    graphScoped: true,
  },
  'GET /api/arcs/:id': {
    summary: 'Read one arc.',
    response: 'Arc',
    auth: 'optional',
    graphScoped: true,
  },
  'PUT /api/arcs/:id': {
    summary: 'Change an arc. Only the fields that are given are changed.',
    request: 'ArcUpdate',
    response: 'Arc',
    auth: 'optional',
    graphScoped: true,
  },
  'DELETE /api/arcs/:id': {
    summary: 'Delete an arc and its children.',
    response: 'GenericObject',
    auth: 'optional',
    graphScoped: true,
  },
  'GET /api/arcs/:id/events': {
    summary: 'The events an arc contains, with the arc itself.',
    response: 'ArcEvents',
    auth: 'optional',
    graphScoped: true,
    query: [...LIMIT_OFFSET],
  },
  'GET /api/arcs/:id/children': {
    summary: 'The arcs nested inside an arc, with the parent itself.',
    response: 'ArcChildren',
    auth: 'optional',
    graphScoped: true,
  },
  'POST /api/arcs/:id/validate-hierarchy': {
    summary: 'Check that the arcs of a graph nest correctly. Not implemented yet: the route answers a note saying so.',
    response: 'GenericObject',
    auth: 'optional',
    graphScoped: true,
  },

  // --- causal --------------------------------------------------------------
  'POST /api/causal/link': {
    summary: 'Link two events causally.',
    request: 'CausalLinkRequest',
    requestRequired: true,
    response: 'CausalRelationship',
    status: 201,
    auth: 'optional',
    graphScoped: true,
  },
  'PUT /api/causal/link': {
    summary: 'Change a causal link: its weight, evidence or confidence.',
    request: 'CausalLinkUpdate',
    requestRequired: true,
    response: 'CausalRelationship',
    auth: 'optional',
    graphScoped: true,
  },
  'DELETE /api/causal/link': {
    summary:
      'Remove a causal link. The link is named in the body; OpenAPI 3.0 says a ' +
      'consumer may ignore the body of a DELETE, so a generated client cannot ' +
      'call this route.',
    request: 'CausalLinkDelete',
    requestRequired: true,
    response: 'GenericObject',
    auth: 'optional',
    graphScoped: true,
  },
  'GET /api/causal/chain/:eventId': {
    summary: 'The chain of effects that follow an event.',
    response: 'GenericObject',
    auth: 'optional',
    graphScoped: true,
    query: [{ name: 'maxDepth', type: 'integer', description: 'How far down the chain to follow.' }],
  },
  'GET /api/causal/cycles': {
    summary: 'The causal cycles in the graph.',
    response: 'GenericObject',
    auth: 'optional',
    graphScoped: true,
    query: [...LIMIT_OFFSET],
  },
  'GET /api/causal/suggestions': {
    summary: 'Relationships the graph suggests but does not have.',
    response: 'GenericObject',
    auth: 'optional',
    graphScoped: true,
    query: [
      { name: 'minConfidence', type: 'number', description: 'Only the suggestions this sure.' },
      ...LIMIT_OFFSET,
    ],
  },
  'GET /api/causal/relationships': {
    summary: 'Every causal relationship of the graph.',
    response: 'CausalRelationship',
    responseIsList: true,
    auth: 'optional',
    graphScoped: true,
  },
  'GET /api/causal/relationships/:eventId': {
    summary:
      'The causal relationships of one event, split by the role it plays. ' +
      'Not implemented yet: the route answers empty lists with a note saying so.',
    response: 'EventRelationships',
    auth: 'optional',
    graphScoped: true,
    query: [
      {
        name: 'direction',
        type: 'string',
        description: 'Which relationships to look for: `cause`, `effect` or both.',
      },
    ],
  },
  'POST /api/causal/validate': {
    summary: 'Check one proposed causal link for a temporal paradox and for problems with its own fields.',
    request: 'GenericObject',
    response: 'ValidationReport',
    auth: 'optional',
    graphScoped: true,
  },

  // --- temporal ------------------------------------------------------------
  'GET /api/temporal/timeline': {
    summary: 'The timeline of the graph: its events and arcs over time.',
    response: 'GenericObject',
    auth: 'optional',
    graphScoped: true,
    query: [
      ...TIME_RANGE,
      { name: 'granularity', type: 'string', description: 'The bucket the timeline is grouped by.' },
      { name: 'includeArcs', type: 'boolean', description: 'Include the arcs.' },
      { name: 'includeEvents', type: 'boolean', description: 'Include the events.' },
      ...LIMIT_OFFSET,
    ],
  },
  'GET /api/temporal/overlaps': {
    summary: 'The arcs that overlap in time.',
    response: 'GenericObject',
    auth: 'optional',
    graphScoped: true,
    query: [
      ...TIME_RANGE,
      { name: 'level', type: 'integer', description: 'Only the arcs at this level.' },
    ],
  },
  'GET /api/temporal/gaps': {
    summary: 'The periods with no events. Not implemented yet: the route answers a note saying so.',
    response: 'GenericObject',
    auth: 'optional',
    graphScoped: true,
    query: TIME_RANGE,
  },
  'GET /api/temporal/density': {
    summary: 'How densely the events are spread over time.',
    response: 'GenericObject',
    auth: 'optional',
    graphScoped: true,
    query: TIME_RANGE,
  },
  'GET /api/temporal/constraints': {
    summary: 'The temporal constraints the graph holds. Not implemented yet: the route answers a note saying so.',
    response: 'GenericObject',
    auth: 'optional',
    graphScoped: true,
  },
  'POST /api/temporal/validate-event': {
    summary: 'Check one event against the temporal constraints.',
    request: 'GenericObject',
    response: 'ValidationReport',
    auth: 'optional',
    graphScoped: true,
  },
  'POST /api/temporal/validate-arc-nesting': {
    summary: 'Check that the arcs nest correctly.',
    request: 'GenericObject',
    response: 'ValidationReport',
    auth: 'optional',
    graphScoped: true,
  },

  // --- inference -----------------------------------------------------------
  'POST /api/inference/analyze-clusters': {
    summary: 'Cluster the events of the graph.',
    request: 'GenericObject',
    response: 'GenericObject',
    auth: 'optional',
    graphScoped: true,
  },
  'POST /api/inference/detect-patterns': {
    summary: 'Find the patterns the graph contains.',
    request: 'GenericObject',
    response: 'GenericObject',
    auth: 'optional',
    graphScoped: true,
  },
  'GET /api/inference/pressures': {
    summary: 'The pressures inferred over the graph.',
    response: 'InferredPressure',
    responseIsList: true,
    auth: 'optional',
    graphScoped: true,
    query: [
      { name: 'type', type: 'string', description: 'Only the pressures of this type.' },
      { name: 'minStrength', type: 'number', description: 'Only the pressures this strong.' },
      { name: 'minConfidence', type: 'number', description: 'Only the pressures this sure.' },
      ...LIMIT_OFFSET,
    ],
  },
  'GET /api/inference/actor-relationships': {
    summary: 'How the actors of the graph relate to each other. Not implemented yet: the route answers a note saying so.',
    response: 'GenericObject',
    auth: 'optional',
    graphScoped: true,
    query: [
      {
        name: 'actors',
        type: 'string',
        required: true,
        description: 'The actors to relate, as a JSON array of names.',
      },
    ],
  },
  'POST /api/inference/similarity': {
    summary: 'How similar two events are.',
    request: 'GenericObject',
    response: 'GenericObject',
    auth: 'optional',
    graphScoped: true,
  },
  'GET /api/inference/anomalies': {
    summary: 'The anomalies in the graph. Not implemented yet: the route answers a note saying so.',
    response: 'GenericObject',
    auth: 'optional',
    graphScoped: true,
    query: [
      {
        name: 'timeRange',
        type: 'string',
        required: true,
        description: 'The range to look at, as a JSON object with startTime and endTime.',
      },
    ],
  },
  'POST /api/inference/predict': {
    summary: 'What the graph suggests comes next. Not implemented yet: the route answers a note saying so.',
    request: 'GenericObject',
    response: 'GenericObject',
    auth: 'optional',
    graphScoped: true,
  },
  'POST /api/inference/simulate': {
    summary: 'Simulate a historical scenario. The answer may be streamed as server-sent events.',
    request: 'GenericObject',
    response: 'GenericObject',
    auth: 'optional',
    graphScoped: true,
  },

  // --- suggest -------------------------------------------------------------
  'POST /api/suggest/relationships': {
    summary: 'Relationships the graph suggests.',
    request: 'GenericObject',
    response: 'Suggestions',
    envelope: 'bare',
    auth: 'required',
    graphScoped: true,
  },
  'POST /api/suggest/arcs': {
    summary: 'Arcs the graph suggests, from the events that cluster together.',
    request: 'GenericObject',
    response: 'Suggestions',
    envelope: 'bare',
    auth: 'required',
    graphScoped: true,
  },
  'POST /api/suggest/completeness': {
    summary: 'What the graph is missing: gaps in time, actors and causes.',
    request: 'GenericObject',
    response: 'Suggestions',
    envelope: 'bare',
    auth: 'required',
    graphScoped: true,
  },
  'POST /api/suggest/pressures': {
    summary: 'The pressures the graph suggests.',
    request: 'GenericObject',
    response: 'Suggestions',
    envelope: 'bare',
    auth: 'required',
    graphScoped: true,
  },

  // --- validate ------------------------------------------------------------
  'POST /api/validate/graph': {
    summary: 'Validate a whole graph.',
    request: 'GenericObject',
    response: 'ValidationReport',
    envelope: 'bare',
    auth: 'required',
  },
  'POST /api/validate/incremental': {
    summary:
      'Validate only the part of a graph that changed. The graph comes from the ' +
      '`X-Graph-Id` header; a `graphId` in the body is ignored.',
    request: 'IncrementalValidationRequest',
    response: 'ValidationReport',
    envelope: 'bare',
    auth: 'required',
    graphScoped: true,
  },

  // --- export --------------------------------------------------------------
  'GET /api/export': {
    summary:
      'Export a graph. Above the entity threshold the export becomes a job, ' +
      'and the answer is 202 with the job id.',
    response: 'ExportDocument',
    envelope: 'bare',
    auth: 'required',
    graphScoped: true,
    query: [
      {
        name: 'graphId',
        type: 'string',
        description:
          'The graph to export. It has to agree with the `X-Graph-Id` header; ' +
          'a contradiction is a 400.',
      },
      { name: 'scope', type: 'string', description: '`full` or `filtered`.' },
      { name: 'version', type: 'integer', description: 'The version to export; the head by default.' },
      { name: 'includeProvenance', type: 'boolean', description: 'Include the provenance section.' },
      { name: 'embedReferences', type: 'boolean', description: 'Embed the entity each cross-graph reference points at.' },
      { name: 'filters', type: 'string', description: 'The filters, as a JSON object or as bracket notation.' },
    ],
    responses: {
      202: 'The graph is above the threshold; an export job was created.',
    },
  },
  'POST /api/export/sync': {
    summary: 'Export a graph and return the document.',
    request: 'ExportRequest',
    requestRequired: true,
    response: 'ExportDocument',
    auth: 'required',
    graphScoped: true,
  },
  'POST /api/export/validate': {
    summary: 'Check that an export document is well formed.',
    request: 'ExportDocument',
    requestRequired: true,
    response: 'ValidationReport',
    auth: 'required',
  },
  'POST /api/export/jobs': {
    summary: 'Create an export job.',
    request: 'ExportRequest',
    requestRequired: true,
    response: 'ExportJobCreated',
    status: 202,
    auth: 'required',
    graphScoped: true,
  },
  'GET /api/export/jobs': {
    summary: 'The export jobs.',
    response: 'Job',
    responseIsList: true,
    auth: 'required',
    query: [
      { name: 'status', type: 'string', description: 'Only the jobs with this status.' },
      ...LIMIT_OFFSET,
    ],
  },
  'GET /api/export/jobs/:jobId': {
    summary: 'One export job.',
    response: 'Job',
    auth: 'required',
  },
  'DELETE /api/export/jobs/:jobId': {
    summary: 'Cancel a running export job, or delete a finished one.',
    response: 'GenericObject',
    auth: 'required',
  },
  'GET /api/export/jobs/:jobId/download': {
    summary: 'Download the file an export job wrote.',
    response: 'ExportDocument',
    auth: 'required',
    producesFile: true,
  },
  'GET /api/export/stats': {
    summary: 'How many export jobs there are, and how they ended.',
    response: 'GenericObject',
    auth: 'required',
  },

  // --- import --------------------------------------------------------------
  'POST /api/import/validate': {
    summary:
      'Check that an export document can be imported. The key is only checked ' +
      'for being present: the import routes do not verify it yet.',
    request: 'ExportDocument',
    requestRequired: true,
    response: 'ValidationReport',
    envelope: 'bare',
    auth: 'required',
  },
  'POST /api/import/validate-incremental': {
    summary: 'Check that an export document can be imported into a graph that already exists.',
    request: 'IncrementalValidationRequest',
    requestRequired: true,
    response: 'ValidationReport',
    envelope: 'bare',
    auth: 'required',
  },
  'POST /api/import/preview': {
    summary: 'What an import would change, without changing it.',
    request: 'ImportPreviewRequest',
    requestRequired: true,
    response: 'GenericObject',
    envelope: 'bare',
    auth: 'required',
  },
  'POST /api/import': {
    summary: 'Import an export document into a graph.',
    request: 'ImportRequest',
    requestRequired: true,
    response: 'ImportJob',
    envelope: 'bare',
    status: 201,
    auth: 'required',
    responses: {
      202: 'The import is running as a job.',
      409: 'An import is already running for this graph, or the idempotency key was used.',
    },
  },
  'GET /api/import/jobs/:jobId': {
    summary: 'One import job.',
    response: 'ImportJob',
    envelope: 'bare',
    auth: 'required',
  },
  'POST /api/import/jobs/:jobId/cancel': {
    summary: 'Cancel a running import job.',
    response: 'GenericObject',
    auth: 'required',
  },

  // --- ingest --------------------------------------------------------------
  'POST /api/ingest/url': {
    summary: 'Extract entities from a web page.',
    request: 'IngestUrlRequest',
    requestRequired: true,
    response: 'IngestPreview',
    envelope: 'bare',
    auth: 'required',
  },
  'POST /api/ingest/wikidata': {
    summary: 'Extract entities from Wikidata.',
    request: 'IngestWikidataRequest',
    requestRequired: true,
    response: 'IngestPreview',
    envelope: 'bare',
    auth: 'required',
  },
  'POST /api/ingest/text': {
    summary: 'Extract entities from a piece of text.',
    request: 'IngestTextRequest',
    requestRequired: true,
    response: 'IngestPreview',
    envelope: 'bare',
    auth: 'required',
  },
  'GET /api/ingest/jobs/:id/preview': {
    summary: 'The entities an extraction found, for review.',
    response: 'IngestPreview',
    envelope: 'bare',
    auth: 'required',
  },
  'GET /api/ingest/jobs/:id': {
    summary: 'One extraction job.',
    response: 'IngestPreview',
    envelope: 'bare',
    auth: 'required',
  },
  'POST /api/ingest/jobs/:id/approve': {
    summary: 'Approve the entities an extraction found, so they are imported.',
    request: 'GenericObject',
    response: 'GenericObject',
    envelope: 'bare',
    auth: 'required',
    graphScoped: true,
  },
  'DELETE /api/ingest/jobs/:id': {
    summary: 'Discard an extraction and the entities it found.',
    response: 'GenericObject',
    envelope: 'bare',
    auth: 'required',
  },

  // --- keys ----------------------------------------------------------------
  'GET /api/keys': {
    summary: 'The API keys, with their pagination.',
    response: 'ApiKeyList',
    envelope: 'bare',
    auth: 'required',
    query: PAGE,
  },
  'POST /api/keys': {
    summary: 'Create an API key. The secret is returned once, and only once.',
    request: 'ApiKeyRequest',
    requestRequired: true,
    response: 'CreateApiKeyResponse',
    envelope: 'bare',
    status: 201,
    auth: 'required',
  },
  'GET /api/keys/me': {
    summary: 'The key the request was made with.',
    response: 'ApiKey',
    envelope: 'bare',
    auth: 'required',
  },
  'GET /api/keys/stats': {
    summary: 'How many keys there are, and how they are used.',
    response: 'GenericObject',
    envelope: 'bare',
    auth: 'required',
  },
  'GET /api/keys/:id': {
    summary: 'One API key.',
    response: 'ApiKey',
    envelope: 'bare',
    auth: 'required',
  },
  'GET /api/keys/:id/usage': {
    summary: 'How much of the key\'s rate limits has been used.',
    response: 'ApiKeyUsage',
    envelope: 'bare',
    auth: 'required',
  },
  'PUT /api/keys/:id': {
    summary: 'Change an API key: its name, its permissions or the graphs it may read.',
    request: 'ApiKeyUpdate',
    response: 'ApiKey',
    envelope: 'bare',
    auth: 'required',
  },
  'POST /api/keys/:id/revoke': {
    summary: 'Revoke an API key, without deleting it.',
    response: 'GenericObject',
    envelope: 'bare',
    auth: 'required',
  },
  'DELETE /api/keys/:id': {
    summary: 'Delete an API key.',
    response: 'GenericObject',
    auth: 'required',
  },

  // --- batch ---------------------------------------------------------------
  'POST /api/batch/events': {
    summary: 'Create many events at once.',
    request: 'BatchEventsRequest',
    requestRequired: true,
    response: 'BatchResult',
    status: 201,
    auth: 'required',
    graphScoped: true,
    responses: { 207: 'Some of the entities were rejected; the rest were created.' },
  },
  'POST /api/batch/arcs': {
    summary: 'Create many arcs at once.',
    request: 'BatchArcsRequest',
    requestRequired: true,
    response: 'BatchResult',
    status: 201,
    auth: 'required',
    graphScoped: true,
    responses: { 207: 'Some of the entities were rejected; the rest were created.' },
  },
  'POST /api/batch/relationships': {
    summary: 'Create many causal relationships at once.',
    request: 'BatchRelationshipsRequest',
    requestRequired: true,
    response: 'BatchResult',
    status: 201,
    auth: 'required',
    graphScoped: true,
    responses: { 207: 'Some of the entities were rejected; the rest were created.' },
  },
  'POST /api/batch/transaction': {
    summary: 'Apply many changes at once, atomically: either all of them land, or none do.',
    request: 'BatchTransactionRequest',
    requestRequired: true,
    response: 'BatchTransactionResult',
    auth: 'required',
    graphScoped: true,
  },

  // --- stream --------------------------------------------------------------
  'POST /api/stream/token': {
    summary:
      'Issue a short-lived token for a WebSocket write session. The graph comes ' +
      'from the `X-Graph-Id` header; a `graphId` in the body is ignored.',
    request: 'StreamTokenRequest',
    response: 'StreamToken',
    envelope: 'bare',
    status: 201,
    auth: 'required',
    graphScoped: true,
  },
}
