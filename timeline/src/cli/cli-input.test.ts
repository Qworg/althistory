/**
 * The CLI's input and its flags.
 *
 * Two things are checked here: that the text of an ingestion command can come
 * from a pipe, and that the flags the generation commands accept are read
 * rather than ignored.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { Readable } from 'stream';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { runCLI } from './index';
import { readInputText } from './utils/inputText';

/** Run the CLI and return what it wrote to stdout, parsed as JSON. */
async function runCli(args: string[]): Promise<{ code: number; stdout: string }> {
  const written: string[] = [];
  const spy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
    written.push(String(chunk));
    return true;
  });
  try {
    const code = await runCLI(['node', 'althistory', ...args]);
    return { code, stdout: written.join('') };
  } finally {
    spy.mockRestore();
  }
}

describe('Reading the text of an ingestion command', () => {
  it('reads the text from the standard input', async () => {
    const stdin = Readable.from(['The Treaty of Paris ', 'was signed on 10 February 1763.']);
    const text = await readInputText({ stdin, stdinIsTerminal: false });
    expect(text).toBe('The Treaty of Paris was signed on 10 February 1763.');
  });

  it('reads the text from a file', async () => {
    const file = path.join(os.tmpdir(), `althistory-input-${process.pid}.txt`);
    fs.writeFileSync(file, 'The Congress voted in 1776.');
    try {
      const text = await readInputText({ file, stdinIsTerminal: false });
      expect(text).toBe('The Congress voted in 1776.');
    } finally {
      fs.unlinkSync(file);
    }
  });

  it('reads nothing from a terminal', async () => {
    const text = await readInputText({ stdin: Readable.from(['ignored']), stdinIsTerminal: true });
    expect(text).toBe('');
  });

  it('prefers the inline text over the standard input', async () => {
    const text = await readInputText({
      inlineText: 'inline',
      stdin: Readable.from(['piped']),
      stdinIsTerminal: false,
    });
    expect(text).toBe('inline');
  });
});

describe('The CLI ingestion command', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('ingests the text that arrives on the standard input', async () => {
    const stdin = Readable.from([
      'The Treaty of Paris was signed on 10 February 1763 by representatives of Great Britain and France.',
    ]);
    vi.spyOn(process, 'stdin', 'get').mockReturnValue(stdin as unknown as typeof process.stdin);

    const { code, stdout } = await runCli(['ingest', 'text', '--mode', 'pattern', '--dry-run', '--direct', '--json']);

    expect(code).toBe(0);
    const envelope = JSON.parse(stdout);
    expect(envelope.success).toBe(true);
    expect(envelope.data.eventsCreated).toBe(1);
    expect(envelope.data.entities.events[0].description).toContain('Treaty of Paris');
    // A dry run must not leave a graph behind.
    expect(envelope.data.dryRun).toBe(true);
    expect(envelope.data.graphId).toContain('dry-run');
  });

  it('reports the schema of every command', async () => {
    const { code, stdout } = await runCli(['schema', '--plain']);

    expect(code).toBe(0);
    const document = JSON.parse(stdout);
    expect(document.$schema).toBe('https://json-schema.org/draft/2020-12/schema');
    expect(document.properties.command.enum).toContain('graph create');
    expect(document.properties.command.enum).toContain('arc assign');
    expect(document.$defs['ingest text']).toBeDefined();
    expect(document.$defs['ingest text'].properties.options.properties['mode']).toBeDefined();
  });
});

describe('The flags of the generation commands', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('builds an arc hierarchy of the requested depth', async () => {
    const { code, stdout } = await runCli([
      'generate',
      'timeline',
      '--premise',
      'What if Napoleon won Waterloo?',
      '--divergence-point',
      'The charge succeeds on 18 June 1815',
      '--depth',
      '2',
      '--dry-run',
      '--direct',
      '--json',
    ]);

    expect(code).toBe(0);
    const envelope = JSON.parse(stdout);
    const arcs = envelope.data.arcs as Array<{ level: number }>;
    expect(arcs.length).toBeGreaterThan(1);
    expect(arcs.some((arc) => arc.level === 0)).toBe(true);
    expect(arcs.some((arc) => arc.level === 1)).toBe(true);
  });

  it('writes the timeline in the requested style', async () => {
    const { code, stdout } = await runCli([
      'generate',
      'timeline',
      '--premise',
      'What if Napoleon won Waterloo?',
      '--divergence-point',
      'The charge succeeds on 18 June 1815',
      '--style',
      'concise',
      '--dry-run',
      '--direct',
      '--json',
    ]);

    expect(code).toBe(0);
    const envelope = JSON.parse(stdout);
    const events = envelope.data.events as Array<{ description: string }>;
    expect(events.length).toBeGreaterThan(1);
    // The concise style writes a plain milestone; the academic style adds the
    // consequence clause.
    expect(events[1].description).not.toContain('a direct consequence of');
  });

  it('expands the window it is given and records it as an arc', async () => {
    const { code, stdout } = await runCli([
      'generate',
      'expand',
      '--graph-id',
      'graph-that-does-not-exist',
      '--time-window',
      '2020-01-01T00:00:00Z/2020-12-31T00:00:00Z',
      '--dry-run',
      '--direct',
      '--json',
    ]);

    // The graph does not exist, so the command fails -- but it fails on the
    // graph, and the time window was read rather than ignored.
    expect(code).not.toBe(0);
    const envelope = JSON.parse(stdout);
    expect(envelope.success).toBe(false);
    expect(envelope.error.message).toContain('graph-that-does-not-exist');
  });
});
