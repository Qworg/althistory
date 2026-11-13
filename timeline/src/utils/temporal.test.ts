import * as os from 'os';
import * as path from 'path';
import { describe, expect, it } from 'vitest';
import { AxisDate, isoOfAxisTime, toAxisTime } from '@althistory/calendar';
import { deepTemporalQuery, readInstantValue, runTemporal } from './temporal';
import { LocalGraphStore, readEpochMillis } from './LocalGraphStore';
import { exportVersionOf, isDeepTimestamp } from './exportVersion';

describe('a query that holds a moment beyond a Date', () => {
  const query = 'MATCH (e:Event) WHERE e.timestamp >= datetime($startTime) AND e.timestamp <= datetime($endTime) RETURN e';

  it('is sent exactly as written when every moment is inside a Date', () => {
    const parameters = { startTime: '1066-01-01T00:00:00.000Z', endTime: '-000043-03-15T00:00:00.000Z' };
    const sent = deepTemporalQuery(query, parameters);
    expect(sent.query).toBe(query);
    expect(sent.parameters).toBe(parameters);
  });

  it('sends a deep moment as a 64-bit integer of milliseconds, and no other', () => {
    const sent = deepTemporalQuery(query, { startTime: '1066-01-01T00:00:00.000Z', endTime: '+300000-01-01T00:00:00.000Z' });
    expect(sent.query).toBe(
      'MATCH (e:Event) WHERE e.timestamp >= datetime($startTime) AND e.timestamp <= datetime({epochMillis: $endTime}) RETURN e'
    );
    expect(sent.parameters.startTime).toBe('1066-01-01T00:00:00.000Z');
    // A neo4j Integer: its text is the exact count of milliseconds.
    expect(String(sent.parameters.endTime)).toBe(String(toAxisTime('+300000-01-01T00:00:00.000Z')));
  });

  it('is turned back into the text the local store keeps', () => {
    const sent = deepTemporalQuery('CREATE (e:Event {timestamp: datetime($timestamp)})', { timestamp: '-499999-06-15T00:00:00.000Z' });
    expect(sent.query).toContain('epochMillis');
    const read = readEpochMillis(sent.query, sent.parameters);
    expect(read.query).toBe('CREATE (e:Event {timestamp: datetime($timestamp__iso)})');
    expect(read.parameters.timestamp__iso).toBe('-499999-06-15T00:00:00.000Z');
  });

  it('runs through any session with the rewritten query', async () => {
    const seen: Array<[string, Record<string, unknown> | undefined]> = [];
    const session = { run: async (text: string, parameters?: Record<string, unknown>) => (seen.push([text, parameters]), 'ok') };
    await runTemporal(session, query, { startTime: '+999999-01-01T00:00:00.000Z', endTime: '+999999-01-02T00:00:00.000Z' });
    expect(seen[0]![0]).toContain('datetime({epochMillis: $startTime})');
  });
});

describe('a stored moment, read', () => {
  it('reads the fields a driver gives, as numbers or as integers', () => {
    const integer = (value: number) => ({ toString: () => String(value) });
    expect(readInstantValue({ year: 1066, month: 10, day: 14, hour: 9, minute: 30, second: 0, nanosecond: 0, timeZoneOffsetSeconds: 0 }, 'x').toISOString()).toBe(
      '1066-10-14T09:30:00.000Z'
    );
    const deep = readInstantValue(
      { year: integer(300000), month: integer(1), day: integer(1), hour: integer(0), minute: integer(0), second: integer(0), nanosecond: integer(5_000_000), timeZoneOffsetSeconds: integer(0) },
      'x'
    );
    expect(deep).toBeInstanceOf(AxisDate);
    expect(deep.toISOString()).toBe('+300000-01-01T00:00:00.005Z');
    expect(readInstantValue({ year: -499999, month: 6, day: 15, hour: 0, minute: 0, second: 0, nanosecond: 0, timeZoneOffsetSeconds: 3600 }, 'x').toISOString()).toBe(
      '-499999-06-14T23:00:00.000Z'
    );
  });

  it('reads the text the local store keeps, and refuses nothing', () => {
    expect(readInstantValue('+300000-01-01T00:00:00.000Z', 'x').toISOString()).toBe('+300000-01-01T00:00:00.000Z');
    expect(readInstantValue('1066-10-14T00:00:00.000Z', 'x').getTime()).toBe(Date.parse('1066-10-14T00:00:00.000Z'));
    expect(() => readInstantValue(null, 'timestamp')).toThrow(/missing/);
  });
});

describe('the local store orders moments as moments', () => {
  it('puts 100 BCE before 43 BCE, and 300,000 CE after 2000 CE', async () => {
    // Never initialised or saved: the moments live in memory for the test.
    const store = new LocalGraphStore({ dataFile: path.join(os.tmpdir(), `temporal-${process.pid}.json`) });
    const stamps = ['+300000-01-01T00:00:00.000Z', '2000-01-01T00:00:00.000Z', '-000043-03-15T00:00:00.000Z', '-000100-07-12T00:00:00.000Z', '-499999-01-01T00:00:00.000Z'];
    for (const [index, timestamp] of stamps.entries()) {
      await store.executeQuery('CREATE (e:Event {id: $id, timestamp: datetime($timestamp)})', { id: `e${index}`, timestamp });
    }
    const result = await store.executeQuery('MATCH (e:Event) RETURN e ORDER BY e.timestamp ASC');
    const ordered = result.records.map((record) => String((record.get('e') as { properties: { timestamp: unknown } }).properties.timestamp));
    expect(ordered).toEqual([...stamps].sort((a, b) => Number(toAxisTime(a)! - toAxisTime(b)!)));
    const window = await store.executeQuery(
      'MATCH (e:Event) WHERE e.timestamp >= datetime($start) AND e.timestamp <= datetime($end) RETURN e ORDER BY e.timestamp ASC',
      { start: '-000100-01-01T00:00:00.000Z', end: '2000-01-01T00:00:00.000Z' }
    );
    expect(window.records.length).toBe(3);
    const deep = await store.executeQuery('MATCH (e:Event) WHERE e.timestamp > datetime($start) RETURN e', { start: '+299999-12-31T23:59:59.999Z' });
    expect(deep.records.length).toBe(1);
  });
});

describe('the version of an export', () => {
  it('is 1.0 inside what a Date holds, and 1.1 beyond it', () => {
    const inside = { events: [{ timestamp: '1066-10-14T00:00:00.000Z' }, { timestamp: '-000043-03-15T00:00:00.000Z' }], arcs: [{ start_time: '0001-01-01T00:00:00.000Z', end_time: '+275760-09-13T00:00:00.000Z' }] };
    expect(exportVersionOf(inside)).toBe('1.0');
    expect(exportVersionOf({ ...inside, events: [...inside.events, { timestamp: '+275760-09-13T00:00:00.001Z' }] })).toBe('1.1');
    expect(exportVersionOf({ events: [], arcs: [{ start_time: '-271822-01-01T00:00:00.000Z', end_time: '1066-01-01T00:00:00.000Z' }] })).toBe('1.1');
    expect(isDeepTimestamp('not a date')).toBe(false);
    expect(isDeepTimestamp(isoOfAxisTime(9_000_000_000_000_000n))).toBe(true);
  });
});
