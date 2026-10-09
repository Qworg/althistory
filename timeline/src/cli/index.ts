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
