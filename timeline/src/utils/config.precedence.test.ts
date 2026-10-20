/**
 * Environment precedence for the dotenv files.
 *
 * The ordering is: the process environment wins over `.env.local`, which wins
 * over `.env`. This file exists because getting it wrong was silent: a
 * developer's `timeline/.env.local` (LOCAL_EXECUTION_ENABLED=true) overrode the
 * container's `LOCAL_EXECUTION_ENABLED=false`, and the "cloud" integration
 * suites ran against the local JSON store while reporting Neo4j failures.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { loadDotEnvFiles } from './config';

let workDir: string;
let envPath: string;
let envLocalPath: string;
let originalLocalExecution: string | undefined;

beforeEach(() => {
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'config-precedence-'));
  envPath = path.join(workDir, '.env');
  envLocalPath = path.join(workDir, '.env.local');
  // Absent from the environment, so the files decide.
  originalLocalExecution = process.env.LOCAL_EXECUTION_ENABLED;
  delete process.env.LOCAL_EXECUTION_ENABLED;
});

afterEach(() => {
  fs.rmSync(workDir, { recursive: true, force: true });
  // The loader writes to `process.env` directly, so `vi.unstubAllEnvs` does
  // not undo it; the value has to be restored by hand.
  if (originalLocalExecution === undefined) {
    delete process.env.LOCAL_EXECUTION_ENABLED;
  } else {
    process.env.LOCAL_EXECUTION_ENABLED = originalLocalExecution;
  }
  vi.unstubAllEnvs();
});

describe('dotenv precedence', () => {
  it('lets the process environment win over .env.local', () => {
    fs.writeFileSync(envLocalPath, 'LOCAL_EXECUTION_ENABLED=true\n');
    vi.stubEnv('LOCAL_EXECUTION_ENABLED', 'false');

    loadDotEnvFiles(envPath, envLocalPath);

    expect(process.env.LOCAL_EXECUTION_ENABLED).toBe('false');
  });

  it('lets .env.local win over .env', () => {
    fs.writeFileSync(envPath, 'LOCAL_EXECUTION_ENABLED=false\n');
    fs.writeFileSync(envLocalPath, 'LOCAL_EXECUTION_ENABLED=true\n');
    loadDotEnvFiles(envPath, envLocalPath);

    expect(process.env.LOCAL_EXECUTION_ENABLED).toBe('true');
  });

  it('lets .env apply when there is no .env.local', () => {
    fs.writeFileSync(envPath, 'LOCAL_EXECUTION_ENABLED=true\n');

    loadDotEnvFiles(envPath, envLocalPath);

    expect(process.env.LOCAL_EXECUTION_ENABLED).toBe('true');
  });

  it('keeps a variable that only .env.local sets', () => {
    // Only the variables the environment already had are restored. A key that
    // exists solely in a file must survive the load, or .env and .env.local
    // would stop working entirely.
    fs.writeFileSync(envLocalPath, 'LOCAL_EXECUTION_ENABLED=true\n');

    loadDotEnvFiles(envPath, envLocalPath);

    expect(process.env.LOCAL_EXECUTION_ENABLED).toBe('true');
  });
});
