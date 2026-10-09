/**
 * Agent-First Stderr Logger.
 *
 * All logs, progress indicators, and advisory messages are written exclusively
 * to stderr, ensuring that stdout remains pure machine-readable data for Unix
 * pipes and JSON decoders.
 */

export interface ILogger {
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
  debug(message: string, ...args: unknown[]): void;
}

export class StderrLogger implements ILogger {
  private quiet: boolean;
  private verbose: boolean;

  constructor(quiet: boolean = false, verbose: boolean = false) {
    this.quiet = quiet;
    this.verbose = verbose;
  }

  setQuiet(quiet: boolean): void {
    this.quiet = quiet;
  }

  setVerbose(verbose: boolean): void {
    this.verbose = verbose;
  }

  info(message: string, ...args: unknown[]): void {
    if (this.quiet) return;
    if (args.length > 0) {
      process.stderr.write(`[INFO] ${message} ${JSON.stringify(args)}\n`);
    } else {
      process.stderr.write(`[INFO] ${message}\n`);
    }
  }

  warn(message: string, ...args: unknown[]): void {
    if (this.quiet) return;
    if (args.length > 0) {
      process.stderr.write(`[WARN] ${message} ${JSON.stringify(args)}\n`);
    } else {
      process.stderr.write(`[WARN] ${message}\n`);
    }
  }

  error(message: string, ...args: unknown[]): void {
    if (args.length > 0) {
      process.stderr.write(`[ERROR] ${message} ${JSON.stringify(args)}\n`);
    } else {
      process.stderr.write(`[ERROR] ${message}\n`);
    }
  }

  debug(message: string, ...args: unknown[]): void {
    if (this.quiet || !this.verbose) return;
    if (args.length > 0) {
      process.stderr.write(`[DEBUG] ${message} ${JSON.stringify(args)}\n`);
    } else {
      process.stderr.write(`[DEBUG] ${message}\n`);
    }
  }
}

export const logger = new StderrLogger();
