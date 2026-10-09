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
    await program.parseAsync(args);
    return ExitCode.SUCCESS;
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
