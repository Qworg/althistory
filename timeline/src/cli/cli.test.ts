import { describe, it, expect, vi } from 'vitest';
import { runCLI } from './index';
import { ExitCode } from './utils/exitCodes';

describe('CLI End-to-End Programmatic Runner', () => {
  it('runs status command in direct mode and returns SUCCESS', async () => {
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const code = await runCLI(['node', 'althistory', 'status', '--direct', '--json']);
    expect(code).toBe(ExitCode.SUCCESS);
    expect(stdoutSpy).toHaveBeenCalled();
    const calls = stdoutSpy.mock.calls.map((c) => c[0].toString()).join('');
    expect(calls).toContain('"success": true');
    expect(calls).toContain('"status": "healthy"');
    stdoutSpy.mockRestore();
  });

  it('runs graph list in direct mode and returns SUCCESS', async () => {
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const code = await runCLI(['node', 'althistory', 'graph', 'list', '--direct', '--json']);
    expect(code).toBe(ExitCode.SUCCESS);
    const calls = stdoutSpy.mock.calls.map((c) => c[0].toString()).join('');
    expect(calls).toContain('"success": true');
    stdoutSpy.mockRestore();
  });
});
