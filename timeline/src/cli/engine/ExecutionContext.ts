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
 * localhost: `start-local.sh` writes it to `timeline/.env.local` (the CLI runs
 * from `timeline/`), and the graph routes always ask for a key. Never sent to
 * an address the caller named with --url.
 */
function localAppKey(): string | undefined {
  if (process.env.ADMIN_API_KEY) return process.env.ADMIN_API_KEY;
  try {
    const parsed = parseEnv(fs.readFileSync(path.resolve(process.cwd(), '.env.local')));
    return parsed.ADMIN_API_KEY || undefined;
  } catch {
    return undefined;
  }
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

    // --api-key, else ALTHISTORY_API_KEY: an MCP client sets the second in the
    // server's env, since it cannot easily pass flags per call.
    const apiKey = this.options.apiKey || process.env.ALTHISTORY_API_KEY || undefined;

    // Explicit URL provided
    if (this.options.url) {
      logger.debug(`Remote URL explicitly provided: ${this.options.url}`);
      this.engine = new RemoteEngine(this.options.url, apiKey);
      return this.engine;
    }

    // Default probe: check if daemon is running on localhost:3000
    const defaultUrl = 'http://localhost:3000';
    // Any answer means the app is there, including 503: /health reports
    // "degraded" until its services have warmed up. Falling back to the files
    // then would make this process a second writer beside the running app.
    let daemonAnswered = false;
    try {
      logger.debug(`Probing daemon at ${defaultUrl}...`);
      await axios.get(`${defaultUrl}/health`, { timeout: 400 });
      daemonAnswered = true;
    } catch (error) {
      daemonAnswered = axios.isAxiosError(error) && error.response !== undefined;
    }
    if (daemonAnswered) {
      logger.debug('Daemon detected. Using RemoteEngine');
      this.engine = new RemoteEngine(defaultUrl, apiKey ?? localAppKey());
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
