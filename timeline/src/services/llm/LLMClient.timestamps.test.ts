import { describe, it, expect } from 'vitest';
import { parseExtractedEvents } from './LLMClient';
import { formatInWorld, normalizeCalendarSet } from '@althistory/calendar';
import { selectForImport } from '../ingestion/IngestionOrchestrator';

/**
 * A model's dates are read by the package's ISO reader, the one the review
 * screen and the commit use, so the three agree on what is a date and when
 * it falls.
 */
describe('timestamps in a model extraction', () => {
  const source = { type: 'llm' as const, extractedAt: '2026-11-12T00:00:00Z' };
  const event = (timestamp: string) => ({ description: `At ${timestamp}`, actor: 'A', target: 'B', timestamp });

  it('keeps every ISO 8601 form a model writes, as the one spelling everything downstream reads alike', () => {
    const forms: Array<[string, string, ('month' | 'year')?]> = [
      ['1843-11-20T00:00:00Z', '1843-11-20T00:00:00.000Z'],
      ['1843-11-20', '1843-11-20T00:00:00.000Z'],
      ['1871-03', '1871-03-01T00:00:00.000Z', 'month'],
      ['1066', '1066-01-01T00:00:00.000Z', 'year'],
      ['1870-02-14 09:30', '1870-02-14T09:30:00.000Z'],
      ['1870-02-14T09:30:00+0545', '1870-02-14T03:45:00.000Z'],
      ['1066-10-14T09:30+05', '1066-10-14T04:30:00.000Z'],
      ['1066-10-14T09:30:00,5Z', '1066-10-14T09:30:00.500Z'],
    ];
    const parsed = parseExtractedEvents({ events: forms.map(([text]) => event(text)) }, source);
    expect(parsed.map((e) => e.timestamp)).toEqual(forms.map(([, iso]) => iso));
    expect(parsed.map((e) => e.datePrecision)).toEqual(forms.map(([, , precision]) => precision));
    // toISOString's spelling: new Date() anywhere downstream reads the same instant.
    for (const e of parsed) expect(new Date(e.timestamp).toISOString()).toBe(e.timestamp);
  });

  it('drops an event whose date is prose or does not exist, as it drops one with no date', () => {
    const parsed = parseExtractedEvents(
      { events: [event('Feb 14 1870'), event('2019-02-31'), event(''), event('1843-11-20')] },
      source
    );
    expect(parsed.map((e) => e.timestamp)).toEqual(['1843-11-20T00:00:00.000Z']);
  });
});

describe("a model's dates in an invented world's own calendar", () => {
  const source = { type: 'llm' as const, extractedAt: '2026-11-12T00:00:00Z' };
  const world = normalizeCalendarSet({
    version: 2,
    dayLength: 30 * 3600,
    primary: 'reckoning',
    calendars: [
      {
        id: 'reckoning',
        name: 'the Reckoning',
        parts: [{ name: 'Lowtide', days: 40 }, { name: 'Greywater', days: 40 }, { name: 'The Drowned Days', days: 5, intercalary: true }],
        epoch: 0,
        eras: [{ label: 'AR', from: 1 }],
      },
    ],
  });

  it('reads them with the world calendar, keeping what the text stated', () => {
    const parsed = parseExtractedEvents(
      {
        events: [
          { description: 'War', actor: 'A', target: 'B', timestamp: 'Greywater 38, 312 AR' },
          { description: 'Thaw', actor: 'A', target: 'B', timestamp: 'Greywater 312 AR' },
          { description: 'Feast', actor: 'A', target: 'B', timestamp: 'The Drowned Days 5, 312 AR' },
          { description: 'ISO still', actor: 'A', target: 'B', timestamp: '1843-11-20' },
          { description: 'No such day', actor: 'A', target: 'B', timestamp: 'Greywater 41, 312 AR' },
        ],
      },
      source,
      world
    );
    expect(parsed.map((e) => formatInWorld(world, Date.parse(e.timestamp), e.datePrecision ?? 'day'))).toEqual([
      'Greywater 38, 312 AR',
      'Greywater 312 AR',
      'The Drowned Days 5, 312 AR',
      formatInWorld(world, Date.parse('1843-11-20T00:00:00Z')),
    ]);
    expect(parsed[1]!.datePrecision).toBe('month');
  });

  it("reads a reviewer's edit with the same calendar", () => {
    const extraction = {
      events: [{ tempId: 'e1', description: 'War', actor: 'A', target: 'B', timestamp: '2000-01-01T00:00:00.000Z', confidence: 1, source, selected: true, edited: false }],
      arcs: [],
      relationships: [],
      sources: [],
      overallConfidence: 1,
    };
    const selected = selectForImport(extraction as never, { edits: { e1: { timestamp: 'Lowtide 12, 5 AR' } } } as never, world);
    expect(formatInWorld(world, Date.parse(selected.events[0]!.timestamp))).toBe('Lowtide 12, 5 AR');
  });
});
