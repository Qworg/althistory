import { describe, it, expect } from 'vitest';
import { ExecutionContext } from './engine/ExecutionContext';
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
