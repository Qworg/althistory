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

describe('patternConfidence', () => {
  it('rewards date precision and complete entities', () => {
    expect(patternConfidence('day', true, true)).toBeGreaterThan(patternConfidence('year', false, false));
    expect(patternConfidence('day', true, true)).toBeCloseTo(0.9, 5);
    expect(patternConfidence('year', false, false)).toBeCloseTo(0.4, 5);
  });
});
