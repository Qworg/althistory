/**
 * LLM client contract and shared response parsing (spec Req 10).
 *
 * Provider implementations (`OpenAIClient`, `AnthropicClient`) only translate
 * request/response shapes; the parsing of the model's JSON payload to
 * {@link ExtractedEvent}s lives here so both providers share one validator.
 */

import { ExtractedEvent, ExtractedRelationship, ExtractionContext, ExtractionSource } from '../ingestion/types';
import { JsonValue, parseJsonBody } from '../ingestion/http';
import { newTempId } from '../ingestion/ids';

export interface LLMConfig {
  enabled: boolean;
  provider: 'openai' | 'anthropic' | 'none';
  model?: string;
  maxTokens?: number;
  temperature?: number;
  timeout?: number;
}

export interface LLMClient {
  readonly provider: string;

  extractEvents(text: string, context?: ExtractionContext): Promise<ExtractedEvent[]>;
  suggestRelationships(events: ExtractedEvent[]): Promise<ExtractedRelationship[]>;
  enrichDescription(event: ExtractedEvent): Promise<string>;
}

/** Raised when a model response cannot be parsed into extractable entities. */
export class LLMResponseParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LLMResponseParseError';
  }
}

function isJsonObject(value: JsonValue): value is { [key: string]: JsonValue } {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Strip a leading/trailing markdown code fence from model text. */
export function stripCodeFence(text: string): string {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced ? fenced[1].trim() : trimmed;
}

/** Parse a JSON payload that may be a raw string, or an already-parsed value. */
export function coerceJsonPayload(payload: string | JsonValue): JsonValue {
  if (typeof payload === 'string') {
    return parseJsonBody(stripCodeFence(payload), 'LLM response');
  }
  return payload;
}

function asNumber(value: JsonValue | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function asString(value: JsonValue | undefined): string {
  return typeof value === 'string' ? value : '';
}

function isValidTimestamp(value: string): boolean {
  return value.length > 0 && !Number.isNaN(Date.parse(value));
}

/** Items may be under `events` or the payload may be the array itself. */
function extractItems(payload: JsonValue, key: string): JsonValue[] {
  if (Array.isArray(payload)) return payload;
  if (isJsonObject(payload) && Array.isArray(payload[key])) return payload[key];
  throw new LLMResponseParseError(`LLM response did not contain a "${key}" array`);
}

/**
 * Convert a model's event JSON into {@link ExtractedEvent}s.
 *
 * Entries missing a description or a parseable timestamp are dropped rather
 * than coerced: an entity that `ImportService` would reject is worse than
 * returning fewer. A caller can compare counts to detect that.
 */
export function parseExtractedEvents(
  payload: JsonValue,
  source: ExtractionSource
): ExtractedEvent[] {
  const items = extractItems(payload, 'events');
  const events: ExtractedEvent[] = [];

  for (const item of items) {
    if (!isJsonObject(item)) continue;

    const description = asString(item.description).trim();
    const timestamp = asString(item.timestamp).trim();
    if (!description || !isValidTimestamp(timestamp)) continue;

    events.push({
      tempId: newTempId('llm'),
      description,
      actor: asString(item.actor).trim(),
      target: asString(item.target).trim(),
      timestamp,
      confidence: Math.max(0, Math.min(1, asNumber(item.confidence, 0.5))),
      source,
      selected: true,
      edited: false,
    });
  }

  return events;
}

export interface ParsedRelationship {
  causeIndex: number;
  effectIndex: number;
  weight: number;
  confidence: number;
  reasoning: string;
}

/** Convert a model's relationship JSON. `cause`/`effect` are event indices. */
export function parseRelationshipPayload(payload: JsonValue): ParsedRelationship[] {
  const items = extractItems(payload, 'relationships');
  const relationships: ParsedRelationship[] = [];

  for (const item of items) {
    if (!isJsonObject(item)) continue;
    const cause = item.cause;
    const effect = item.effect;
    if (typeof cause !== 'number' || typeof effect !== 'number') continue;
    relationships.push({
      causeIndex: cause,
      effectIndex: effect,
      weight: Math.max(0, Math.min(1, asNumber(item.weight, 0.5))),
      confidence: Math.max(0, Math.min(1, asNumber(item.confidence, 0.5))),
      reasoning: asString(item.reasoning),
    });
  }

  return relationships;
}

/** Parse a model response that returns a plain string (description enrichment). */
export function parseDescriptionPayload(payload: JsonValue): string {
  if (typeof payload === 'string') return payload.trim();
  if (isJsonObject(payload) && typeof payload.description === 'string') {
    return payload.description.trim();
  }
  throw new LLMResponseParseError('LLM response did not contain a description');
}
