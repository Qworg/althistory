/**
 * Tool definitions and JSON schemas for Model Context Protocol (MCP) server.
 */

export interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, {
      type: string;
      description: string;
      enum?: string[];
      default?: unknown;
    }>;
    required?: string[];
  };
}

export const MCP_TOOLS: McpToolDefinition[] = [
  {
    name: 'althistory_list_graphs',
    description: 'List all alternate history graphs in the store with version metadata and entity counts',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'althistory_create_event',
    description: 'Create a historical event within a timeline graph with temporal placement and participants',
    inputSchema: {
      type: 'object',
      properties: {
        graphId: {
          type: 'string',
          description: 'Target timeline graph ID',
        },
        description: {
          type: 'string',
          description: 'Description of the historical event',
        },
        timestamp: {
          type: 'string',
          description: 'ISO 8601 timestamp of the event (e.g. 1914-06-28T10:45:00Z)',
        },
        actor: {
          type: 'string',
          description: 'Primary entity, nation, or figure initiating the event',
        },
        target: {
          type: 'string',
          description: 'Entity, nation, or figure targeted or affected by the event',
        },
      },
      required: ['graphId', 'description', 'timestamp'],
    },
  },
  {
    name: 'althistory_ingest_text',
    description: 'Extract historical events, chronological narrative arcs, and causal connections from unstructured text',
    inputSchema: {
      type: 'object',
      properties: {
        text: {
          type: 'string',
          description: 'Source historical text to parse and extract',
        },
        graphId: {
          type: 'string',
          description: 'Target graph ID (creates a new timeline if omitted)',
        },
        mode: {
          type: 'string',
          enum: ['pattern', 'llm', 'hybrid'],
          description: 'Extraction strategy (pattern-based regex, neural LLM, or hybrid)',
          default: 'hybrid',
        },
        groupArcs: {
          type: 'boolean',
          description: 'Automatically cluster extracted events into hierarchical narrative arcs',
          default: true,
        },
        inferCauses: {
          type: 'boolean',
          description: 'Automatically infer cause-and-effect relationships among events',
          default: true,
        },
        dryRun: {
          type: 'boolean',
          description: 'Preview extracted entities without persisting to graph storage',
          default: false,
        },
      },
      required: ['text'],
    },
  },
  {
    name: 'althistory_generate_timeline',
    description: 'Generate a whole-cloth counterfactual alternate history timeline from a what-if premise and point of divergence',
    inputSchema: {
      type: 'object',
      properties: {
        premise: {
          type: 'string',
          description: 'The core counterfactual premise (e.g., "The Spanish Armada conquers England in 1588")',
        },
        divergencePoint: {
          type: 'string',
          description: 'The exact historical pivot where history diverges from baseline reality',
        },
        startDate: {
          type: 'string',
          description: 'Starting ISO timestamp for timeline generation',
        },
        endDate: {
          type: 'string',
          description: 'Ending ISO timestamp for timeline generation',
        },
        eventCount: {
          type: 'number',
          description: 'Target count of milestone events to generate',
          default: 8,
        },
        style: {
          type: 'string',
          enum: ['academic', 'narrative', 'concise'],
          description: 'Prose style for generated descriptions',
          default: 'academic',
        },
        dryRun: {
          type: 'boolean',
          description: 'Preview generation without persisting to the database',
          default: false,
        },
      },
      required: ['premise', 'divergencePoint'],
    },
  },
  {
    name: 'althistory_branch_timeline',
    description: 'Branch an existing timeline graph at a specific historical event with a new counterfactual trajectory',
    inputSchema: {
      type: 'object',
      properties: {
        sourceGraphId: {
          type: 'string',
          description: 'ID of the parent timeline graph to fork from',
        },
        divergeAtEventId: {
          type: 'string',
          description: 'ID of the pivot event where reality branches',
        },
        counterfactualPrompt: {
          type: 'string',
          description: 'Description of the divergent historical turn',
        },
        branchName: {
          type: 'string',
          description: 'Name for the newly created branch timeline',
        },
        eventCount: {
          type: 'number',
          description: 'Number of counterfactual events to generate following divergence',
          default: 5,
        },
        dryRun: {
          type: 'boolean',
          description: 'Preview the branch without persisting',
          default: false,
        },
      },
      required: ['sourceGraphId', 'divergeAtEventId', 'counterfactualPrompt', 'branchName'],
    },
  },
  {
    name: 'althistory_query_causal_path',
    description: 'Trace all causal pathways connecting a cause event to an effect event across the historical DAG',
    inputSchema: {
      type: 'object',
      properties: {
        graphId: {
          type: 'string',
          description: 'Timeline graph ID to search',
        },
        fromEventId: {
          type: 'string',
          description: 'ID of starting root cause event',
        },
        toEventId: {
          type: 'string',
          description: 'ID of target downstream effect event',
        },
      },
      required: ['graphId', 'fromEventId', 'toEventId'],
    },
  },
  {
    name: 'althistory_validate_graph',
    description: 'Validate temporal boundaries, arc containment, causal consistency, and cycle-free DAG rules, with self-healing auto-repair',
    inputSchema: {
      type: 'object',
      properties: {
        graphId: {
          type: 'string',
          description: 'Timeline graph ID to validate',
        },
        strict: {
          type: 'boolean',
          description: 'Treat structural warnings as validation failures',
          default: false,
        },
        autoRepair: {
          type: 'boolean',
          description: 'Automatically repair inverted arcs, boundary containment, paradoxes, and cycles',
          default: false,
        },
      },
      required: ['graphId'],
    },
  },
  {
    name: 'althistory_export_context',
    description: 'Export timeline context in LLM-optimized Markdown tables, JSON, or Graphviz DOT for agent prompts and reasoning',
    inputSchema: {
      type: 'object',
      properties: {
        graphId: {
          type: 'string',
          description: 'Timeline graph ID to export',
        },
        format: {
          type: 'string',
          enum: ['markdown', 'json', 'dot'],
          description: 'Output format (markdown is optimized for LLM context injection)',
          default: 'markdown',
        },
      },
      required: ['graphId'],
    },
  },
];
