/**
 * OpenAI client built on the official `openai` SDK (spec Req 10.1).
 *
 * The SDK performs the HTTP call; response parsing goes through the shared
 * helpers in `LLMClient.ts`. Tests mock the SDK module, so no test needs a real
 * key or network.
 */

import OpenAI from 'openai';
import { ExtractedEvent, ExtractedRelationship, ExtractionContext, ExtractionSource } from '../ingestion/types';
import {
  LLMClient,
  coerceJsonPayload,
  parseDescriptionPayload,
  parseExtractedEvents,
  parseRelationshipPayload,
} from './LLMClient';
import { buildDescriptionPrompt, buildEventExtractionPrompt, buildRelationshipPrompt } from './prompts';

export interface OpenAIClientConfig {
  apiKey: string;
  model?: string;
  baseUrl?: string;
  maxTokens?: number;
  temperature?: number;
  timeoutMs?: number;
  now?: () => Date;
}

const DEFAULT_MODEL = 'gpt-4o-mini';

export class OpenAIClient implements LLMClient {
  readonly provider = 'openai';
  private readonly client: OpenAI;
  private readonly model: string;
  private readonly maxTokens: number;
  private readonly temperature: number;
  private readonly now: () => Date;

  constructor(config: OpenAIClientConfig) {
    this.client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseUrl,
      timeout: config.timeoutMs ?? 30000,
      maxRetries: 0,
    });
    this.model = config.model ?? DEFAULT_MODEL;
    this.maxTokens = config.maxTokens ?? 2000;
    this.temperature = config.temperature ?? 0;
    this.now = config.now ?? (() => new Date());
  }

  private async chat(systemPrompt: string, userPrompt: string): Promise<string> {
    const completion = await this.client.chat.completions.create({
      model: this.model,
      max_tokens: this.maxTokens,
      temperature: this.temperature,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    });

    const content = completion.choices[0]?.message?.content;
    if (!content) {
      throw new Error('OpenAI response did not contain message content');
    }
    return content;
  }

  private source(): ExtractionSource {
    return { type: 'llm', extractedAt: this.now().toISOString() };
  }

  async extractEvents(text: string, context?: ExtractionContext): Promise<ExtractedEvent[]> {
    const prompt = buildEventExtractionPrompt(text, context);
    const content = await this.chat(prompt.systemPrompt, prompt.userPrompt);
    return parseExtractedEvents(coerceJsonPayload(content), this.source());
  }

  async suggestRelationships(events: ExtractedEvent[]): Promise<ExtractedRelationship[]> {
    if (events.length === 0) return [];
    const prompt = buildRelationshipPrompt(events);
    const content = await this.chat(prompt.systemPrompt, prompt.userPrompt);
    const parsed = parseRelationshipPayload(coerceJsonPayload(content));
    return parsed
      .filter((rel) => rel.causeIndex >= 0 && rel.causeIndex < events.length)
      .filter((rel) => rel.effectIndex >= 0 && rel.effectIndex < events.length)
      .map((rel) => ({
        tempId: `llm-rel-${rel.causeIndex}-${rel.effectIndex}`,
        causeEventTempId: events[rel.causeIndex].tempId,
        effectEventTempId: events[rel.effectIndex].tempId,
        weight: rel.weight,
        confidence: rel.confidence,
        reasoning: rel.reasoning,
        source: this.source(),
        selected: true,
      }));
  }

  async enrichDescription(event: ExtractedEvent): Promise<string> {
    const prompt = buildDescriptionPrompt(event);
    const content = await this.chat(prompt.systemPrompt, prompt.userPrompt);
    return parseDescriptionPayload(coerceJsonPayload(content));
  }
}
