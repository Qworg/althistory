/**
 * @vitest-environment node
 */

import { describe, it, expect, afterEach } from 'vitest';
import express from 'express';
import type { Server } from 'http';
import type { AddressInfo } from 'net';
import { ExecutionContext, ALLOW_DIRECT_ENV } from './engine/ExecutionContext';
import { DirectEngine } from './engine/DirectEngine';
import { RemoteEngine } from './engine/RemoteEngine';
import { ExitCode, ValidationErrorCLI, NotFoundErrorCLI } from './utils/exitCodes';

describe('CLI ExecutionContext and Engine Selection', () => {
  it('instantiates DirectEngine when --direct flag is provided', async () => {
    const ctx = new ExecutionContext({ direct: true });
    const engine = await ctx.getEngine();
    expect(engine.mode).toBe('direct');
    expect(engine).toBeInstanceOf(DirectEngine);
  });

  it('instantiates RemoteEngine when explicit --url is provided', async () => {
    const ctx = new ExecutionContext({ url: 'http://custom-host:8080', apiKey: 'test-key' });
    const engine = await ctx.getEngine();
    expect(engine.mode).toBe('remote');
    expect(engine).toBeInstanceOf(RemoteEngine);
  });

  it('DirectEngine can check health and report stats', async () => {
    const engine = new DirectEngine();
    const health = await engine.getHealth();
    expect(health.status).toBe('healthy');
    expect(health.executionMode).toBe('direct');
    expect(typeof health.uptimeSeconds).toBe('number');
  });

  it('validates exit codes mapping correctly', () => {
    const valErr = new ValidationErrorCLI('Time invalid');
    expect(valErr.exitCode).toBe(ExitCode.VALIDATION_FAILED);

    const notFound = new NotFoundErrorCLI('Graph missing');
    expect(notFound.exitCode).toBe(ExitCode.NOT_FOUND);
  });
});

describe('--direct beside a running app', () => {
  let app: Server | undefined;

  afterEach(async () => {
    delete process.env[ALLOW_DIRECT_ENV];
    if (app) await new Promise<void>((resolve) => app?.close(() => resolve()));
    app = undefined;
  });

  /** An app that answers /health as althistory does. */
  async function runningApp(): Promise<string> {
    const stand = express();
    stand.get('/health', (_req, res) => {
      res.status(503).json({ status: 'degraded', services: { graphService: true } });
    });
    app = stand.listen(0, '127.0.0.1');
    await new Promise<void>((resolve) => app?.once('listening', () => resolve()));
    return `http://127.0.0.1:${(app.address() as AddressInfo).port}`;
  }

  it('refuses to be a second writer, and says to run without --direct', async () => {
    const address = await runningApp();
    const ctx = new ExecutionContext({ direct: true }, { appAddresses: [address] });
    await expect(ctx.getEngine()).rejects.toMatchObject({
      code: 'APP_RUNNING',
      message: expect.stringContaining(`running at ${address}`),
    });
    await expect(ctx.getEngine()).rejects.toThrow(/without --direct/);
  });

  it('runs in process when no app answers', async () => {
    const ctx = new ExecutionContext({ direct: true }, { appAddresses: ['http://127.0.0.1:1'] });
    expect((await ctx.getEngine()).mode).toBe('direct');
  });

  it('is not fooled by another program on the port', async () => {
    const stand = express();
    stand.get('/health', (_req, res) => res.json({ status: 'ok' }));
    app = stand.listen(0, '127.0.0.1');
    await new Promise<void>((resolve) => app?.once('listening', () => resolve()));
    const address = `http://127.0.0.1:${(app.address() as AddressInfo).port}`;
    const ctx = new ExecutionContext({ direct: true }, { appAddresses: [address] });
    expect((await ctx.getEngine()).mode).toBe('direct');
  });

  it('can be allowed, for an app that keeps its data elsewhere', async () => {
    const address = await runningApp();
    process.env[ALLOW_DIRECT_ENV] = '1';
    const ctx = new ExecutionContext({ direct: true }, { appAddresses: [address] });
    expect((await ctx.getEngine()).mode).toBe('direct');
  });

  it('works through the app by default when one answers', async () => {
    const address = await runningApp();
    const ctx = new ExecutionContext({}, { appAddresses: [address] });
    expect((await ctx.getEngine()).mode).toBe('remote');
  });
});
