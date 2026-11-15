import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';
import { parse as parseEnv } from 'dotenv';
import { IEngine } from './IEngine';
import { DirectEngine } from './DirectEngine';
import { RemoteEngine } from './RemoteEngine';
import { GlobalCLIOptions } from '../types';
import { logger } from '../utils/logger';
import { CLIError, ExitCode } from '../utils/exitCodes';

/** Where this clone's app listens in local mode: the IPv4 loopback, then the IPv6 one. */
export const DEFAULT_APP_ADDRESSES = ['http://127.0.0.1:3000', 'http://[::1]:3000'];

/**
 * Set to `1` to run `--direct` although an app answers on the default
 * address: for an app that keeps its data somewhere else.
 */
export const ALLOW_DIRECT_ENV = 'ALTHISTORY_ALLOW_DIRECT';

export interface ExecutionContextOptions {
  /** What kind of client this is, for the app's live change feed. `mcp` for the MCP server. */
  client?: 'cli' | 'mcp';
  /** The addresses to look for the app at; a test seam. */
  appAddresses?: string[];
  /** How long a "no app answers" probe is trusted by `getFollowingEngine`, in ms. Default 3000. */
  reprobeMs?: number;
  /** How often a direct engine saves the files while a call is still running, in ms (0 turns it off). Default 1000. */
  flushMs?: number;
}

/** Engine calls that never write, so the files need no save after them. */
const READ_ONLY_CALL = /^(get|list|find|diff|export)/;

/**
 * The admin key of this clone's own app, for when the CLI found it running on
 * this machine: `start-local.sh` writes it to `timeline/.env.local` (the CLI
 * runs from `timeline/`), and the graph routes always ask for a key. Read as
 * the app reads it, after the environment: .env.local, then .env. Never sent to
 * an address the caller named with --url.
 */
function localAppKey(): string | undefined {
  for (const file of ['.env.local', '.env']) {
    try {
      const parsed = parseEnv(fs.readFileSync(path.resolve(process.cwd(), file)));
      if (parsed.ADMIN_API_KEY) return parsed.ADMIN_API_KEY;
    } catch {
      // No such file: try the next.
    }
  }
  return undefined;
}

/** Whether a /health answer is althistory's: a status, and a services map naming its graph service. */
export function isAlthistoryHealth(body: unknown): boolean {
  if (typeof body !== 'object' || body === null) return false;
  const record = body as Record<string, unknown>;
  const services = record.services;
  return (
    typeof record.status === 'string' &&
    typeof services === 'object' &&
    services !== null &&
    'graphService' in services
  );
}

export class ExecutionContext {
  private engine?: IEngine;
  private options: GlobalCLIOptions;
  private readonly client: 'cli' | 'mcp';
  private readonly appAddresses: string[];
  private readonly reprobeMs: number;
  private readonly flushMs: number;
  private lastProbeAt = 0;
  private following?: Promise<IEngine>;

  constructor(options: GlobalCLIOptions = {}, extra: ExecutionContextOptions = {}) {
    this.options = options;
    this.client = extra.client ?? 'cli';
    this.appAddresses = extra.appAddresses ?? DEFAULT_APP_ADDRESSES;
    this.reprobeMs = extra.reprobeMs ?? 3000;
    this.flushMs = extra.flushMs ?? 1000;
  }

  /**
   * The address of an althistory app answering on this machine, if there is one.
   *
   * Any answer means the app is there, including 503: /health reports
   * "degraded" until its services have warmed up. It has to be althistory's own
   * health report, though: port 3000 is the default of many dev servers, and
   * the caller may be about to send it a key.
   */
  private async findApp(): Promise<string | undefined> {
    for (const candidate of this.appAddresses) {
      let answered = false;
      try {
        logger.debug(`Probing daemon at ${candidate}...`);
        const response = await axios.get(`${candidate}/health`, { timeout: 400 });
        answered = isAlthistoryHealth(response.data);
      } catch (error) {
        answered = axios.isAxiosError(error) && isAlthistoryHealth(error.response?.data);
      }
      if (answered) return candidate;
    }
    return undefined;
  }

  async getEngine(): Promise<IEngine> {
    if (this.engine) {
      return this.engine;
    }

    if (this.options.quiet) {
      logger.setQuiet(true);
    }
    if (this.options.verbose) {
      logger.setVerbose(true);
    }

    // Explicit direct flag. In process, this is a second writer beside the app
    // (each keeps its own copy of a graph in memory and writes the same files,
    // with no lock between them, so each would overwrite the other's changes
    // without an error). The app serves every command, generation included, so
    // `--direct` is for when none is running.
    if (this.options.direct) {
      if (process.env[ALLOW_DIRECT_ENV] !== '1') {
        const app = await this.findApp();
        if (app) {
          throw new CLIError(
            `An althistory app is running at ${app}, so --direct would make this process a second writer: ` +
              'the app and this process would each overwrite the other\'s changes without an error. ' +
              'Run the command without --direct and it works through the app, generation included. ' +
              `If the app keeps its data somewhere else, set ${ALLOW_DIRECT_ENV}=1.`,
            ExitCode.GENERAL_ERROR,
            'APP_RUNNING'
          );
        }
      }
      logger.debug('Direct mode explicitly requested');
      this.engine = new DirectEngine();
      return this.engine;
    }

    // Explicit URL provided: --api-key, else ALTHISTORY_API_KEY (an MCP client
    // sets that in the server's env, since it cannot pass flags per call).
    if (this.options.url) {
      logger.debug(`Remote URL explicitly provided: ${this.options.url}`);
      this.engine = new RemoteEngine(this.options.url, this.options.apiKey || process.env.ALTHISTORY_API_KEY || undefined, {
        client: this.client,
      });
      return this.engine;
    }

    // Default probe: is this clone's app running? It binds 127.0.0.1 in local
    // mode; an app bound to the IPv6 loopback only is tried next. Falling back
    // to the files while it runs would make this process a second writer.
    const candidate = await this.findApp();
    if (candidate) {
      logger.debug(`Daemon detected at ${candidate}. Using RemoteEngine`);
      // A key the caller chose comes first, so a scoped key given to an agent
      // is never swapped for the admin key. Then the app's own, found where
      // the app looks: the environment, then this clone's .env.local and .env.
      this.engine = new RemoteEngine(
        candidate,
        this.options.apiKey ||
          process.env.ALTHISTORY_API_KEY ||
          process.env.ADMIN_API_KEY ||
          localAppKey() ||
          undefined,
        { client: this.client }
      );
      return this.engine;
    }
    logger.debug('Daemon not reachable. Falling back to DirectEngine');
    this.engine = new DirectEngine();
    return this.engine;
  }

  /**
   * An engine that decides again at each call, for a process that outlives the
   * app's start order: an MCP client usually starts its server when the client
   * opens, often before the app. `getEngine` picks once; an engine picked as
   * direct would then stay a second writer beside an app that started later,
   * each overwriting the other's changes without an error and nothing on the
   * live feed. This one, while it works on the local files, looks for the app
   * again before a call (an answer or its absence is trusted for
   * `reprobeMs`), and when one answers it hands the files over: it switches to
   * the app, or, for `--direct`, refuses as `getEngine` does. An engine for an
   * explicit `--url` is fixed.
   *
   * Two things keep the handover from losing writes. While it works on the
   * files, the engine saves them after each call that may have written, and
   * every `flushMs` while a call is still running, so the app reads what the
   * agent wrote whenever it starts and loads the graph. And the handover waits
   * for the direct calls still running (a generation can wait minutes on a
   * model) before it shuts the files' container down, while new calls wait for
   * the handover instead of starting on the container being closed.
   */
  async getFollowingEngine(): Promise<IEngine> {
    const first = await this.getEngine();
    const current = (): IEngine => this.engine ?? first;
    let running = 0;
    let drained: (() => void) | undefined;
    let flushTimer: NodeJS.Timeout | undefined;

    const flushQuietly = async (engine: IEngine): Promise<void> => {
      try {
        await engine.flush?.();
      } catch (error) {
        logger.debug(`Flush of the live files failed: ${String(error)}`);
      }
    };
    const whenDrained = (): Promise<void> =>
      running === 0 ? Promise.resolve() : new Promise<void>((resolve) => (drained = resolve));

    const resolve = async (): Promise<IEngine> => {
      // A handover in progress holds every new call until it is done.
      if (this.following) return this.following;
      let engine = current();
      if (engine.mode !== 'direct' || this.options.url) return engine;
      if (Date.now() - this.lastProbeAt < this.reprobeMs) return engine;
      this.following = (async () => {
        try {
          const app = await this.findApp();
          this.lastProbeAt = Date.now();
          if (!app) return engine;
          if (this.options.direct) {
            if (process.env[ALLOW_DIRECT_ENV] === '1') return engine;
            throw new CLIError(
              `An althistory app is now running at ${app}, so this server, started with --direct, would be a second writer: ` +
                'the app and this process would each overwrite the other\'s changes without an error. ' +
                `Restart the server without --direct and it works through the app. If the app keeps its data somewhere else, set ${ALLOW_DIRECT_ENV}=1.`,
              ExitCode.GENERAL_ERROR,
              'APP_RUNNING'
            );
          }
          logger.debug(`Daemon appeared at ${app}. Handing over from DirectEngine to RemoteEngine`);
          const previous = engine;
          // Calls already running on the files finish (and save them) before
          // the container under them is closed.
          await whenDrained();
          this.engine = undefined;
          this.engine = await this.getEngine();
          await flushQuietly(previous);
          await previous.shutdown().catch(() => undefined);
          engine = this.engine;
          return engine;
        } finally {
          this.following = undefined;
        }
      })();
      return this.following;
    };

    /** Run one call on the files, counted so a handover can wait for it. */
    const runDirect = async (
      engine: IEngine,
      property: string | symbol,
      args: unknown[]
    ): Promise<unknown> => {
      running += 1;
      if (!flushTimer && this.flushMs > 0) {
        flushTimer = setInterval(() => void flushQuietly(engine), this.flushMs);
        flushTimer.unref?.();
      }
      try {
        return await (engine as unknown as Record<string | symbol, (...a: unknown[]) => unknown>)[property](...args);
      } finally {
        if (!READ_ONLY_CALL.test(String(property))) await flushQuietly(engine);
        running -= 1;
        if (running === 0) {
          if (flushTimer) clearInterval(flushTimer);
          flushTimer = undefined;
          const done = drained;
          drained = undefined;
          done?.();
        }
      }
    };

    return new Proxy(first, {
      get: (_target, property) => {
        if (property === 'mode') return current().mode;
        if (property === 'shutdown') return () => this.shutdown();
        const value = Reflect.get(current(), property) as unknown;
        if (typeof value !== 'function') return value;
        return async (...args: unknown[]) => {
          const engine = await resolve();
          if (engine.mode !== 'direct') {
            return (engine as unknown as Record<string | symbol, (...a: unknown[]) => unknown>)[property](...args);
          }
          return runDirect(engine, property, args);
        };
      },
    });
  }

  async shutdown(): Promise<void> {
    if (this.engine) {
      await this.engine.shutdown();
    }
  }
}
