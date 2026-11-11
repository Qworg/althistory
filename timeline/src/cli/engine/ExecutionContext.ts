import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';
import { parse as parseEnv } from 'dotenv';
import { IEngine } from './IEngine';
import { DirectEngine } from './DirectEngine';
import { RemoteEngine } from './RemoteEngine';
import { GlobalCLIOptions } from '../types';
import { logger } from '../utils/logger';

/**
 * The admin key of this clone's own app, for when the CLI found it running on
 * this machine: `start-local.sh` writes it to `timeline/.env.local` (the CLI
 * runs from `timeline/`), and the graph routes always ask for a key. The
 * clone's own files come first, as the app reads them; an ADMIN_API_KEY in the
 * environment is a common name and may belong to something else, so it is the
 * last resort. Never sent to an address the caller named with --url.
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

  constructor(options: GlobalCLIOptions = {}) {
    this.options = options;
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

    // Explicit direct flag
    if (this.options.direct) {
      logger.debug('Direct mode explicitly requested');
      this.engine = new DirectEngine();
      return this.engine;
    }

    // Explicit URL provided: --api-key, else ALTHISTORY_API_KEY (an MCP client
    // sets that in the server's env, since it cannot pass flags per call).
    if (this.options.url) {
      logger.debug(`Remote URL explicitly provided: ${this.options.url}`);
      this.engine = new RemoteEngine(this.options.url, this.options.apiKey || process.env.ALTHISTORY_API_KEY || undefined);
      return this.engine;
    }

    // Default probe: is this clone's app running? It binds 127.0.0.1 in local
    // mode; "localhost" can resolve to ::1 first and reach something else.
    const defaultUrl = 'http://127.0.0.1:3000';
    // Any answer means the app is there, including 503: /health reports
    // "degraded" until its services have warmed up. Falling back to the files
    // then would make this process a second writer beside the running app.
    // It has to be althistory's own health report, though: port 3000 is the
    // default of many dev servers, and this one is about to be sent the
    // app's admin key.
    let daemonAnswered = false;
    try {
      logger.debug(`Probing daemon at ${defaultUrl}...`);
      const response = await axios.get(`${defaultUrl}/health`, { timeout: 400 });
      daemonAnswered = isAlthistoryHealth(response.data);
    } catch (error) {
      daemonAnswered = axios.isAxiosError(error) && isAlthistoryHealth(error.response?.data);
    }
    if (daemonAnswered) {
      logger.debug('Daemon detected. Using RemoteEngine');
      // The app found here is this clone's: its own key first, then the general ones.
      this.engine = new RemoteEngine(
        defaultUrl,
        this.options.apiKey ||
          localAppKey() ||
          process.env.ALTHISTORY_API_KEY ||
          process.env.ADMIN_API_KEY ||
          undefined
      );
      return this.engine;
    }
    logger.debug('Daemon not reachable. Falling back to DirectEngine');
    this.engine = new DirectEngine();
    return this.engine;
  }

  async shutdown(): Promise<void> {
    if (this.engine) {
      await this.engine.shutdown();
    }
  }
}
