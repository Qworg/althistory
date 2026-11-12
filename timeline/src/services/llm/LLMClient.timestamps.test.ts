import { describe, it, expect } from 'vitest';
import { parseExtractedEvents } from './LLMClient';

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
