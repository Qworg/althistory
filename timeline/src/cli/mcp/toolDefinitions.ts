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
      items?: { type: string };
      minItems?: number;
      maxItems?: number;
    }>;
    required?: string[];
  };
}

/** The timestamp note every authoring tool carries, so an agent working on an invented world dates correctly. */
const STORED_DATE_NOTE =
  "An ISO 8601 stored date. For a graph with a world calendar, the world's year N is stored as year N + epochYear - 1 " +
  '(althistory_export_context states the offset).';

export const MCP_TOOLS: McpToolDefinition[] = [
  {
    name: 'althistory_list_graphs',
    description: 'List the history graphs in the store (real, alternate and invented), with their calendars',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'althistory_create_graph',
    description:
      'Create an empty history graph to write into, optionally with an invented world\'s calendar: either a simple one (the Gregorian calendar with the world\'s own year count and month names), or calendars of any shape (`calendar`)',
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Name of the graph, e.g. the world or the history',
        },
        description: {
          type: 'string',
          description: 'What the history is about',
        },
        epochYear: {
          type: 'number',
          description: "For an invented world: the stored year that is the world's year 1 (e.g. 1000). The world's year N is then stored as year N + epochYear - 1.",
        },
        eraLabel: {
          type: 'string',
          description: 'Written after a world year, as in "312 AR". Without one, years read "Year 312". Needs epochYear.',
        },
        calendarName: {
          type: 'string',
          description: "What the world's calendar is called, e.g. \"the Reckoning of the Rising\". Needs epochYear.",
        },
        monthNames: {
          type: 'array',
          items: { type: 'string' },
          minItems: 12,
          maxItems: 12,
          description: "The world's twelve month names, January's first, so March 4 reads e.g. \"Thaw 4\". The months keep their stored lengths. Needs epochYear.",
        },
        calendar: {
          type: 'object',
          description:
            "An invented world's own calendars, of any shape, instead of the simple fields above: { version: 2, dayLength (seconds in the world's day, 86400 for Earth's), calendars: [{ id, name, parts: [{ name, days, intercalary? }] (months, and festival days that belong to no month), leapRules?: [{ every, offset?, part, days }], epoch (the timeline day year 1 begins on), eras?: [{ label, from }], beforeEra?, week?: { days, epochWeekday?, skipsIntercalary? }, time?: { hoursPerDay, minutesPerHour, secondsPerMinute }, notation?: { date, month, year, festival, time } }], primary (the id shown by default) }. See docs/specs/world-calendars.md.",
        },
      },
      required: ['name'],
    },
  },
  {
    name: 'althistory_set_calendar',
    description:
      "Give a graph an invented world's calendars, or remove them with clear. Either the simple fields (the Gregorian calendar with the world's year count and month names), or `calendar`: calendars of any shape (any months and lengths, festival days, leap rules, weeks, hours, eras; several at once). Positions on the timeline do not move; the calendars name them. It replaces the graph's whole calendar.",
    inputSchema: {
      type: 'object',
      properties: {
        graphId: {
          type: 'string',
          description: 'The graph to change',
        },
        epochYear: {
          type: 'number',
          description: "For an invented world: the stored year that is the world's year 1 (e.g. 1000). The world's year N is then stored as year N + epochYear - 1.",
        },
        eraLabel: {
          type: 'string',
          description: 'Written after a world year, as in "312 AR". Without one, years read "Year 312". Needs epochYear.',
        },
        calendarName: {
          type: 'string',
          description: "What the world's calendar is called, e.g. \"the Reckoning of the Rising\". Needs epochYear.",
        },
        monthNames: {
          type: 'array',
          items: { type: 'string' },
          minItems: 12,
          maxItems: 12,
          description: "The world's twelve month names, January's first, so March 4 reads e.g. \"Thaw 4\". The months keep their stored lengths. Needs epochYear.",
        },
        calendar: {
          type: 'object',
          description:
            "An invented world's own calendars, of any shape, instead of the simple fields above: { version: 2, dayLength (seconds in the world's day, 86400 for Earth's), calendars: [{ id, name, parts: [{ name, days, intercalary? }] (months, and festival days that belong to no month), leapRules?: [{ every, offset?, part, days }], epoch (the timeline day year 1 begins on), eras?: [{ label, from }], beforeEra?, week?: { days, epochWeekday?, skipsIntercalary? }, time?: { hoursPerDay, minutesPerHour, secondsPerMinute }, notation?: { date, month, year, festival, time } }], primary (the id shown by default) }. See docs/specs/world-calendars.md.",
        },
        clear: {
          type: 'boolean',
          description: 'Remove the calendar, so years show as stored',
          default: false,
        },
      },
      required: ['graphId'],
    },
  },
  {
    name: 'althistory_create_event',
    description: 'Add an event to a graph: what happened, when, who did it and to whom, and optionally the arc (age or period) it belongs to',
    inputSchema: {
      type: 'object',
      properties: {
        graphId: {
          type: 'string',
          description: 'Target timeline graph ID',
        },
        description: {
          type: 'string',
          description: 'What happened',
        },
        timestamp: {
          type: 'string',
          description: `When it happened (e.g. 1914-06-28T10:45:00Z). ${STORED_DATE_NOTE}`,
        },
        actor: {
          type: 'string',
          description: 'Primary entity, nation, or figure initiating the event',
        },
        target: {
          type: 'string',
          description: 'Entity, nation, or figure targeted or affected by the event',
        },
        arcId: {
          type: 'string',
          description: 'The arc to put the event in (from althistory_create_arc)',
        },
      },
      required: ['graphId', 'description', 'timestamp'],
    },
  },
  {
    name: 'althistory_create_arc',
    description: 'Add an arc to a graph: an age, era, reign or campaign that holds events. An arc can sit inside another.',
    inputSchema: {
      type: 'object',
      properties: {
        graphId: {
          type: 'string',
          description: 'Target timeline graph ID',
        },
        name: {
          type: 'string',
          description: 'Name of the arc, e.g. "The Age of Salt"',
        },
        startTime: {
          type: 'string',
          description: `When the arc begins. ${STORED_DATE_NOTE}`,
        },
        endTime: {
          type: 'string',
          description: `When the arc ends. ${STORED_DATE_NOTE}`,
        },
        description: {
          type: 'string',
          description: 'What the arc is about',
        },
        parentArcId: {
          type: 'string',
          description: 'The arc this one sits inside (a reign inside an age)',
        },
      },
      required: ['graphId', 'name', 'startTime', 'endTime'],
    },
  },
  {
    name: 'althistory_assign_to_arc',
    description: 'Put an existing event inside an arc',
    inputSchema: {
      type: 'object',
      properties: {
        graphId: {
          type: 'string',
          description: 'Target timeline graph ID',
        },
        eventId: {
          type: 'string',
          description: 'The event to place',
        },
        arcId: {
          type: 'string',
          description: 'The arc to put it in',
        },
      },
      required: ['graphId', 'eventId', 'arcId'],
    },
  },
  {
    name: 'althistory_link_events',
    description:
      'Record that one event caused another. The cause may not come after the effect; a link that would go back in time is refused.',
    inputSchema: {
      type: 'object',
      properties: {
        graphId: {
          type: 'string',
          description: 'Target timeline graph ID',
        },
        causeId: {
          type: 'string',
          description: 'The event that brought the other about',
        },
        effectId: {
          type: 'string',
          description: 'The event it brought about',
        },
        type: {
          type: 'string',
          enum: ['direct', 'indirect', 'contributory'],
          description: 'How the cause worked: directly, through intermediate events, or as one factor among several',
          default: 'direct',
        },
        weight: {
          type: 'number',
          description: 'How strong the link is, from 0 to 1',
          default: 1,
        },
        reasoning: {
          type: 'string',
          description: 'Why the cause led to the effect, in a sentence',
        },
      },
      required: ['graphId', 'causeId', 'effectId'],
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
    description:
      'Draft a new graph whole-cloth: an alternate history from a premise and point of divergence, or the chronicle of an invented world from a description of it. ' +
      'A model writes it when the server has ANTHROPIC_API_KEY or OPENAI_API_KEY; otherwise it is a template to rewrite.',
    inputSchema: {
      type: 'object',
      properties: {
        premise: {
          type: 'string',
          description: 'For an alternate history: the what-if (e.g., "The Spanish Armada conquers England in 1588"). Needs divergencePoint.',
        },
        divergencePoint: {
          type: 'string',
          description: 'For an alternate history: the historical pivot where history diverges from what really happened. Needs premise.',
        },
        world: {
          type: 'string',
          description:
            'For an invented world, instead of premise and divergencePoint: the world in a few sentences. The graph gets a calendar (epochYear defaults to the start year, or 1000).',
        },
        epochYear: {
          type: 'number',
          description: "For an invented world: the stored year that is the world's year 1 (e.g. 1000). The world's year N is then stored as year N + epochYear - 1.",
        },
        eraLabel: {
          type: 'string',
          description: 'Written after a world year, as in "312 AR". Without one, years read "Year 312". With world.',
        },
        calendarName: {
          type: 'string',
          description: "What the world's calendar is called, e.g. \"the Reckoning of the Rising\". With world.",
        },
        monthNames: {
          type: 'array',
          items: { type: 'string' },
          minItems: 12,
          maxItems: 12,
          description: "The world's twelve month names, January's first, so March 4 reads e.g. \"Thaw 4\". The months keep their stored lengths. With world.",
        },
        startDate: {
          type: 'string',
          description: 'Starting ISO timestamp for timeline generation',
        },
        endDate: {
          type: 'string',
          description: 'Ending ISO timestamp for timeline generation (an invented world defaults to 300 years after the start)',
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
    },
  },
  {
    name: 'althistory_branch_timeline',
    description:
      'Branch a graph at one of its events and draft a different course from there. A branch of an invented world stays in that world and its calendar.',
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
          description: 'Number of events to generate after the branch point',
          default: 6,
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
    name: 'althistory_simulate_timeline',
    description:
      'Autonomously evolve a timeline forward from a point of divergence, synthesising pressure-driven milestone events and causal links',
    inputSchema: {
      type: 'object',
      properties: {
        graphId: {
          type: 'string',
          description: 'Timeline graph ID to evolve forward',
        },
        steps: {
          type: 'number',
          description: 'Number of forward hops to simulate (1-10)',
          default: 3,
        },
        timeAdvanceMonths: {
          type: 'number',
          description: 'Months of history advanced per hop',
          default: 12,
        },
        anchorEventId: {
          type: 'string',
          description: 'Point of divergence event ID (defaults to the latest event)',
        },
        domain: {
          type: 'string',
          enum: ['political', 'military', 'economic', 'scientific', 'social', 'environmental'],
          description: 'Dominant domain to evolve (defaults to the strongest inferred pressure)',
        },
        aggressiveness: {
          type: 'number',
          description: 'Causal pressure bias between 0 and 1',
          default: 0.5,
        },
        seedContext: {
          type: 'string',
          description: 'Optional premise recorded on every generated event',
        },
        dryRun: {
          type: 'boolean',
          description: 'Preview the simulation without persisting',
          default: false,
        },
      },
      required: ['graphId'],
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
    description:
      'Read a whole graph back: Markdown tables of arcs, events and causal links with their ids (dated in the world\'s calendar when the graph has one), JSON, or Graphviz DOT',
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
