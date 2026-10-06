/**
 * Anthropic client built on the official `@anthropic-ai/sdk` (spec Req 10.1).
 *
 * Anthropic has no `response_format` flag, so the prompt asks for JSON and the
 * shared parser strips any markdown fence. Tests mock the SDK module, so no
 * test needs a real key or network.
 */

import Anthropic from '@anthropic-ai/sdk';
import { ExtractedEvent, ExtractedRelationship, ExtractionContext, ExtractionSource } from '../ingestion/types';
import {
  LLMClient,
  coerceJsonPayload,
  parseDescriptionPayload,
  parseExtractedEvents,
  parseRelationshipPayload,
} from './LLMClient';
import { buildDescriptionPrompt, buildEventExtractionPrompt, buildRelationshipPrompt } from './prompts';

export interface AnthropicClientConfig {
  apiKey: string;
  model?: string;
  baseUrl?: string;
  maxTokens?: number;
  temperature?: number;
  timeoutMs?: number;
  now?: () => Date;
}

const DEFAULT_MODEL = 'claude-3-5-haiku-latest';

export class AnthropicClient implements LLMClient {
  readonly provider = 'anthropic';
  private readonly client: Anthropic;
  private readonly model: string;
  private readonly maxTokens: number;
  private readonly temperature: number;
  private readonly now: () => Date;

  constructor(config: AnthropicClientConfig) {
    this.client = new Anthropic({
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

  private async message(systemPrompt: string, userPrompt: string): Promise<string> {
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: this.maxTokens,
      temperature: this.temperature,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });

    const content = response.content
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('');

    if (!content) {
      throw new Error('Anthropic response did not contain message content');
    }
    return content;
  }

  private source(): ExtractionSource {
    return { type: 'llm', extractedAt: this.now().toISOString() };
  }

  async extractEvents(text: string, context?: ExtractionContext): Promise<ExtractedEvent[]> {
    const prompt = buildEventExtractionPrompt(text, context);
    const content = await this.message(prompt.systemPrompt, prompt.userPrompt);
    return parseExtractedEvents(coerceJsonPayload(content), this.source());
  }

  async suggestRelationships(events: ExtractedEvent[]): Promise<ExtractedRelationship[]> {
    if (events.length === 0) return [];
    const prompt = buildRelationshipPrompt(events);
    const content = await this.message(prompt.systemPrompt, prompt.userPrompt);
    const parsed = parseRelationshipPayload(coerceJsonPayload(content));
    return parsed
      .filter((rel) => rel.causeIndex >= 0 && rel.causeIndex < events.length)
      .filter((rel) => rel.effectIndex >= 0 && rel.effectIndex < events.length)
      .map((rel) => ({
        tempId: `anthropic-rel-${rel.causeIndex}-${rel.effectIndex}`,
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
    const content = await this.message(prompt.systemPrompt, prompt.userPrompt);
    return parseDescriptionPayload(coerceJsonPayload(content));
  }
}
