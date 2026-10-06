/**
 * Text extractor (spec Req 9).
 *
 * Pattern-based extraction always works offline. When an {@link LLMClient} is
 * configured and `useLLM` is not disabled, the LLM is tried first; any failure
 * falls back to the pattern path (spec Req 10.3). The resulting entities carry
 * their provenance, so a reviewer can tell AI-generated rows from pattern ones
 * (spec Req 10.4).
 */

import { DataSource } from '../ExportService';
import { LLMClient } from '../llm/LLMClient';
import { newTempId } from './ids';
import {
  DatePrecision,
  extractCapitalizedEntities,
  extractDates,
  splitSentences,
} from './text-patterns';
import {
  ExtractedEvent,
  ExtractionContext,
  ExtractionResult,
  Extractor,
  TextExtractionInput,
} from './types';

export interface TextExtractorDeps {
  llmClient?: LLMClient | null;
  now?: () => Date;
}

const TEXT_SOURCE_TYPE = 'text-extraction';
const LLM_SOURCE_TYPE = 'llm-generated';

/** Confidence for a pattern match, from date precision and field completeness. */
export function patternConfidence(precision: DatePrecision, hasActor: boolean, hasTarget: boolean): number {
  let confidence = precision === 'day' ? 0.6 : precision === 'month' ? 0.5 : 0.4;
  if (hasActor) confidence += 0.15;
  if (hasTarget) confidence += 0.15;
  return Math.min(0.95, confidence);
}

function averageConfidence(events: ExtractedEvent[]): number {
  if (events.length === 0) return 0;
  const total = events.reduce((sum, event) => sum + event.confidence, 0);
  return total / events.length;
}

export class TextExtractor implements Extractor<TextExtractionInput> {
  readonly sourceType = 'text' as const;
  private readonly llmClient: LLMClient | null;
  private readonly now: () => Date;

  constructor(deps: TextExtractorDeps = {}) {
    this.llmClient = deps.llmClient ?? null;
    this.now = deps.now ?? (() => new Date());
  }

  async extract(input: TextExtractionInput, context?: ExtractionContext): Promise<ExtractionResult> {
    const wantsLLM = input.useLLM !== false && this.llmClient !== null;

    if (wantsLLM && this.llmClient) {
      try {
        const events = await this.llmClient.extractEvents(input.text, context);
        if (events.length > 0) {
          return this.toResult(events, 'llm');
        }
      } catch {
        // Fall through to the deterministic pattern path (spec Req 10.3).
      }
    }

    return this.extractWithPatterns(input.text, context);
  }

  private extractWithPatterns(text: string, context?: ExtractionContext): ExtractionResult {
    const extractedAt = this.now().toISOString();
    const events: ExtractedEvent[] = [];
    const seen = new Set<string>();

    for (const sentence of splitSentences(text)) {
      const dates = extractDates(sentence);
      if (dates.length === 0) continue;

      const entities = extractCapitalizedEntities(sentence);
      const defaultActor = context?.defaultActors?.[0];
      const actor = defaultActor ?? entities[0] ?? '';
      const target = entities.find((entity) => entity !== actor) ?? '';

      for (const date of dates) {
        const dedupeKey = `${sentence}\u0000${date.iso}`;
        if (seen.has(dedupeKey)) continue;
        seen.add(dedupeKey);

        events.push({
          tempId: newTempId('text'),
          description: sentence,
          actor,
          target,
          timestamp: date.iso,
          confidence: patternConfidence(date.precision, actor.length > 0, target.length > 0),
          source: { type: 'text', extractedAt },
          selected: true,
          edited: false,
        });
      }
    }

    return this.toResult(events, 'text');
  }

  private toResult(events: ExtractedEvent[], origin: 'text' | 'llm'): ExtractionResult {
    const source: DataSource = {
      id: `${origin}-source`,
      type: origin === 'llm' ? LLM_SOURCE_TYPE : TEXT_SOURCE_TYPE,
      accessedAt: this.now().toISOString(),
      confidence: averageConfidence(events),
      entityIds: events.map((event) => event.tempId),
    };

    return {
      events,
      arcs: [],
      relationships: [],
      sources: events.length > 0 ? [source] : [],
      overallConfidence: averageConfidence(events),
    };
  }
}
