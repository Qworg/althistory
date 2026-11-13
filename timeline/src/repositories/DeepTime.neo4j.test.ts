/**
 * Moments beyond a Date through a real Neo4j (docs/specs/deep-time.md, Req 13).
 *
 * Requires Neo4j (and runs only through `npm run test:cloud`, like the other
 * repository suites): +300000 and -300000 years are written as
 * `datetime({epochMillis: $p})`, read back from the driver's `DateTime` fields,
 * ordered and filtered by the database, and equal to the millisecond.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { toAxisTime } from '@althistory/calendar';
import { EventRepository } from './EventRepository';
import { ArcRepository } from './ArcRepository';
import { DatabaseManager, LocalDatabaseManager, initializeDatabaseManager, DatabaseConfig } from '../utils/database';
import { initializeSchema } from '../utils/schema';
import { toInstant } from '@althistory/calendar';

const testConfig: DatabaseConfig = {
  neo4j: {
    uri: process.env.NEO4J_TEST_URI || 'bolt://localhost:7687',
    username: process.env.NEO4J_TEST_USERNAME || 'neo4j',
    password: process.env.NEO4J_TEST_PASSWORD || 'password',
    database: process.env.NEO4J_TEST_DATABASE || 'test',
  },
  redis: {
    host: process.env.REDIS_TEST_HOST || 'localhost',
    port: parseInt(process.env.REDIS_TEST_PORT || '6379', 10),
    password: process.env.REDIS_TEST_PASSWORD,
  },
};

const DEEP = [
  '-300000-03-15T12:00:00.123Z',
  '-000043-03-15T00:00:00.000Z',
  '1066-10-14T09:00:00.000Z',
  '+300000-03-15T12:00:00.123Z',
  // Past where a double holds a millisecond (2^53 ms, about 285,000 years).
  '+200000000-01-01T00:00:00.001Z',
];

describe('events and arcs beyond a Date, in Neo4j', () => {
  let databaseManager: DatabaseManager | LocalDatabaseManager;
  let events: EventRepository;
  let arcs: ArcRepository;

  beforeAll(async () => {
    databaseManager = initializeDatabaseManager(testConfig);
    await databaseManager.initializeNeo4j();
    await initializeSchema();
  });

  beforeEach(async () => {
    events = new EventRepository(databaseManager);
    arcs = new ArcRepository(databaseManager);
    const session = databaseManager.getNeo4jSession();
    await session.run('MATCH (n) WHERE n:Event OR n:Arc DETACH DELETE n');
    await session.close();
  });

  afterAll(async () => {
    const session = databaseManager.getNeo4jSession();
    await session.run('MATCH (n) WHERE n:Event OR n:Arc DETACH DELETE n');
    await session.close();
    await databaseManager.close();
  });

  it('round-trips ±300000 years, and 200 million, to the millisecond', async () => {
    for (const timestamp of DEEP) {
      const created = await events.create({ description: timestamp, actor: 'A', target: 'B', timestamp: toInstant(timestamp) });
      const found = await events.findById(created.id);
      expect(found!.timestamp.toISOString()).toBe(timestamp);
      expect(toAxisTime(found!.timestamp)).toBe(toAxisTime(timestamp));
    }
  });

  it('orders them in time, and filters them by a range given as moments', async () => {
    for (const timestamp of [...DEEP].reverse()) {
      await events.create({ description: timestamp, actor: 'A', target: 'B', timestamp: toInstant(timestamp) });
    }
    const all = await events.findAll();
    expect(all.map((event) => event.description)).toEqual(DEEP);
    const range = await events.findByTimeRange({ start: toInstant('-000100-01-01T00:00:00Z'), end: toInstant('+300000-12-31T23:59:59.999Z') });
    expect(range.map((event) => event.description)).toEqual(DEEP.slice(1, 4));
    const deepRange = await events.findByTimeRange({ start: toInstant('+200000000-01-01T00:00:00.000Z'), end: toInstant('+200000000-01-01T00:00:00.001Z') });
    expect(deepRange.map((event) => event.description)).toEqual([DEEP[4]]);
  });

  it('holds an arc from 300000 BCE to 300000 CE', async () => {
    const arc = await arcs.create({ name: 'All', start_time: toInstant(DEEP[0]!), end_time: toInstant(DEEP[3]!), level: 0 });
    const found = await arcs.findById(arc.id);
    expect(found!.start_time.toISOString()).toBe(DEEP[0]);
    expect(found!.end_time.toISOString()).toBe(DEEP[3]);
    const overlapping = await arcs.findOverlapping({ start: toInstant('+299999-01-01T00:00:00Z'), end: toInstant('+300001-01-01T00:00:00Z') });
    expect(overlapping.map((a) => a.id)).toEqual([arc.id]);
  });
});
