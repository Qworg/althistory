import { describe, expect, it } from 'vitest';
import { type WorldCalendarSet, readWorldTimestamp } from '@althistory/calendar';
import { buildEventExtractionPrompt, buildRelationshipPrompt } from './prompts';
import type { ExtractedEvent } from '../ingestion/types';

const VAEL: WorldCalendarSet = {
  version: 2,
  dayLength: 86_400,
  primary: 'reckoning',
  calendars: [{ id: 'reckoning', name: 'the Reckoning', parts: [{ name: 'Thaw', days: 30 }, { name: 'Gale', days: 30 }], epoch: 0, eras: [{ label: 'AR', from: 1 }] }],
};

describe('what the model is told about dates', () => {
  it('without a world, to write ISO 8601', () => {
    const prompt = buildEventExtractionPrompt('text');
    expect(prompt.systemPrompt).toContain('ISO-8601 timestamp');
  });

  it("in a world, to write the world's notation and never convert to ISO, in the prompt and the schema alike", () => {
    const prompt = buildEventExtractionPrompt('text', { calendar: VAEL });
    expect(prompt.systemPrompt).not.toContain('ISO-8601 timestamp');
    expect(prompt.systemPrompt).toContain('never converted to an ISO date');
    expect(JSON.stringify(prompt.schema)).not.toContain('ISO-8601');
  });

  it("lists a world's events in its notation, at their precision, when asked for causes", () => {
    const thaw = readWorldTimestamp(VAEL, 'Thaw 312 AR')!;
    const event = { tempId: 'e', description: 'The river rose', timestamp: thaw.iso, datePrecision: 'month' } as ExtractedEvent;
    expect(buildRelationshipPrompt([event], { calendar: VAEL }).userPrompt).toContain('0: The river rose (Thaw 312 AR)');
  });

  it("reads a world's default time range by the one rule, and shows text it cannot read as written", () => {
    const prompt = buildEventExtractionPrompt('text', { calendar: VAEL, defaultTimeRange: { start: 'Thaw 312 AR', end: 'whenever' } });
    expect(prompt.userPrompt).toContain('Default time range: Thaw 312 AR to whenever');
  });
});
