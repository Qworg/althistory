import { Command } from 'commander';
import { ExecutionContext } from './engine/ExecutionContext';
import { formatOutput, formatErrorJson } from './formatters';
import { GlobalCLIOptions, OutputFormat } from './types';
import { CLIError, ExitCode } from './utils/exitCodes';
import { logger } from './utils/logger';

export function createProgram(): Command {
  const program = new Command();

  program
    .name('althistory')
    .description('Althistory CLI: Agent-First temporal and causal history manipulation')
    .version('1.0.0');

  // Global options
  program
    .option('-j, --json', 'Output machine-readable JSON envelope to stdout')
    .option('--ndjson', 'Output newline-delimited JSON for stream processing')
    .option('--markdown', 'Output formatted Markdown where applicable')
    .option('--plain', 'Output simple plain text')
    .option('--direct', 'Execute in-process directly against local storage (bypass daemon)')
    .option('--url <url>', 'Backend daemon URL (default: http://localhost:3000)')
    .option('--api-key <key>', 'API key for authenticating with remote daemon')
    .option('-q, --quiet', 'Suppress advisory logs and progress on stderr')
    .option('-v, --verbose', 'Print debug traces to stderr');

  function getFormat(opts: GlobalCLIOptions): OutputFormat {
    if (opts.ndjson) return 'ndjson';
    if (opts.plain) return 'plain';
    if (opts.markdown) return 'markdown';
    return 'json'; // Default to JSON for agents
  }

  // --- Health / Info Command ---
  program
    .command('status')
    .alias('health')
    .alias('ping')
    .description('Check system health and execution mode')
    .action(async () => {
      const opts = program.opts<GlobalCLIOptions>();
      const ctx = new ExecutionContext(opts);
      const start = Date.now();
      try {
        const engine = await ctx.getEngine();
        const health = await engine.getHealth();
        const output = formatOutput(health, getFormat(opts), engine.mode, {
          durationMs: Date.now() - start,
        });
        process.stdout.write(output + '\n');
      } finally {
        await ctx.shutdown();
      }
    });

  // --- Graph Commands ---
  const graphCmd = program.command('graph').description('Manage historical timeline graphs');

  graphCmd
    .command('list')
    .description('List all available graphs')
    .action(async () => {
      const opts = program.opts<GlobalCLIOptions>();
      const ctx = new ExecutionContext(opts);
      const start = Date.now();
      try {
        const engine = await ctx.getEngine();
        const graphs = await engine.listGraphs();
        const output = formatOutput(graphs, getFormat(opts), engine.mode, {
          durationMs: Date.now() - start,
        });
        process.stdout.write(output + '\n');
      } finally {
        await ctx.shutdown();
      }
    });

  graphCmd
    .command('create <name>')
    .description('Create a new historical graph')
    .option('-d, --description <desc>', 'Graph description')
    .action(async (name: string, cmdOpts: { description?: string }) => {
      const opts = program.opts<GlobalCLIOptions>();
      const ctx = new ExecutionContext(opts);
      const start = Date.now();
      try {
        const engine = await ctx.getEngine();
        const graph = await engine.createGraph(name, cmdOpts.description);
        const output = formatOutput(graph, getFormat(opts), engine.mode, {
          durationMs: Date.now() - start,
          graphId: graph.id,
        });
        process.stdout.write(output + '\n');
      } finally {
        await ctx.shutdown();
      }
    });

  graphCmd
    .command('info <id>')
    .alias('get')
    .description('Get metadata and statistics for a graph')
    .action(async (id: string) => {
      const opts = program.opts<GlobalCLIOptions>();
      const ctx = new ExecutionContext(opts);
      const start = Date.now();
      try {
        const engine = await ctx.getEngine();
        const graph = await engine.getGraph(id);
        const output = formatOutput(graph, getFormat(opts), engine.mode, {
          durationMs: Date.now() - start,
          graphId: graph.id,
        });
        process.stdout.write(output + '\n');
      } finally {
        await ctx.shutdown();
      }
    });

  graphCmd
    .command('branch <id> <name>')
    .description('Branch an existing history graph')
    .action(async (id: string, name: string) => {
      const opts = program.opts<GlobalCLIOptions>();
      const ctx = new ExecutionContext(opts);
      const start = Date.now();
      try {
        const engine = await ctx.getEngine();
        const branched = await engine.branchGraph(id, name);
        const output = formatOutput(branched, getFormat(opts), engine.mode, {
          durationMs: Date.now() - start,
          graphId: branched.id,
        });
        process.stdout.write(output + '\n');
      } finally {
        await ctx.shutdown();
      }
    });

  graphCmd
    .command('merge <sourceId> <targetId>')
    .description('Merge changes from source graph into target graph')
    .option('--strategy <strategy>', 'Conflict resolution strategy: keep-source or keep-target', 'keep-source')
    .action(async (sourceId: string, targetId: string, cmdOpts?: Record<string, unknown>) => {
      const opts = program.opts<GlobalCLIOptions>();
      const ctx = new ExecutionContext(opts);
      const start = Date.now();
      try {
        const engine = await ctx.getEngine();
        const res = await engine.mergeGraph(sourceId, targetId, cmdOpts?.strategy as string | undefined);
        const output = formatOutput(res, getFormat(opts), engine.mode, {
          durationMs: Date.now() - start,
          graphId: targetId,
        });
        process.stdout.write(output + '\n');
      } finally {
        await ctx.shutdown();
      }
    });

  graphCmd
    .command('diff <sourceId> <targetId>')
    .description('Compute entity diff between two history graphs')
    .action(async (sourceId: string, targetId: string) => {
      const opts = program.opts<GlobalCLIOptions>();
      const ctx = new ExecutionContext(opts);
      const start = Date.now();
      try {
        const engine = await ctx.getEngine();
        const diff = await engine.diffGraph(sourceId, targetId);
        const output = formatOutput(diff, getFormat(opts), engine.mode, {
          durationMs: Date.now() - start,
        });
        process.stdout.write(output + '\n');
      } finally {
        await ctx.shutdown();
      }
    });

  graphCmd
    .command('rollback <id> <version>')
    .description('Roll back graph to a previous version')
    .action(async (id: string, version: string) => {
      const opts = program.opts<GlobalCLIOptions>();
      const ctx = new ExecutionContext(opts);
      const start = Date.now();
      try {
        const engine = await ctx.getEngine();
        const res = await engine.rollbackGraph(id, version);
        const output = formatOutput(res, getFormat(opts), engine.mode, {
          durationMs: Date.now() - start,
          graphId: id,
        });
        process.stdout.write(output + '\n');
      } finally {
        await ctx.shutdown();
      }
    });

  graphCmd
    .command('delete <id>')
    .description('Permanently delete a graph and its timeline contents')
    .action(async (id: string) => {
      const opts = program.opts<GlobalCLIOptions>();
      const ctx = new ExecutionContext(opts);
      const start = Date.now();
      try {
        const engine = await ctx.getEngine();
        await engine.deleteGraph(id);
        const output = formatOutput({ success: true, deleted: id }, getFormat(opts), engine.mode, {
          durationMs: Date.now() - start,
          graphId: id,
        });
        process.stdout.write(output + '\n');
      } finally {
        await ctx.shutdown();
      }
    });

  // --- Event Commands (Phase 4) ---
  const eventCmd = program.command('event').description('Manage historical events within a timeline graph');

  eventCmd
    .command('add [description]')
    .description('Add a new historical event to a graph')
    .requiredOption('-g, --graph-id <id>', 'Target graph ID')
    .requiredOption('-t, --timestamp <iso>', 'Event occurrence timestamp (ISO-8601)')
    .requiredOption('-a, --actor <actor>', 'Primary actor or entity')
    .requiredOption('--target <target>', 'Target actor or entity')
    .option('-d, --desc <description>', 'Event description')
    .option('--importance <val>', 'Significance weighting (0 to 1)', '1')
    .action(async (inlineDesc?: string, cmdOpts?: Record<string, unknown>) => {
      const opts = program.opts<GlobalCLIOptions>();
      const ctx = new ExecutionContext(opts);
      const start = Date.now();
      try {
        const engine = await ctx.getEngine();
        const desc = inlineDesc || (cmdOpts?.desc as string) || '';
        if (!desc.trim()) {
          throw new CLIError('Description is required', ExitCode.VALIDATION_FAILED);
        }
        const event = await engine.createEvent(String(cmdOpts?.graphId), {
          description: desc,
          timestamp: String(cmdOpts?.timestamp),
          actor: String(cmdOpts?.actor),
          target: String(cmdOpts?.target),
          importance: cmdOpts?.importance ? parseFloat(String(cmdOpts.importance)) : 1,
        });
        const output = formatOutput(event, getFormat(opts), engine.mode, {
          durationMs: Date.now() - start,
          graphId: String(cmdOpts?.graphId),
        });
        process.stdout.write(output + '\n');
      } finally {
        await ctx.shutdown();
      }
    });

  eventCmd
    .command('list')
    .description('List events in a graph with optional filtering')
    .requiredOption('-g, --graph-id <id>', 'Target graph ID')
    .option('-a, --actor <actor>', 'Filter events by actor name')
    .option('--from <iso>', 'Filter events on or after timestamp')
    .option('--to <iso>', 'Filter events on or before timestamp')
    .action(async (cmdOpts?: Record<string, unknown>) => {
      const opts = program.opts<GlobalCLIOptions>();
      const ctx = new ExecutionContext(opts);
      const start = Date.now();
      try {
        const engine = await ctx.getEngine();
        const events = await engine.listEvents(String(cmdOpts?.graphId), {
          actor: cmdOpts?.actor as string | undefined,
          from: cmdOpts?.from as string | undefined,
          to: cmdOpts?.to as string | undefined,
        });
        const output = formatOutput(events, getFormat(opts), engine.mode, {
          durationMs: Date.now() - start,
          graphId: String(cmdOpts?.graphId),
        });
        process.stdout.write(output + '\n');
      } finally {
        await ctx.shutdown();
      }
    });

  eventCmd
    .command('get <id>')
    .description('Get an event by ID')
    .requiredOption('-g, --graph-id <id>', 'Target graph ID')
    .action(async (id: string, cmdOpts?: Record<string, unknown>) => {
      const opts = program.opts<GlobalCLIOptions>();
      const ctx = new ExecutionContext(opts);
      const start = Date.now();
      try {
        const engine = await ctx.getEngine();
        const event = await engine.getEvent(String(cmdOpts?.graphId), id);
        const output = formatOutput(event, getFormat(opts), engine.mode, {
          durationMs: Date.now() - start,
          graphId: String(cmdOpts?.graphId),
        });
        process.stdout.write(output + '\n');
      } finally {
        await ctx.shutdown();
      }
    });

  eventCmd
    .command('update <id>')
    .description('Update an existing event')
    .requiredOption('-g, --graph-id <id>', 'Target graph ID')
    .option('-d, --description <desc>', 'New description')
    .option('-t, --timestamp <iso>', 'New timestamp (ISO-8601)')
    .option('-a, --actor <actor>', 'New actor')
    .option('--target <target>', 'New target')
    .action(async (id: string, cmdOpts?: Record<string, unknown>) => {
      const opts = program.opts<GlobalCLIOptions>();
      const ctx = new ExecutionContext(opts);
      const start = Date.now();
      try {
        const engine = await ctx.getEngine();
        const updated = await engine.updateEvent(String(cmdOpts?.graphId), id, {
          description: cmdOpts?.description as string | undefined,
          timestamp: cmdOpts?.timestamp as string | undefined,
          actor: cmdOpts?.actor as string | undefined,
          target: cmdOpts?.target as string | undefined,
        });
        const output = formatOutput(updated, getFormat(opts), engine.mode, {
          durationMs: Date.now() - start,
          graphId: String(cmdOpts?.graphId),
        });
        process.stdout.write(output + '\n');
      } finally {
        await ctx.shutdown();
      }
    });

  eventCmd
    .command('delete <id>')
    .description('Delete an event from a graph')
    .requiredOption('-g, --graph-id <id>', 'Target graph ID')
    .action(async (id: string, cmdOpts?: Record<string, unknown>) => {
      const opts = program.opts<GlobalCLIOptions>();
      const ctx = new ExecutionContext(opts);
      const start = Date.now();
      try {
        const engine = await ctx.getEngine();
        await engine.deleteEvent(String(cmdOpts?.graphId), id);
        const output = formatOutput({ success: true, deleted: id }, getFormat(opts), engine.mode, {
          durationMs: Date.now() - start,
          graphId: String(cmdOpts?.graphId),
        });
        process.stdout.write(output + '\n');
      } finally {
        await ctx.shutdown();
      }
    });

  // --- Arc Commands (Phase 4) ---
  const arcCmd = program.command('arc').description('Manage narrative and thematic arcs');

  arcCmd
    .command('create <name>')
    .description('Create a new narrative arc in a graph')
    .requiredOption('-g, --graph-id <id>', 'Target graph ID')
    .requiredOption('-s, --start <iso>', 'Arc start timestamp (ISO-8601)')
    .requiredOption('-e, --end <iso>', 'Arc end timestamp (ISO-8601)')
    .option('-d, --description <desc>', 'Arc narrative description')
    .option('-p, --parent <parentArcId>', 'Parent arc ID for hierarchical nesting')
    .action(async (name: string, cmdOpts?: Record<string, unknown>) => {
      const opts = program.opts<GlobalCLIOptions>();
      const ctx = new ExecutionContext(opts);
      const start = Date.now();
      try {
        const engine = await ctx.getEngine();
        const arc = await engine.createArc(String(cmdOpts?.graphId), {
          name,
          startTime: String(cmdOpts?.start),
          endTime: String(cmdOpts?.end),
          description: cmdOpts?.description as string | undefined,
          parentArcId: cmdOpts?.parent as string | undefined,
        });
        const output = formatOutput(arc, getFormat(opts), engine.mode, {
          durationMs: Date.now() - start,
          graphId: String(cmdOpts?.graphId),
        });
        process.stdout.write(output + '\n');
      } finally {
        await ctx.shutdown();
      }
    });

  arcCmd
    .command('list')
    .description('List all arcs in a graph')
    .requiredOption('-g, --graph-id <id>', 'Target graph ID')
    .action(async (cmdOpts?: Record<string, unknown>) => {
      const opts = program.opts<GlobalCLIOptions>();
      const ctx = new ExecutionContext(opts);
      const start = Date.now();
      try {
        const engine = await ctx.getEngine();
        const arcs = await engine.listArcs(String(cmdOpts?.graphId));
        const output = formatOutput(arcs, getFormat(opts), engine.mode, {
          durationMs: Date.now() - start,
          graphId: String(cmdOpts?.graphId),
        });
        process.stdout.write(output + '\n');
      } finally {
        await ctx.shutdown();
      }
    });

  arcCmd
    .command('get <id>')
    .description('Get an arc by ID')
    .requiredOption('-g, --graph-id <id>', 'Target graph ID')
    .action(async (id: string, cmdOpts?: Record<string, unknown>) => {
      const opts = program.opts<GlobalCLIOptions>();
      const ctx = new ExecutionContext(opts);
      const start = Date.now();
      try {
        const engine = await ctx.getEngine();
        const arc = await engine.getArc(String(cmdOpts?.graphId), id);
        const output = formatOutput(arc, getFormat(opts), engine.mode, {
          durationMs: Date.now() - start,
          graphId: String(cmdOpts?.graphId),
        });
        process.stdout.write(output + '\n');
      } finally {
        await ctx.shutdown();
      }
    });

  arcCmd
    .command('delete <id>')
    .description('Delete an arc from a graph')
    .requiredOption('-g, --graph-id <id>', 'Target graph ID')
    .action(async (id: string, cmdOpts?: Record<string, unknown>) => {
      const opts = program.opts<GlobalCLIOptions>();
      const ctx = new ExecutionContext(opts);
      const start = Date.now();
      try {
        const engine = await ctx.getEngine();
        await engine.deleteArc(String(cmdOpts?.graphId), id);
        const output = formatOutput({ success: true, deleted: id }, getFormat(opts), engine.mode, {
          durationMs: Date.now() - start,
          graphId: String(cmdOpts?.graphId),
        });
        process.stdout.write(output + '\n');
      } finally {
        await ctx.shutdown();
      }
    });

  // --- Causal Commands (Phase 4) ---
  const causalCmd = program.command('causal').description('Manage cause-and-effect relationships');

  causalCmd
    .command('link')
    .description('Create a causal link between two events')
    .requiredOption('-g, --graph-id <id>', 'Target graph ID')
    .requiredOption('-c, --cause <eventId>', 'Cause event ID')
    .requiredOption('-e, --effect <eventId>', 'Effect event ID')
    .option('-w, --weight <weight>', 'Causal weight (0 to 1)', '1')
    .option('-t, --type <type>', 'Relationship type: direct, indirect, contributory', 'direct')
    .option('-r, --reasoning <text>', 'Historical or causal reasoning')
    .action(async (cmdOpts?: Record<string, unknown>) => {
      const opts = program.opts<GlobalCLIOptions>();
      const ctx = new ExecutionContext(opts);
      const start = Date.now();
      try {
        const engine = await ctx.getEngine();
        const link = await engine.createCausalLink(String(cmdOpts?.graphId), {
          causeId: String(cmdOpts?.cause),
          effectId: String(cmdOpts?.effect),
          weight: cmdOpts?.weight ? parseFloat(String(cmdOpts.weight)) : 1.0,
          type: (cmdOpts?.type as string) || 'direct',
          reasoning: cmdOpts?.reasoning as string | undefined,
        });
        const output = formatOutput(link, getFormat(opts), engine.mode, {
          durationMs: Date.now() - start,
          graphId: String(cmdOpts?.graphId),
        });
        process.stdout.write(output + '\n');
      } finally {
        await ctx.shutdown();
      }
    });

  causalCmd
    .command('unlink')
    .description('Remove a causal link between two events')
    .requiredOption('-g, --graph-id <id>', 'Target graph ID')
    .requiredOption('-c, --cause <eventId>', 'Cause event ID')
    .requiredOption('-e, --effect <eventId>', 'Effect event ID')
    .action(async (cmdOpts?: Record<string, unknown>) => {
      const opts = program.opts<GlobalCLIOptions>();
      const ctx = new ExecutionContext(opts);
      const start = Date.now();
      try {
        const engine = await ctx.getEngine();
        await engine.deleteCausalLink(String(cmdOpts?.graphId), String(cmdOpts?.cause), String(cmdOpts?.effect));
        const output = formatOutput({ success: true, unlinked: { cause: cmdOpts?.cause, effect: cmdOpts?.effect } }, getFormat(opts), engine.mode, {
          durationMs: Date.now() - start,
          graphId: String(cmdOpts?.graphId),
        });
        process.stdout.write(output + '\n');
      } finally {
        await ctx.shutdown();
      }
    });

  causalCmd
    .command('list')
    .description('List all causal relationships in a graph')
    .requiredOption('-g, --graph-id <id>', 'Target graph ID')
    .action(async (cmdOpts?: Record<string, unknown>) => {
      const opts = program.opts<GlobalCLIOptions>();
      const ctx = new ExecutionContext(opts);
      const start = Date.now();
      try {
        const engine = await ctx.getEngine();
        const rels = await engine.listCausalLinks(String(cmdOpts?.graphId));
        const output = formatOutput(rels, getFormat(opts), engine.mode, {
          durationMs: Date.now() - start,
          graphId: String(cmdOpts?.graphId),
        });
        process.stdout.write(output + '\n');
      } finally {
        await ctx.shutdown();
      }
    });

  causalCmd
    .command('paths')
    .description('Find all causal pathways between two events')
    .requiredOption('-g, --graph-id <id>', 'Target graph ID')
    .requiredOption('--from <eventId>', 'Starting cause event ID')
    .requiredOption('--to <eventId>', 'Target effect event ID')
    .action(async (cmdOpts?: Record<string, unknown>) => {
      const opts = program.opts<GlobalCLIOptions>();
      const ctx = new ExecutionContext(opts);
      const start = Date.now();
      try {
        const engine = await ctx.getEngine();
        const res = await engine.findCausalPaths(String(cmdOpts?.graphId), String(cmdOpts?.from), String(cmdOpts?.to));
        const output = formatOutput(res, getFormat(opts), engine.mode, {
          durationMs: Date.now() - start,
          graphId: String(cmdOpts?.graphId),
        });
        process.stdout.write(output + '\n');
      } finally {
        await ctx.shutdown();
      }
    });

  // --- Ingestion Commands ---
  const ingestCmd = program.command('ingest').description('Ingest historical events from text or web sources');

  ingestCmd
    .command('text [inlineText]')
    .description('Ingest history from text, a file, or stdin pipe')
    .option('-f, --file <path>', 'Path to file containing source text')
    .option('-g, --graph-id <id>', 'Target graph ID (creates new if omitted)')
    .option('--graph-name <name>', 'Name for new graph if creating')
    .option('-m, --mode <mode>', 'Extraction mode: pattern, llm, or hybrid', 'hybrid')
    .option('--provider <provider>', 'LLM provider: openai or anthropic')
    .option('--model <model>', 'LLM model name')
    .option('--temperature <val>', 'LLM sampling temperature')
    .option('--group-arcs', 'Automatically cluster extracted events into narrative arcs')
    .option('--infer-causes', 'Automatically infer cause-and-effect links')
    .option('--min-confidence <threshold>', 'Minimum confidence threshold (0 to 1)')
    .option('--dry-run', 'Preview extraction without saving to graph')
    .action(async (inlineText?: string, cmdOpts?: Record<string, unknown>) => {
      const opts = program.opts<GlobalCLIOptions>();
      const ctx = new ExecutionContext(opts);
      const start = Date.now();
      try {
        let text = inlineText || '';
        if (cmdOpts?.file) {
          const fs = await import('fs');
          text = fs.readFileSync(String(cmdOpts.file), 'utf-8');
        } else if (!text && !process.stdin.isTTY) {
          const chunks: Buffer[] = [];
          for await (const chunk of process.stdin) {
            chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
          }
          text = Buffer.concat(chunks).toString('utf-8').trim();
        }

        if (!text || text.trim().length === 0) {
          throw new CLIError('No text provided. Specify text argument, --file, or pipe input via stdin.', ExitCode.GENERAL_ERROR);
        }

        const validModes = ['pattern', 'llm', 'hybrid'] as const;
        const mode = typeof cmdOpts?.mode === 'string' && (validModes as readonly string[]).includes(cmdOpts.mode)
          ? (cmdOpts.mode as 'pattern' | 'llm' | 'hybrid')
          : 'hybrid';
        const validProviders = ['openai', 'anthropic'] as const;
        const provider = typeof cmdOpts?.provider === 'string' && (validProviders as readonly string[]).includes(cmdOpts.provider)
          ? (cmdOpts.provider as 'openai' | 'anthropic')
          : undefined;

        const engine = await ctx.getEngine();
        const result = await engine.ingestText(cmdOpts?.graphId as string | undefined, text, {
          mode,
          provider,
          model: cmdOpts?.model as string | undefined,
          temperature: cmdOpts?.temperature ? parseFloat(String(cmdOpts.temperature)) : undefined,
          groupArcs: Boolean(cmdOpts?.groupArcs),
          inferCauses: Boolean(cmdOpts?.inferCauses),
          minConfidence: cmdOpts?.minConfidence ? parseFloat(String(cmdOpts.minConfidence)) : undefined,
          dryRun: Boolean(cmdOpts?.dryRun),
          graphName: cmdOpts?.graphName as string | undefined,
        });

        const output = formatOutput(result, getFormat(opts), engine.mode, {
          durationMs: Date.now() - start,
          graphId: result.graphId,
        });
        process.stdout.write(output + '\n');
      } finally {
        await ctx.shutdown();
      }
    });

  ingestCmd
    .command('url <url>')
    .description('Ingest history from a Wikipedia or web document URL')
    .option('-g, --graph-id <id>', 'Target graph ID (creates new if omitted)')
    .option('--graph-name <name>', 'Name for new graph if creating')
    .option('--follow-links', 'Follow internal hyperlinks to related articles')
    .option('--depth <depth>', 'Link following traversal depth (1 to 3)')
    .option('--max-pages <max>', 'Maximum pages to fetch')
    .option('--filter <filter>', 'Regex filter for followed URLs')
    .option('--group-arcs', 'Automatically cluster extracted events into narrative arcs')
    .option('--infer-causes', 'Automatically infer cause-and-effect links')
    .option('--min-confidence <threshold>', 'Minimum confidence threshold (0 to 1)')
    .option('--dry-run', 'Preview extraction without saving to graph')
    .action(async (url: string, cmdOpts?: Record<string, unknown>) => {
      const opts = program.opts<GlobalCLIOptions>();
      const ctx = new ExecutionContext(opts);
      const start = Date.now();
      try {
        const engine = await ctx.getEngine();
        const result = await engine.ingestUrl(cmdOpts?.graphId as string | undefined, url, {
          followLinks: Boolean(cmdOpts?.followLinks),
          depth: cmdOpts?.depth ? parseInt(String(cmdOpts.depth), 10) : undefined,
          maxPages: cmdOpts?.maxPages ? parseInt(String(cmdOpts.maxPages), 10) : undefined,
          filter: cmdOpts?.filter as string | undefined,
          groupArcs: Boolean(cmdOpts?.groupArcs),
          inferCauses: Boolean(cmdOpts?.inferCauses),
          minConfidence: cmdOpts?.minConfidence ? parseFloat(String(cmdOpts.minConfidence)) : undefined,
          dryRun: Boolean(cmdOpts?.dryRun),
          graphName: cmdOpts?.graphName as string | undefined,
        });

        const output = formatOutput(result, getFormat(opts), engine.mode, {
          durationMs: Date.now() - start,
          graphId: result.graphId,
        });
        process.stdout.write(output + '\n');
      } finally {
        await ctx.shutdown();
      }
    });

  ingestCmd
    .command('wikidata')
    .description('Ingest history from Wikidata SPARQL query or preset')
    .option('-g, --graph-id <id>', 'Target graph ID (creates new if omitted)')
    .option('--graph-name <name>', 'Name for new graph if creating')
    .option('--preset <preset>', 'Preset query (e.g. historical-events)', 'historical-events')
    .option('--sparql <query>', 'Custom SPARQL query to execute')
    .option('--limit <limit>', 'Maximum entities to fetch')
    .option('--group-arcs', 'Automatically cluster extracted events into narrative arcs')
    .option('--infer-causes', 'Automatically infer cause-and-effect links')
    .option('--min-confidence <threshold>', 'Minimum confidence threshold (0 to 1)')
    .option('--dry-run', 'Preview extraction without saving to graph')
    .action(async (cmdOpts?: Record<string, unknown>) => {
      const opts = program.opts<GlobalCLIOptions>();
      const ctx = new ExecutionContext(opts);
      const start = Date.now();
      try {
        const engine = await ctx.getEngine();
        const result = await engine.ingestWikidata(cmdOpts?.graphId as string | undefined, {
          preset: cmdOpts?.preset as string | undefined,
          sparql: cmdOpts?.sparql as string | undefined,
          limit: cmdOpts?.limit ? parseInt(String(cmdOpts.limit), 10) : undefined,
          groupArcs: Boolean(cmdOpts?.groupArcs),
          inferCauses: Boolean(cmdOpts?.inferCauses),
          minConfidence: cmdOpts?.minConfidence ? parseFloat(String(cmdOpts.minConfidence)) : undefined,
          dryRun: Boolean(cmdOpts?.dryRun),
          graphName: cmdOpts?.graphName as string | undefined,
        });

        const output = formatOutput(result, getFormat(opts), engine.mode, {
          durationMs: Date.now() - start,
          graphId: result.graphId,
        });
        process.stdout.write(output + '\n');
      } finally {
        await ctx.shutdown();
      }
    });

  // --- Generation Commands (Phase 3) ---
  const generate = program.command('generate').description('Whole-cloth and counterfactual alternate history generator');

  generate
    .command('timeline')
    .description('Generate an alternate history timeline whole-cloth from a premise and divergence point')
    .requiredOption('-p, --premise <text>', 'Counterfactual premise or what-if hypothesis')
    .requiredOption('-d, --divergence-point <text>', 'Point of divergence anchor event')
    .option('--start-date <iso>', 'Earliest timeline date boundary (ISO-8601)')
    .option('--end-date <iso>', 'Latest timeline date boundary (ISO-8601)')
    .option('-n, --event-count <count>', 'Number of pivotal events to synthesize (default: 8)', '8')
    .option('--depth <levels>', 'Arc hierarchy depth (default: 1)', '1')
    .option('--style <style>', 'Narrative style: academic, narrative, or concise', 'academic')
    .option('--provider <provider>', 'LLM provider: openai or anthropic')
    .option('--model <model>', 'LLM model name')
    .option('--temperature <val>', 'LLM sampling temperature')
    .option('--graph-name <name>', 'Name for generated graph')
    .option('--dry-run', 'Preview generated timeline without persisting')
    .action(async (cmdOpts?: Record<string, unknown>) => {
      const opts = program.opts<GlobalCLIOptions>();
      const ctx = new ExecutionContext(opts);
      const start = Date.now();
      try {
        const engine = await ctx.getEngine();
        const validStyles = ['academic', 'narrative', 'concise'] as const;
        const style = typeof cmdOpts?.style === 'string' && (validStyles as readonly string[]).includes(cmdOpts.style)
          ? (cmdOpts.style as 'academic' | 'narrative' | 'concise')
          : 'academic';
        const validProviders = ['openai', 'anthropic'] as const;
        const provider = typeof cmdOpts?.provider === 'string' && (validProviders as readonly string[]).includes(cmdOpts.provider)
          ? (cmdOpts.provider as 'openai' | 'anthropic')
          : undefined;

        const result = await engine.generateTimeline({
          premise: String(cmdOpts?.premise || ''),
          divergencePoint: String(cmdOpts?.divergencePoint || ''),
          startDate: cmdOpts?.startDate as string | undefined,
          endDate: cmdOpts?.endDate as string | undefined,
          eventCount: cmdOpts?.eventCount ? parseInt(String(cmdOpts.eventCount), 10) : 8,
          depth: cmdOpts?.depth ? parseInt(String(cmdOpts.depth), 10) : 1,
          style,
          provider,
          model: cmdOpts?.model as string | undefined,
          temperature: cmdOpts?.temperature ? parseFloat(String(cmdOpts.temperature)) : undefined,
          graphName: cmdOpts?.graphName as string | undefined,
          dryRun: Boolean(cmdOpts?.dryRun),
        });

        const output = formatOutput(result, getFormat(opts), engine.mode, {
          durationMs: Date.now() - start,
          graphId: result.graphId,
        });
        process.stdout.write(output + '\n');
      } finally {
        await ctx.shutdown();
      }
    });

  generate
    .command('branch')
    .description('Fork an existing history graph at a pivot event with a counterfactual prompt')
    .requiredOption('-g, --source-graph-id <id>', 'Source graph ID to branch from')
    .requiredOption('-e, --diverge-at-event <id>', 'Event ID where history diverges')
    .requiredOption('-p, --counterfactual-prompt <prompt>', 'What-if divergence prompt')
    .requiredOption('-b, --branch-name <name>', 'Name for the new divergent branch')
    .option('-n, --event-count <count>', 'Number of divergent events to synthesize', '6')
    .option('--provider <provider>', 'LLM provider: openai or anthropic')
    .option('--model <model>', 'LLM model name')
    .option('--dry-run', 'Preview divergent branch without persisting')
    .action(async (cmdOpts?: Record<string, unknown>) => {
      const opts = program.opts<GlobalCLIOptions>();
      const ctx = new ExecutionContext(opts);
      const start = Date.now();
      try {
        const engine = await ctx.getEngine();
        const validProviders = ['openai', 'anthropic'] as const;
        const provider = typeof cmdOpts?.provider === 'string' && (validProviders as readonly string[]).includes(cmdOpts.provider)
          ? (cmdOpts.provider as 'openai' | 'anthropic')
          : undefined;

        const result = await engine.generateBranch({
          sourceGraphId: String(cmdOpts?.sourceGraphId || ''),
          divergeAtEventId: String(cmdOpts?.divergeAtEvent || ''),
          counterfactualPrompt: String(cmdOpts?.counterfactualPrompt || ''),
          branchName: String(cmdOpts?.branchName || ''),
          eventCount: cmdOpts?.eventCount ? parseInt(String(cmdOpts.eventCount), 10) : 6,
          provider,
          model: cmdOpts?.model as string | undefined,
          dryRun: Boolean(cmdOpts?.dryRun),
        });

        const output = formatOutput(result, getFormat(opts), engine.mode, {
          durationMs: Date.now() - start,
          graphId: result.graphId,
        });
        process.stdout.write(output + '\n');
      } finally {
        await ctx.shutdown();
      }
    });

  generate
    .command('expand')
    .description('Interpolate granular sub-events within an arc or time window')
    .requiredOption('-g, --graph-id <id>', 'Target graph ID')
    .option('-a, --arc <id>', 'Arc ID to expand')
    .option('-w, --time-window <window>', 'Time window ISO range (start/end)')
    .option('-n, --event-count <count>', 'Number of sub-events to generate', '3')
    .option('--provider <provider>', 'LLM provider')
    .option('--model <model>', 'LLM model name')
    .option('--dry-run', 'Preview expansion without persisting')
    .action(async (cmdOpts?: Record<string, unknown>) => {
      const opts = program.opts<GlobalCLIOptions>();
      const ctx = new ExecutionContext(opts);
      const start = Date.now();
      try {
        const engine = await ctx.getEngine();
        const validProviders = ['openai', 'anthropic'] as const;
        const provider = typeof cmdOpts?.provider === 'string' && (validProviders as readonly string[]).includes(cmdOpts.provider)
          ? (cmdOpts.provider as 'openai' | 'anthropic')
          : undefined;

        const result = await engine.generateExpand({
          graphId: String(cmdOpts?.graphId || ''),
          arcId: cmdOpts?.arc as string | undefined,
          timeWindow: cmdOpts?.timeWindow as string | undefined,
          eventCount: cmdOpts?.eventCount ? parseInt(String(cmdOpts.eventCount), 10) : 3,
          provider,
          model: cmdOpts?.model as string | undefined,
          dryRun: Boolean(cmdOpts?.dryRun),
        });

        const output = formatOutput(result, getFormat(opts), engine.mode, {
          durationMs: Date.now() - start,
          graphId: result.graphId,
        });
        process.stdout.write(output + '\n');
      } finally {
        await ctx.shutdown();
      }
    });

  generate
    .command('simulate')
    .description('Advance timeline sequentially into the future based on causal pressures')
    .requiredOption('-g, --graph-id <id>', 'Target graph ID')
    .option('-s, --steps <steps>', 'Simulation steps (default: 3)', '3')
    .option('-m, --months <months>', 'Months to advance per step (default: 12)', '12')
    .option('--provider <provider>', 'LLM provider')
    .option('--model <model>', 'LLM model name')
    .option('--dry-run', 'Preview simulation without persisting')
    .action(async (cmdOpts?: Record<string, unknown>) => {
      const opts = program.opts<GlobalCLIOptions>();
      const ctx = new ExecutionContext(opts);
      const start = Date.now();
      try {
        const engine = await ctx.getEngine();
        const validProviders = ['openai', 'anthropic'] as const;
        const provider = typeof cmdOpts?.provider === 'string' && (validProviders as readonly string[]).includes(cmdOpts.provider)
          ? (cmdOpts.provider as 'openai' | 'anthropic')
          : undefined;

        const result = await engine.generateSimulate({
          graphId: String(cmdOpts?.graphId || ''),
          steps: cmdOpts?.steps ? parseInt(String(cmdOpts.steps), 10) : 3,
          timeAdvanceMonths: cmdOpts?.months ? parseInt(String(cmdOpts.months), 10) : 12,
          provider,
          model: cmdOpts?.model as string | undefined,
          dryRun: Boolean(cmdOpts?.dryRun),
        });

        const output = formatOutput(result, getFormat(opts), engine.mode, {
          durationMs: Date.now() - start,
          graphId: result.graphId,
        });
        process.stdout.write(output + '\n');
      } finally {
        await ctx.shutdown();
      }
    });

  // --- Validation Command ---
  program
    .command('validate <graphId>')
    .description('Validate graph temporal, containment, and causal integrity')
    .option('--strict', 'Treat warnings as validation failures')
    .option('--auto-repair', 'Automatically repair detected issues')
    .action(async (graphId: string, cmdOpts?: Record<string, unknown>) => {
      const opts = program.opts<GlobalCLIOptions>();
      const ctx = new ExecutionContext(opts);
      const start = Date.now();
      try {
        const engine = await ctx.getEngine();
        const report = await engine.validateGraph(
          graphId,
          Boolean(cmdOpts?.strict),
          Boolean(cmdOpts?.autoRepair)
        );

        const output = formatOutput(report, getFormat(opts), engine.mode, {
          durationMs: Date.now() - start,
          graphId,
        });
        process.stdout.write(output + '\n');

        if (!report.valid) {
          process.exitCode = ExitCode.VALIDATION_FAILED;
        }
      } finally {
        await ctx.shutdown();
      }
    });

  // --- Export Command ---
  program
    .command('export <graphId>')
    .description('Export graph data to JSON, Markdown, or Graphviz DOT')
    .option('-f, --format <format>', 'Export format: json, markdown, or dot', 'json')
    .option('-o, --output <path>', 'Output file path')
    .action(async (graphId: string, cmdOpts?: Record<string, unknown>) => {
      const opts = program.opts<GlobalCLIOptions>();
      const ctx = new ExecutionContext(opts);
      const start = Date.now();
      try {
        const engine = await ctx.getEngine();
        const validFormats = ['json', 'markdown', 'dot'] as const;
        const requestedFormat = typeof cmdOpts?.format === 'string' && (validFormats as readonly string[]).includes(cmdOpts.format)
          ? (cmdOpts.format as 'json' | 'markdown' | 'dot')
          : 'json';

        const result = await engine.exportGraph(
          graphId,
          requestedFormat,
          cmdOpts?.output as string | undefined
        );

        if (cmdOpts?.output) {
          const output = formatOutput(
            {
              graphId,
              format: result.format,
              outputPath: result.outputPath,
              bytesWritten: result.bytesWritten,
            },
            getFormat(opts),
            engine.mode,
            { durationMs: Date.now() - start, graphId }
          );
          process.stdout.write(output + '\n');
        } else if (getFormat(opts) === 'json') {
          const output = formatOutput(result, 'json', engine.mode, {
            durationMs: Date.now() - start,
            graphId,
          });
          process.stdout.write(output + '\n');
        } else {
          process.stdout.write((result.content || '') + '\n');
        }
      } finally {
        await ctx.shutdown();
      }
    });

  // --- Import Command ---
  program
    .command('import <source>')
    .description('Import graph data from JSON file or string')
    .option('-s, --strategy <strategy>', 'Conflict strategy: skip, overwrite, or rename', 'skip')
    .option('-g, --graph-id <id>', 'Target graph ID')
    .action(async (source: string, cmdOpts?: Record<string, unknown>) => {
      const opts = program.opts<GlobalCLIOptions>();
      const ctx = new ExecutionContext(opts);
      const start = Date.now();
      try {
        const engine = await ctx.getEngine();
        const validStrategies = ['skip', 'overwrite', 'rename'] as const;
        const strategy = typeof cmdOpts?.strategy === 'string' && (validStrategies as readonly string[]).includes(cmdOpts.strategy)
          ? (cmdOpts.strategy as 'skip' | 'overwrite' | 'rename')
          : 'skip';

        const result = await engine.importGraph(source, {
          strategy,
          graphId: cmdOpts?.graphId as string | undefined,
        });

        const output = formatOutput(result, getFormat(opts), engine.mode, {
          durationMs: Date.now() - start,
          graphId: result.graphId,
        });
        process.stdout.write(output + '\n');
      } finally {
        await ctx.shutdown();
      }
    });

  return program;
}

// Redirect all internal console.log and console.info to stderr so stdout is pure JSON / data
console.log = (...args: unknown[]) => {
  process.stderr.write(args.map((a) => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ') + '\n');
};
console.info = (...args: unknown[]) => {
  process.stderr.write(args.map((a) => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ') + '\n');
};

export async function runCLI(args: string[] = process.argv): Promise<number> {
  const program = createProgram();

  try {
    process.exitCode = undefined;
    await program.parseAsync(args);
    return process.exitCode || ExitCode.SUCCESS;
  } catch (err: unknown) {
    const isJson = args.includes('-j') || args.includes('--json') || (!args.includes('--plain') && !args.includes('--markdown'));
    const cliErr = err instanceof CLIError ? err : new CLIError((err as Error).message, ExitCode.GENERAL_ERROR);

    if (isJson) {
      const formatted = formatErrorJson(cliErr.message, cliErr.code, 'direct', cliErr.details);
      process.stdout.write(formatted + '\n');
    } else {
      logger.error(`${cliErr.code}: ${cliErr.message}`);
    }

    return cliErr.exitCode;
  }
}

// When executed directly as entrypoint
if (require.main === module || process.argv[1]?.endsWith('index.ts') || process.argv[1]?.endsWith('althistory')) {
  runCLI().then((code) => {
    process.exit(code);
  });
}
