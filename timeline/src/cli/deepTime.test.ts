/**
 * @vitest-environment node
 */

/**
 * Deep time, end to end through the direct engine (docs/specs/deep-time.md):
 * a Gregorian history from 500,000 BCE to 300,000 CE, and a chronicle of a
 * million years in a world whose day is 30 hours long, are created, listed in
 * order, causally validated, filtered by --from and --to, exported (as "1.1"),
 * and imported again with the same moments to the millisecond.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { compareAxisTime, isoOfAxisTime, toAxisTime, MAX_AXIS_MS, type WorldCalendarSet } from '@althistory/calendar';
import * as crypto from 'crypto';
import { DirectEngine } from './engine/DirectEngine';
import type { EventDto } from './types';
import { withAxisTimes } from './mcp/worldDates';

/** The moment of each event as an axis time, which every reader of a timestamp reads alike. */
const momentsOf = (events: EventDto[]) => events.map((event) => toAxisTime(event.timestamp)!);

const isSorted = (moments: bigint[]) => moments.every((moment, index) => index === 0 || compareAxisTime(moments[index - 1]!, moment) <= 0);

/** The checksum an export document claims, and the one its data section has. */
function checksums(content: string): { claimed: string; actual: string; version: string; document: any } {
  const document = JSON.parse(content);
  return {
    claimed: document.metadata.checksum,
    actual: crypto.createHash('sha256').update(JSON.stringify(document.data)).digest('hex'),
    version: document.version,
    document,
  };
}

describe('deep time', () => {
  let engine: DirectEngine;
  const created: string[] = [];

  beforeEach(() => {
    engine = new DirectEngine();
  });

  afterEach(async () => {
    for (const id of created.splice(0)) {
      try {
        await engine.deleteGraph(id);
      } catch {
        // Best-effort cleanup
      }
    }
    await engine.shutdown();
  });

  describe('a Gregorian history from 500,000 BCE to 300,000 CE', () => {
    const DATES = [
      ['The first hearths are lit', '-499999-06-15T00:00:00Z'],
      ['Mount Toba erupts', '-070000-01-01T00:00:00Z'],
      ['Caesar is killed', '-000043-03-15T00:00:00Z'],
      ['Hastings', '1066-10-14T09:00:00Z'],
      ['The last city is built', '+300000-01-01T00:00:00Z'],
    ] as const;

    async function build(): Promise<{ graphId: string; ids: string[] }> {
      const graph = await engine.createGraph('Deep Gregorian');
      created.push(graph.id);
      const ids: string[] = [];
      // Created out of order, so the listing's order is the store's, not the insertion's.
      for (const index of [3, 0, 4, 2, 1]) {
        const [description, timestamp] = DATES[index]!;
        const event = await engine.createEvent(graph.id, { description, timestamp, actor: 'People', target: 'World' });
        ids[index] = event.id;
      }
      return { graphId: graph.id, ids };
    }

    it('lists its events in the order of time, whatever order they were written in', async () => {
      const { graphId } = await build();
      const listed = await engine.listEvents(graphId);
      expect(listed.map((event) => event.description)).toEqual(DATES.map(([description]) => description));
      expect(isSorted(momentsOf(listed))).toBe(true);
      expect(listed.map((event) => event.timestamp)).toEqual(DATES.map(([, timestamp]) => isoOfAxisTime(toAxisTime(timestamp)!)));
    });

    it('reads the year-first text the app writes, and keeps 500,000 BCE as it is', async () => {
      const graph = await engine.createGraph('Year first');
      created.push(graph.id);
      const event = await engine.createEvent(graph.id, { description: 'Fire', timestamp: '500000 BCE', actor: 'A', target: 'B' });
      expect(event.timestamp).toBe('-499999-01-01T00:00:00.000Z');
      expect(withAxisTimes(event)).toMatchObject({ timestampMs: String(toAxisTime('-499999-01-01T00:00:00.000Z')) });
    });

    it('filters by --from and --to, to the millisecond', async () => {
      const { graphId } = await build();
      const inside = await engine.listEvents(graphId, { from: '-100000-01-01', to: '+100000-01-01' });
      expect(inside.map((event) => event.description)).toEqual(['Mount Toba erupts', 'Caesar is killed', 'Hastings']);
      const onwards = await engine.listEvents(graphId, { from: '2000-01-01' });
      expect(onwards.map((event) => event.description)).toEqual(['The last city is built']);
      const upTo = await engine.listEvents(graphId, { to: '-400000-01-01' });
      expect(upTo.map((event) => event.description)).toEqual(['The first hearths are lit']);
      // The end of a year is its last moment, so the year of the last city holds the last city.
      const lastYear = await engine.listEvents(graphId, { from: '+300000', to: '+300000' });
      expect(lastYear.map((event) => event.description)).toEqual(['The last city is built']);
    });

    it('orders two moments a millisecond apart, far past where a double can tell them apart', async () => {
      const graph = await engine.createGraph('Milliseconds');
      created.push(graph.id);
      const later = await engine.createEvent(graph.id, { description: 'later', timestamp: '+200000000-01-01T00:00:00.001Z', actor: 'A', target: 'B' });
      const earlier = await engine.createEvent(graph.id, { description: 'earlier', timestamp: '+200000000-01-01T00:00:00.000Z', actor: 'A', target: 'B' });
      const listed = await engine.listEvents(graph.id);
      expect(listed.map((event) => event.description)).toEqual(['earlier', 'later']);
      // A cause one millisecond after its effect is a paradox, and refused.
      await expect(engine.createCausalLink(graph.id, { causeId: later.id, effectId: earlier.id })).rejects.toThrow();
      await expect(engine.createCausalLink(graph.id, { causeId: earlier.id, effectId: later.id })).resolves.toBeDefined();
    });

    it('validates causal order across the whole range, and refuses a cause after its effect', async () => {
      const { graphId, ids } = await build();
      await engine.createCausalLink(graphId, { causeId: ids[0]!, effectId: ids[1]!, type: 'indirect' });
      await engine.createCausalLink(graphId, { causeId: ids[2]!, effectId: ids[3]!, type: 'indirect' });
      await expect(engine.createCausalLink(graphId, { causeId: ids[4]!, effectId: ids[0]! })).rejects.toThrow(/after|paradox|before/i);
      const report = await engine.validateGraph(graphId);
      expect(report.valid).toBe(true);
      expect(report.errorCount).toBe(0);
    });

    it('holds an arc from 500,000 BCE to 300,000 CE, with its events in it', async () => {
      const { graphId, ids } = await build();
      const arc = await engine.createArc(graphId, { name: 'The whole story', startTime: '-499999-01-01T00:00:00Z', endTime: '+300000-12-31T23:59:59.999Z' });
      expect(arc.startTime).toBe('-499999-01-01T00:00:00.000Z');
      expect(arc.endTime).toBe('+300000-12-31T23:59:59.999Z');
      await engine.assignEventToArc(graphId, ids[4]!, arc.id);
      expect(withAxisTimes(arc)).toMatchObject({ startTimeMs: String(toAxisTime(arc.startTime)), endTimeMs: String(toAxisTime(arc.endTime)) });
      const report = await engine.validateGraph(graphId);
      expect(report.errorCount).toBe(0);
    });

    it('is exported as version 1.1, with a checksum that matches, and imports again to the same moments', async () => {
      const { graphId, ids } = await build();
      await engine.createCausalLink(graphId, { causeId: ids[0]!, effectId: ids[1]! });
      await engine.createArc(graphId, { name: 'Ages', startTime: '-499999-01-01T00:00:00Z', endTime: '+300000-12-31T23:59:59.999Z' });

      const exported = checksums((await engine.exportGraph(graphId, 'json')).content!);
      expect(exported.version).toBe('1.1');
      expect(exported.claimed).toBe(exported.actual);
      expect(exported.document.data.events.map((event: { timestamp: string }) => event.timestamp)).toContain('+300000-01-01T00:00:00.000Z');
      expect(exported.document.data.events.map((event: { timestamp: string }) => event.timestamp)).toContain('-499999-06-15T00:00:00.000Z');

      const imported = await engine.importGraph(JSON.stringify(exported.document), { graphId: (await engine.createGraph('Imported')).id });
      created.push(imported.graphId);
      expect(imported.imported.events).toBe(DATES.length);
      const before = await engine.listEvents(graphId);
      const after = await engine.listEvents(imported.graphId);
      expect(momentsOf(after)).toEqual(momentsOf(before));
      expect(after.map((event) => event.description)).toEqual(before.map((event) => event.description));

      // Exported again, it is the same document: the same version and the same data checksum.
      const again = checksums((await engine.exportGraph(imported.graphId, 'json')).content!);
      expect(again.version).toBe('1.1');
      expect(again.claimed).toBe(again.actual);
      expect(again.document.data.events.map((event: { timestamp: string }) => event.timestamp)).toEqual(
        exported.document.data.events.map((event: { timestamp: string }) => event.timestamp)
      );
    });

    it('exports the same graph as Markdown, Graphviz and GraphML with the true dates', async () => {
      const { graphId } = await build();
      for (const format of ['markdown', 'dot', 'graphml'] as const) {
        const content = (await engine.exportGraph(graphId, format)).content!;
        expect(content, format).toContain('300000');
        expect(content, format).toContain('499999');
        expect(content, format).not.toContain('Invalid');
      }
    });
  });

  describe('real history is exported as it always was', () => {
    it('writes version 1.0 for a graph inside what a Date holds, with its checksum', async () => {
      const graph = await engine.createGraph('Modern');
      created.push(graph.id);
      await engine.createEvent(graph.id, { description: 'Sarajevo', timestamp: '1914-06-28T10:00:00Z', actor: 'Princip', target: 'Franz Ferdinand' });
      await engine.createEvent(graph.id, { description: 'Caesar', timestamp: '-000043-03-15T00:00:00Z', actor: 'Senate', target: 'Caesar' });
      const exported = checksums((await engine.exportGraph(graph.id, 'json')).content!);
      expect(exported.version).toBe('1.0');
      expect(exported.claimed).toBe(exported.actual);
    });

    it('lists a history with years before 1 CE in the order of time', async () => {
      const graph = await engine.createGraph('Antiquity');
      created.push(graph.id);
      for (const [description, timestamp] of [['b', '-000043-03-15T00:00:00Z'], ['a', '-000100-07-12T00:00:00Z'], ['c', '0001-01-01T00:00:00Z']] as const) {
        await engine.createEvent(graph.id, { description, timestamp, actor: 'A', target: 'B' });
      }
      expect((await engine.listEvents(graph.id)).map((event) => event.description)).toEqual(['a', 'b', 'c']);
    });
  });

  describe('a chronicle of a million years in a world with a 30-hour day', () => {
    const WORLD: WorldCalendarSet = {
      version: 2,
      dayLength: 30 * 3600,
      primary: 'ages',
      calendars: [
        {
          id: 'ages',
          name: 'The Count of Ages',
          parts: [
            { name: 'Ember', days: 40 },
            { name: 'Ash', days: 41 },
            { name: 'Rest', days: 3, intercalary: true },
          ],
          leapRules: [{ every: 10, part: 2, days: 1 }],
          epoch: 0,
          eras: [{ label: 'AF', from: 1 }],
          beforeEra: 'BF',
          time: { hoursPerDay: 30, minutesPerHour: 60, secondsPerMinute: 60 },
        },
      ],
    };

    async function build(): Promise<{ graphId: string; ids: string[] }> {
      const graph = await engine.createGraph('Chronicle', 'A million years', WORLD);
      created.push(graph.id);
      const texts = ['Ember 4, 20 BF', 'Ash 9, 250000 AF', 'Rest 2, 500000 AF, 17:30', 'Ember 1, 1000000 AF'];
      const ids: string[] = [];
      for (const [index, timestamp] of [2, 0, 3, 1].entries()) {
        const event = await engine.createEvent(graph.id, { description: `Event ${timestamp}`, timestamp: texts[timestamp]!, actor: 'Folk', target: 'Land' });
        ids[timestamp] = event.id;
        expect(index).toBeGreaterThanOrEqual(0);
      }
      return { graphId: graph.id, ids };
    }

    it('keeps each event where it falls, listed in order, and shows them in the world\'s notation', async () => {
      const { graphId } = await build();
      const listed = await engine.listEvents(graphId);
      expect(listed.map((event) => event.description)).toEqual(['Event 0', 'Event 1', 'Event 2', 'Event 3']);
      expect(isSorted(momentsOf(listed))).toBe(true);
      // A million world years of 128 days of 30 hours is well beyond a Date.
      expect(listed[3]!.timestamp).toMatch(/^\+\d{6,9}-/);
      expect(listed[0]!.timestamp).toMatch(/^[-+]?\d+-/);
      expect(momentsOf(listed).every((moment) => moment < MAX_AXIS_MS)).toBe(true);
    });

    it('filters by the world\'s own dates, and validates causal order', async () => {
      const { graphId, ids } = await build();
      const middle = await engine.listEvents(graphId, { from: 'Ember 1, 100 AF', to: 'Rest 3, 600000 AF' });
      expect(middle.map((event) => event.description)).toEqual(['Event 1', 'Event 2']);
      await engine.createCausalLink(graphId, { causeId: ids[0]!, effectId: ids[3]!, type: 'indirect' });
      await expect(engine.createCausalLink(graphId, { causeId: ids[3]!, effectId: ids[1]! })).rejects.toThrow();
      expect((await engine.validateGraph(graphId)).valid).toBe(true);
    });

    it('is exported as 1.1 with the calendar, and imports to the same moments, shown the same', async () => {
      const { graphId } = await build();
      const exported = checksums((await engine.exportGraph(graphId, 'json')).content!);
      expect(exported.version).toBe('1.1');
      expect(exported.claimed).toBe(exported.actual);
      expect(exported.document.metadata.calendar.dayLength).toBe(30 * 3600);
      const target = await engine.createGraph('Chronicle copy', undefined, WORLD);
      created.push(target.id);
      const imported = await engine.importGraph(JSON.stringify(exported.document), { graphId: target.id });
      expect(imported.imported.events).toBe(4);
      expect(momentsOf(await engine.listEvents(target.id))).toEqual(momentsOf(await engine.listEvents(graphId)));
    });

    it('generates a chronicle that runs past the year 9999 and past a Date', async () => {
      const result = await engine.generateTimeline({
        world: 'The Long Count',
        calendar: WORLD,
        startDate: 'Ember 1, 1 AF',
        endDate: 'Ember 1, 3000000 AF',
        eventCount: 6,
        dryRun: true,
      });
      expect(result.events.length).toBe(6);
      const moments = result.events.map((event) => toAxisTime(event.timestamp)!);
      expect(isSorted(moments)).toBe(true);
      expect(moments[moments.length - 1]! > 8_640_000_000_000_000n).toBe(true);
    });
  });
});
