import axios from 'axios';
import { IEngine } from './IEngine';
import { DirectEngine } from './DirectEngine';
import { RemoteEngine } from './RemoteEngine';
import { GlobalCLIOptions } from '../types';
import { logger } from '../utils/logger';

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

    // Explicit URL provided
    if (this.options.url) {
      logger.debug(`Remote URL explicitly provided: ${this.options.url}`);
      this.engine = new RemoteEngine(this.options.url, this.options.apiKey);
      return this.engine;
    }

    // Default probe: check if daemon is running on localhost:3000
    const defaultUrl = 'http://localhost:3000';
    try {
      logger.debug(`Probing daemon at ${defaultUrl}...`);
      await axios.get(`${defaultUrl}/health`, { timeout: 400 });
      logger.debug('Daemon detected. Using RemoteEngine');
      this.engine = new RemoteEngine(defaultUrl, this.options.apiKey);
      return this.engine;
    } catch {
      logger.debug('Daemon not reachable. Falling back to DirectEngine');
      this.engine = new DirectEngine();
      return this.engine;
    }
  }

  async shutdown(): Promise<void> {
    if (this.engine) {
      await this.engine.shutdown();
    }
  }
}
