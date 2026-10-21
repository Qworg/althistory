/**
 * Text extractor (spec Req 9).
 *
 * Pattern-based extraction always works offline. When an {@link LLMClient} is
 * configured and `useLLM` is not disabled, the LLM is tried first; any failure
 * falls back to the pattern path (spec Req 10.3). The resulting entities carry
 * their provenance, so a reviewer can tell AI-generated rows from pattern ones
 * (spec Req 10.4).
 *
 * On the LLM path the extractor also asks the model for causal relationships
 * between the events it just returned (`suggestRelationships`), which is the
 * only way an extraction acquires relationships today; no source produces arcs.
 * Relationship suggestion is best-effort: when the call fails or returns links
 * pointing outside the event set, the events are still returned.
 *
 * `enrichDescription` is deliberately NOT called from here or from anywhere
 * else in production code yet. See the disclosure in `./index.ts`.
 *
 * Selection rule, on both paths: an entity whose actor or target is empty is
 * emitted with `selected: false`. `validateExtraction` and `ImportService` both
 * treat an empty actor or target as an error, and the approval default imports
 * the `selected` rows, so marking such a row selected would make a default
 * approve fail on a row the reviewer never chose. The row is still shown, so the
 * reviewer can fill the field and select it.
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
  ExtractedRelationship,
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
      const llmResult = await this.extractWithLLM(input, context);
      if (llmResult) {
        return llmResult;
      }
    }

    return this.extractWithPatterns(input.text, context);
  }

  /**
   * Extract with the language model only.
   *
   * Returns `null` when no model is configured, when the call fails, or when
   * the model returned nothing. A caller that wants to know whether the model
   * was actually used -- the CLI's `hybrid` mode merges the two paths, and its
   * `llm` mode refuses to pretend a pattern extraction was a model extraction
   * -- needs that difference, which {@link extract} does not expose.
   */
  async extractWithLLM(
    input: TextExtractionInput,
    context?: ExtractionContext
  ): Promise<ExtractionResult | null> {
    if (!this.llmClient) return null;
    try {
      const events = await this.llmClient.extractEvents(input.text, context);
      if (events.length === 0) return null;
      return this.toResult(events, 'llm', await this.suggestRelationships(events));
    } catch {
      return null;
    }
  }

  /**
   * Ask the configured model for causal links between the extracted events.
   *
   * Best-effort by design: a failure (or a link naming an event outside `events`)
   * must not lose the events, so it returns no relationships rather than
   * failing the extraction. Fewer than two events cannot have a causal link, so
   * that case skips the provider call entirely.
   */
  private async suggestRelationships(events: ExtractedEvent[]): Promise<ExtractedRelationship[]> {
    if (!this.llmClient || events.length < 2) return [];
    try {
      const suggested = await this.llmClient.suggestRelationships(events);
      const eventIds = new Set(events.map((event) => event.tempId));
      return suggested.filter(
        (relationship) =>
          eventIds.has(relationship.causeEventTempId) &&
          eventIds.has(relationship.effectEventTempId)
      );
    } catch {
      return [];
    }
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
      // With a single named entity there is nothing to point the target at, so
      // it repeats the actor; `validateExtraction` only requires that it is not
      // empty. With no named entity at all both stay empty and the row is left
      // unselected (see the class comment).
      const target = entities.find((entity) => entity !== actor) ?? actor;
      const selected = actor.length > 0 && target.length > 0;

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
          selected,
          edited: false,
        });
      }
    }

    return this.toResult(events, 'text', []);
  }

  private toResult(
    events: ExtractedEvent[],
    origin: 'text' | 'llm',
    relationships: ExtractedRelationship[]
  ): ExtractionResult {
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
      relationships,
      sources: events.length > 0 ? [source] : [],
      overallConfidence: averageConfidence(events),
    };
  }
}
