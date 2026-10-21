/**
 * Merging the two readings of a text.
 *
 * The hybrid mode reads a text with the patterns and with the model, and the
 * result is one set of events. These tests cover the two ways that can go
 * wrong: the same event read twice becoming two events, and the copy that
 * should have won not winning.
 */

import { describe, it, expect } from 'vitest';
import { mergeExtractionResults, describesSameEvent } from './mergeExtractions';
import { TextExtractor } from './TextExtractor';
import { ExtractedEvent, ExtractionResult } from './types';

const source = { type: 'text' as const, extractedAt: '2026-01-01T00:00:00Z' };

function event(overrides: Partial<ExtractedEvent> & { tempId: string; description: string }): ExtractedEvent {
  return {
    actor: 'Great Britain',
    target: 'France',
    timestamp: '1763-02-10T00:00:00Z',
    confidence: 0.7,
    source,
    selected: true,
    edited: false,
    ...overrides,
  };
}

function result(events: ExtractedEvent[]): ExtractionResult {
  return {
    events,
    arcs: [],
    relationships: [],
    sources: [],
    overallConfidence: events.length ? events[0].confidence : 0,
  };
}

describe('describesSameEvent', () => {
  it('reads a paraphrase as the same event', () => {
    const pattern = event({
      tempId: 'p1',
      description: 'The Treaty of Paris was signed on 10 February 1763 by Great Britain and France.',
    });
    const model = event({
      tempId: 'm1',
      description: 'Great Britain and France signed the Treaty of Paris in 1763.',
      confidence: 0.9,
    });

    expect(describesSameEvent(pattern, model)).toBe(true);
  });

  it('keeps two different events apart', () => {
    const first = event({ tempId: 'p1', description: 'The Battle of Hastings was fought.' });
    const second = event({ tempId: 'p2', description: 'The Magna Carta was sealed by King John.' });

    expect(describesSameEvent(first, second)).toBe(false);
  });

  it('keeps two events of the same day apart when they read differently', () => {
    const first = event({ tempId: 'p1', description: 'The army crossed the river at dawn.' });
    const second = event({
      tempId: 'p2',
      description: 'The treaty was signed in the palace.',
      actor: 'France',
      target: 'Spain',
    });

    expect(describesSameEvent(first, second)).toBe(false);
  });

  it('reads a concise model description as the sentence the patterns read', () => {
    // The model is asked for a concise description and the patterns quote the
    // whole sentence, so the two hardly share any wording. They still
    // describe one event, and the match has to be made on the event itself.
    const pattern = event({
      tempId: 'p1',
      description: 'On 4 July 1776, the Continental Congress adopted the Declaration of Independence.',
      actor: 'Continental Congress',
      target: 'Declaration of Independence',
      timestamp: '1776-07-04T00:00:00Z',
    });
    const model = event({
      tempId: 'm1',
      description: 'Adoption of the Declaration of Independence',
      actor: 'Continental Congress',
      target: 'Declaration of Independence',
      timestamp: '1776-07-04T00:00:00Z',
      confidence: 0.9,
    });

    expect(describesSameEvent(pattern, model)).toBe(true);
  });

  it('reads a model description that names the actor differently as the same event', () => {
    const pattern = event({
      tempId: 'p1',
      description: 'On 4 July 1776, the Continental Congress adopted the Declaration of Independence.',
      actor: 'Continental Congress',
      target: 'Declaration of Independence',
      timestamp: '1776-07-04T00:00:00Z',
    });
    const model = event({
      tempId: 'm1',
      description: 'The Second Continental Congress adopts the Declaration of Independence',
      actor: 'Second Continental Congress',
      target: 'Declaration of Independence',
      timestamp: '1776-07-04T00:00:00Z',
      confidence: 0.9,
    });

    expect(describesSameEvent(pattern, model)).toBe(true);
  });
});

describe('mergeExtractionResults', () => {
  it('does not write the same event twice when the model paraphrases it', () => {
    const pattern = result([
      event({
        tempId: 'p1',
        description: 'The Treaty of Paris was signed on 10 February 1763 by Great Britain and France.',
        confidence: 0.6,
      }),
    ]);
    const model = result([
      event({
        tempId: 'm1',
        description: 'Great Britain and France signed the Treaty of Paris in 1763.',
        confidence: 0.9,
      }),
    ]);

    const merged = mergeExtractionResults(pattern, model);

    expect(merged.events).toHaveLength(1);
    // The copy with the higher confidence wins.
    expect(merged.events[0].confidence).toBe(0.9);
    expect(merged.events[0].description).toContain('Great Britain and France signed');
  });

  it('lets the pattern copy win when it is the more certain one', () => {
    const pattern = result([
      event({
        tempId: 'p1',
        description: 'The Treaty of Paris was signed on 10 February 1763 by Great Britain and France.',
        confidence: 0.95,
      }),
    ]);
    const model = result([
      event({
        tempId: 'm1',
        description: 'Great Britain and France signed the Treaty of Paris in 1763.',
        confidence: 0.5,
      }),
    ]);

    const merged = mergeExtractionResults(pattern, model);

    expect(merged.events).toHaveLength(1);
    expect(merged.events[0].confidence).toBe(0.95);
    expect(merged.events[0].description).toContain('The Treaty of Paris was signed');
  });

  it('keeps the events the other reading found', () => {
    const pattern = result([
      event({ tempId: 'p1', description: 'The Treaty of Paris was signed in 1763.', confidence: 0.6 }),
    ]);
    const model = result([
      event({
        tempId: 'm1',
        description: 'The Battle of Hastings was fought in 1066.',
        actor: 'Normans',
        target: 'Anglo-Saxons',
        timestamp: '1066-10-14T00:00:00Z',
        confidence: 0.9,
      }),
    ]);

    const merged = mergeExtractionResults(pattern, model);

    expect(merged.events).toHaveLength(2);
  });

  it('keeps the relationships of the model pointing at the merged events', () => {
    const pattern = result([
      event({
        tempId: 'p1',
        description: 'The Treaty of Paris was signed on 10 February 1763 by Great Britain and France.',
        confidence: 0.95,
      }),
    ]);
    const model = result([
      event({
        tempId: 'm1',
        description: 'Great Britain and France signed the Treaty of Paris in 1763.',
        confidence: 0.5,
      }),
      event({
        tempId: 'm2',
        description: 'The war that followed reshaped the colonies.',
        actor: 'Great Britain',
        target: 'France',
        timestamp: '1763-06-01T00:00:00Z',
        confidence: 0.9,
      }),
    ]);
    model.relationships = [
      {
        tempId: 'r1',
        causeEventTempId: 'm1',
        effectEventTempId: 'm2',
        weight: 0.8,
        confidence: 0.9,
        reasoning: 'the treaty led to the war',
        source,
        selected: true,
      },
    ];

    const merged = mergeExtractionResults(pattern, model);

    // The pattern copy won the first event, so the relationship has to name it
    // by the id the merged result gives it.
    expect(merged.events.map((entry) => entry.tempId)).toContain('p1');
    expect(merged.relationships[0].causeEventTempId).toBe('p1');
    expect(merged.relationships[0].effectEventTempId).toBe('m2');
  });

  it('does not write the same event twice when the model is concise', () => {
    // The model writes a short description of the sentence the patterns
    // quote. The two readings describe one event, so the merge has to leave
    // one event behind.
    const pattern = result([
      event({
        tempId: 'p1',
        description: 'On 4 July 1776, the Continental Congress adopted the Declaration of Independence.',
        actor: 'Continental Congress',
        target: 'Declaration of Independence',
        timestamp: '1776-07-04T00:00:00Z',
        confidence: 0.9,
      }),
    ]);
    const model = result([
      event({
        tempId: 'm1',
        description: 'Adoption of the Declaration of Independence',
        actor: 'Continental Congress',
        target: 'Declaration of Independence',
        timestamp: '1776-07-04T00:00:00Z',
        confidence: 0.6,
      }),
    ]);

    const merged = mergeExtractionResults(pattern, model);

    expect(merged.events).toHaveLength(1);
    expect(merged.events[0].confidence).toBe(0.9);
  });

  it('keeps the relationships of the model pointing at the event that survived', () => {
    // One sentence can hold two dates, and the two pattern events it yields
    // both match the same event of the model. The one with the higher
    // confidence wins, and the relationship of the model has to name it: the
    // event it replaced is not in the merged result any more.
    const pattern = result([
      event({
        tempId: 'p1',
        description: 'On 4 July 1776, the Continental Congress adopted the Declaration of Independence.',
        actor: 'Continental Congress',
        target: 'Declaration of Independence',
        timestamp: '1776-07-01T00:00:00Z',
        confidence: 0.8,
      }),
      event({
        tempId: 'p2',
        description: 'On 4 July 1776, the Continental Congress adopted the Declaration of Independence.',
        actor: 'Continental Congress',
        target: 'Declaration of Independence',
        timestamp: '1776-07-04T00:00:00Z',
        confidence: 0.9,
      }),
    ]);
    const model = result([
      event({
        tempId: 'm1',
        description: 'Adoption of the Declaration of Independence',
        actor: 'Continental Congress',
        target: 'Declaration of Independence',
        timestamp: '1776-07-04T00:00:00Z',
        confidence: 0.6,
      }),
      event({
        tempId: 'm2',
        description: 'The war that followed reshaped the colonies',
        actor: 'Great Britain',
        target: 'France',
        timestamp: '1776-08-01T00:00:00Z',
        confidence: 0.6,
      }),
    ]);
    model.relationships = [
      {
        tempId: 'r1',
        causeEventTempId: 'm1',
        effectEventTempId: 'm2',
        weight: 0.8,
        confidence: 0.9,
        reasoning: 'the adoption led to the war',
        source,
        selected: true,
      },
    ];

    const merged = mergeExtractionResults(pattern, model);

    // Two events: the copy of the adoption that won, and the one of the
    // model that the patterns did not read.
    expect(merged.events).toHaveLength(2);
    expect(merged.events[0].tempId).toBe('p2');
    // The relationship names the event that is really there.
    expect(merged.relationships[0].causeEventTempId).toBe('p2');
    expect(merged.relationships[0].effectEventTempId).toBe('m2');
  });

  it('falls back to the pattern reading when no model answered', () => {
    const pattern = result([event({ tempId: 'p1', description: 'Something happened in 1763.' })]);
    expect(mergeExtractionResults(pattern, null)).toBe(pattern);
  });

  it('writes one event when the patterns read a sentence and the model summarises it', async () => {
    // The real reading of the sentence: the patterns quote it whole, and the
    // model answers with a concise description of the same event. This is
    // what the default ingestion does, and it must not write the event
    // twice.
    const sentence =
      'On 4 July 1776, the Continental Congress adopted the Declaration of Independence.';
    const extractor = new TextExtractor({ llmClient: null });
    const pattern = await extractor.extract({ text: sentence, useLLM: false });

    expect(pattern.events).toHaveLength(1);
    expect(pattern.events[0].actor).toBe('Continental Congress');
    expect(pattern.events[0].target).toBe('Declaration of Independence');

    const model = result([
      event({
        tempId: 'm1',
        description: 'Adoption of the Declaration of Independence',
        actor: 'Continental Congress',
        target: 'Declaration of Independence',
        timestamp: '1776-07-04T00:00:00Z',
        confidence: 0.85,
      }),
    ]);

    const merged = mergeExtractionResults(pattern, model);

    expect(merged.events).toHaveLength(1);
  });
});
