/**
 * Tests for the pattern-based and LLM-assisted text extractor.
 */

import { describe, it, expect, vi } from 'vitest';
import { TextExtractor, patternConfidence } from './TextExtractor';
import { ExtractedEvent, ExtractedRelationship } from './types';
import { LLMClient } from '../llm/LLMClient';

function fakeEvent(overrides: Partial<ExtractedEvent> = {}): ExtractedEvent {
  return {
    tempId: 'llm-1',
    description: 'LLM event',
    actor: 'Actor',
    target: 'Target',
    timestamp: '1066-10-14T00:00:00Z',
    confidence: 0.9,
    source: { type: 'llm', extractedAt: '2020-01-01T00:00:00Z' },
    selected: true,
    edited: false,
    ...overrides,
  };
}

function fakeRelationship(
  cause: ExtractedEvent,
  effect: ExtractedEvent,
  overrides: Partial<ExtractedRelationship> = {}
): ExtractedRelationship {
  return {
    tempId: 'llm-rel-0-1',
    causeEventTempId: cause.tempId,
    effectEventTempId: effect.tempId,
    weight: 0.7,
    confidence: 0.6,
    reasoning: 'the first made the second possible',
    source: { type: 'llm', extractedAt: '2020-01-01T00:00:00Z' },
    selected: true,
    ...overrides,
  };
}

function fakeLLMClient(overrides: Partial<LLMClient> = {}): LLMClient {
  return {
    provider: 'fake',
    extractEvents: vi.fn().mockResolvedValue([fakeEvent()]),
    suggestRelationships: vi.fn().mockResolvedValue([] as ExtractedRelationship[]),
    enrichDescription: vi.fn().mockResolvedValue('description'),
    ...overrides,
  };
}

describe('TextExtractor (pattern-based)', () => {
  it('extracts a dated event with actor and target', async () => {
    const extractor = new TextExtractor();
    const result = await extractor.extract({
      text: 'The Treaty of Paris was signed on 10 February 1763 by representatives of Great Britain and France.',
    });

    expect(result.events).toHaveLength(1);
    expect(result.events[0]).toMatchObject({
      timestamp: '1763-02-10T00:00:00Z',
      actor: 'Treaty of Paris',
      target: 'Great Britain',
      source: { type: 'text' },
      selected: true,
      edited: false,
    });
    expect(result.events[0].confidence).toBeCloseTo(0.9, 5);
    expect(result.overallConfidence).toBeCloseTo(0.9, 5);
    expect(result.sources[0].type).toBe('text-extraction');
  });

  it('returns no events when the text has no recognisable date', async () => {
    const extractor = new TextExtractor();
    const result = await extractor.extract({ text: 'Nothing datable happened here.' });
    expect(result.events).toHaveLength(0);
    expect(result.sources).toHaveLength(0);
  });

  it('extracts one event per dated sentence', async () => {
    const extractor = new TextExtractor();
    const result = await extractor.extract({
      text: 'Paris was liberated on 25 August 1944. The armistice followed on 8 May 1945.',
    });
    expect(result.events).toHaveLength(2);
    expect(result.events.map((event) => event.timestamp)).toEqual([
      '1944-08-25T00:00:00Z',
      '1945-05-08T00:00:00Z',
    ]);
  });

  it('uses a default actor from context', async () => {
    const extractor = new TextExtractor();
    const result = await extractor.extract(
      { text: 'The town fell on 3 September 1939.' },
      { defaultActors: ['Germany'] }
    );
    expect(result.events[0].actor).toBe('Germany');
  });

  it('marks a dated sentence with no named entity unselected so a default approve skips it', async () => {
    const extractor = new TextExtractor();
    const result = await extractor.extract({ text: 'the town fell on 3 September 1939.' });

    expect(result.events).toHaveLength(1);
    expect(result.events[0]).toMatchObject({
      actor: '',
      target: '',
      selected: false,
      timestamp: '1939-09-03T00:00:00Z',
    });
  });

  it('repeats the actor as the target when the sentence names only one entity', async () => {
    const extractor = new TextExtractor();
    const result = await extractor.extract({ text: 'Paris was liberated on 25 August 1944.' });

    expect(result.events).toHaveLength(1);
    expect(result.events[0]).toMatchObject({ actor: 'Paris', target: 'Paris', selected: true });
  });
});

describe('TextExtractor (LLM-assisted)', () => {
  it('prefers LLM extraction when a client is configured', async () => {
    const llm = fakeLLMClient();
    const extractor = new TextExtractor({ llmClient: llm });

    const result = await extractor.extract({ text: 'The Treaty of Paris was signed in 1763.' });

    expect(llm.extractEvents).toHaveBeenCalledTimes(1);
    expect(result.events).toHaveLength(1);
    expect(result.events[0].source.type).toBe('llm');
    expect(result.sources[0].type).toBe('llm-generated');
  });

  it('falls back to pattern extraction when the LLM throws', async () => {
    const llm = fakeLLMClient({
      extractEvents: vi.fn().mockRejectedValue(new Error('provider unavailable')),
    });
    const extractor = new TextExtractor({ llmClient: llm });

    const result = await extractor.extract({ text: 'The Treaty of Paris was signed on 10 February 1763.' });

    expect(result.events).toHaveLength(1);
    expect(result.events[0].source.type).toBe('text');
    expect(result.sources[0].type).toBe('text-extraction');
  });

  it('falls back to patterns when the LLM returns no events', async () => {
    const llm = fakeLLMClient({ extractEvents: vi.fn().mockResolvedValue([]) });
    const extractor = new TextExtractor({ llmClient: llm });

    const result = await extractor.extract({ text: 'The Treaty of Paris was signed on 10 February 1763.' });

    expect(result.events).toHaveLength(1);
    expect(result.events[0].source.type).toBe('text');
  });

  it('does not call the LLM when useLLM is false', async () => {
    const llm = fakeLLMClient();
    const extractor = new TextExtractor({ llmClient: llm });

    await extractor.extract({ text: 'The Treaty of Paris was signed in 1763.', useLLM: false });

    expect(llm.extractEvents).not.toHaveBeenCalled();
  });
});

describe('TextExtractor (LLM relationships)', () => {
  it('asks the model for relationships between the extracted events', async () => {
    const first = fakeEvent({ tempId: 'llm-1' });
    const second = fakeEvent({ tempId: 'llm-2', timestamp: '1067-01-01T00:00:00Z' });
    const llm = fakeLLMClient({
      extractEvents: vi.fn().mockResolvedValue([first, second]),
      suggestRelationships: vi.fn().mockResolvedValue([fakeRelationship(first, second)]),
    });

    const result = await new TextExtractor({ llmClient: llm }).extract({ text: 'anything' });

    expect(llm.suggestRelationships).toHaveBeenCalledWith([first, second]);
    expect(result.events).toHaveLength(2);
    expect(result.relationships).toHaveLength(1);
    expect(result.relationships[0]).toMatchObject({
      causeEventTempId: 'llm-1',
      effectEventTempId: 'llm-2',
      reasoning: 'the first made the second possible',
    });
  });

  it('drops a suggested relationship that names an event outside the extraction', async () => {
    const first = fakeEvent({ tempId: 'llm-1' });
    const second = fakeEvent({ tempId: 'llm-2', timestamp: '1067-01-01T00:00:00Z' });
    const llm = fakeLLMClient({
      extractEvents: vi.fn().mockResolvedValue([first, second]),
      suggestRelationships: vi
        .fn()
        .mockResolvedValue([fakeRelationship(first, second, { effectEventTempId: 'ghost' })]),
    });

    const result = await new TextExtractor({ llmClient: llm }).extract({ text: 'anything' });

    expect(result.relationships).toHaveLength(0);
    expect(result.events).toHaveLength(2);
  });

  it('still returns the events when relationship suggestion fails', async () => {
    const llm = fakeLLMClient({
      suggestRelationships: vi.fn().mockRejectedValue(new Error('provider unavailable')),
    });

    const result = await new TextExtractor({ llmClient: llm }).extract({ text: 'anything' });

    expect(result.events).toHaveLength(1);
    expect(result.events[0].source.type).toBe('llm');
    expect(result.relationships).toHaveLength(0);
  });

  it('does not ask for relationships when a single event was extracted', async () => {
    const llm = fakeLLMClient();

    const result = await new TextExtractor({ llmClient: llm }).extract({ text: 'anything' });

    expect(llm.suggestRelationships).not.toHaveBeenCalled();
    expect(result.relationships).toHaveLength(0);
  });
});

describe('patternConfidence', () => {
  it('rewards date precision and complete entities', () => {
    expect(patternConfidence('day', true, true)).toBeGreaterThan(patternConfidence('year', false, false));
    expect(patternConfidence('day', true, true)).toBeCloseTo(0.9, 5);
    expect(patternConfidence('year', false, false)).toBeCloseTo(0.4, 5);
  });
});
