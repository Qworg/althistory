import { describe, expect, it } from 'vitest';
import { toAxisTime, toInstant } from '@althistory/calendar';
import { EventRepository } from './EventRepository';
import { ArcRepository } from './ArcRepository';
import type { DatabaseManager } from '../utils/database';

/** A database manager whose sessions record the queries they are asked to run. */
function recording() {
  const runs: Array<{ query: string; parameters: Record<string, unknown> }> = [];
  const session = {
    run: async (query: string, parameters: Record<string, unknown> = {}) => {
      runs.push({ query, parameters });
      return { records: [] };
    },
    close: async () => undefined,
  };
  return { manager: { getNeo4jSession: () => session } as unknown as DatabaseManager, runs };
}

const compact = (query: string) => query.replace(/\s+/g, ' ').trim();

describe('the Cypher the repositories send for a moment (docs/specs/deep-time.md, Req 13)', () => {
  it('is exactly what it was for a range inside a Date', async () => {
    const { manager, runs } = recording();
    await new EventRepository(manager).findByTimeRange({ start: toInstant('1066-01-01T00:00:00Z'), end: toInstant('-000043-03-15T00:00:00Z') });
    expect(compact(runs[0]!.query)).toBe('MATCH (e:Event) WHERE e.timestamp >= datetime($startTime) AND e.timestamp <= datetime($endTime) RETURN e ORDER BY e.timestamp ASC');
    expect(runs[0]!.parameters).toEqual({ startTime: '1066-01-01T00:00:00.000Z', endTime: '-000043-03-15T00:00:00.000Z' });
  });

  it('sends a moment beyond a Date as epochMillis, an integer of milliseconds', async () => {
    const { manager, runs } = recording();
    await new EventRepository(manager).findByTimeRange({ start: toInstant('-300000-01-01T00:00:00Z'), end: toInstant('+300000-01-01T00:00:00Z') });
    expect(compact(runs[0]!.query)).toBe(
      'MATCH (e:Event) WHERE e.timestamp >= datetime({epochMillis: $startTime}) AND e.timestamp <= datetime({epochMillis: $endTime}) RETURN e ORDER BY e.timestamp ASC'
    );
    expect(String(runs[0]!.parameters.startTime)).toBe(String(toAxisTime('-300000-01-01T00:00:00Z')));
    expect(String(runs[0]!.parameters.endTime)).toBe(String(toAxisTime('+300000-01-01T00:00:00Z')));
    expect(typeof runs[0]!.parameters.startTime).toBe('object');
  });

  it('does the same for an arc\'s overlap', async () => {
    const { manager, runs } = recording();
    await new ArcRepository(manager).findOverlappingArcs({ start: toInstant('+299999-01-01T00:00:00Z'), end: toInstant('1900-01-01T00:00:00Z') });
    expect(compact(runs[0]!.query)).toContain('a.start_time < datetime($endTime) AND a.end_time > datetime({epochMillis: $startTime})');
  });
});
