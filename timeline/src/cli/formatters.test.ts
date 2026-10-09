import { describe, it, expect } from 'vitest';
import { formatSuccessJson, formatErrorJson, formatNdjson, formatPlain, formatOutput } from './formatters';

describe('CLI Formatters', () => {
  it('formats success envelope with metadata', () => {
    const data = { id: 'g-1', name: 'Roman Empire' };
    const raw = formatSuccessJson(data, 'direct', { durationMs: 42, graphId: 'g-1' });
    const parsed = JSON.parse(raw);

    expect(parsed.success).toBe(true);
    expect(parsed.data).toEqual(data);
    expect(parsed.meta.mode).toBe('direct');
    expect(parsed.meta.durationMs).toBe(42);
    expect(parsed.meta.graphId).toBe('g-1');
  });

  it('formats error envelope with code and details', () => {
    const raw = formatErrorJson('Event not found', 'NOT_FOUND', 'remote', { eventId: 'evt-99' });
    const parsed = JSON.parse(raw);

    expect(parsed.success).toBe(false);
    expect(parsed.error.code).toBe('NOT_FOUND');
    expect(parsed.error.message).toBe('Event not found');
    expect(parsed.error.details).toEqual({ eventId: 'evt-99' });
    expect(parsed.meta.mode).toBe('remote');
  });

  it('formats arrays as newline delimited JSON (NDJSON)', () => {
    const items = [
      { id: '1', title: 'First' },
      { id: '2', title: 'Second' },
    ];
    const ndjson = formatNdjson(items);
    const lines = ndjson.trim().split('\n');

    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0])).toEqual(items[0]);
    expect(JSON.parse(lines[1])).toEqual(items[1]);
  });

  it('formats empty array as empty NDJSON string', () => {
    expect(formatNdjson([])).toBe('');
  });

  it('formats plain text for objects and arrays', () => {
    const obj = { id: 'evt-1', description: 'Crossing Rubicon' };
    const text = formatPlain(obj);
    expect(text).toContain('id: evt-1');
    expect(text).toContain('description: Crossing Rubicon');

    const arr = [{ id: 'evt-1', description: 'Event A' }];
    const arrText = formatPlain(arr);
    expect(arrText).toContain('evt-1: Event A');
  });

  it('dispatches formatOutput based on format flag', () => {
    const data = [{ id: '1' }, { id: '2' }];
    const jsonOut = formatOutput(data, 'json', 'direct');
    expect(JSON.parse(jsonOut).success).toBe(true);

    const ndjsonOut = formatOutput(data, 'ndjson', 'direct');
    expect(ndjsonOut.trim().split('\n')).toHaveLength(2);
  });
});
