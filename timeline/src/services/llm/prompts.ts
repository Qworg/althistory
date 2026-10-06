/**
 * Prompt builders and JSON schema for LLM-assisted extraction (spec Req 10.2).
 */

import { ExtractedEvent, ExtractionContext } from '../ingestion/types';

export interface LLMExtractionPrompt {
  systemPrompt: string;
  userPrompt: string;
  responseFormat: 'json' | 'text';
  schema?: Record<string, unknown>;
}

/** JSON schema for the event-extraction response. */
export const EXTRACTION_RESPONSE_SCHEMA: Record<string, unknown> = {
  type: 'object',
  required: ['events'],
  properties: {
    events: {
      type: 'array',
      items: {
        type: 'object',
        required: ['description', 'timestamp'],
        properties: {
          description: { type: 'string' },
          actor: { type: 'string' },
          target: { type: 'string' },
          timestamp: { type: 'string', description: 'ISO-8601 timestamp' },
          confidence: { type: 'number', minimum: 0, maximum: 1 },
        },
      },
    },
  },
};

const RELATIONSHIP_RESPONSE_SCHEMA: Record<string, unknown> = {
  type: 'object',
  required: ['relationships'],
  properties: {
    relationships: {
      type: 'array',
      items: {
        type: 'object',
        required: ['cause', 'effect'],
        properties: {
          cause: { type: 'number', description: '0-based index of the cause event' },
          effect: { type: 'number', description: '0-based index of the effect event' },
          weight: { type: 'number', minimum: 0, maximum: 1 },
          confidence: { type: 'number', minimum: 0, maximum: 1 },
          reasoning: { type: 'string' },
        },
      },
    },
  },
};

function contextLines(context?: ExtractionContext): string {
  if (!context) return '';
  const lines: string[] = [];
  if (context.defaultTimeRange) {
    lines.push(`Default time range: ${context.defaultTimeRange.start} to ${context.defaultTimeRange.end}`);
  }
  if (context.defaultActors?.length) {
    lines.push(`Known actors: ${context.defaultActors.join(', ')}`);
  }
  if (context.knownEntities?.length) {
    lines.push(`Known entities: ${context.knownEntities.join(', ')}`);
  }
  if (context.locale) {
    lines.push(`Locale: ${context.locale}`);
  }
  if (context.instructions) {
    lines.push(`Additional instructions: ${context.instructions}`);
  }
  return lines.join('\n');
}

export function buildEventExtractionPrompt(
  text: string,
  context?: ExtractionContext
): LLMExtractionPrompt {
  const contextSection = contextLines(context);
  return {
    systemPrompt:
      'You extract historical events from text. Return only JSON matching the schema. ' +
      'Every event must have a concise description and an ISO-8601 timestamp. ' +
      'Use the actor as the entity performing the action and the target as the entity affected. ' +
      'If a field is not stated, use an empty string rather than inventing a value. ' +
      'Set confidence between 0 and 1 reflecting how explicit the source text is.',
    userPrompt:
      `${contextSection ? `Context:\n${contextSection}\n\n` : ''}Extract events from the following text:\n\n${text}`,
    responseFormat: 'json',
    schema: EXTRACTION_RESPONSE_SCHEMA,
  };
}

export function buildRelationshipPrompt(
  events: ExtractedEvent[],
  context?: ExtractionContext
): LLMExtractionPrompt {
  const indexed = events.map((event, index) => `${index}: ${event.description} (${event.timestamp})`).join('\n');
  const contextSection = contextLines(context);
  return {
    systemPrompt:
      'You identify causal relationships between historical events. ' +
      'Return only JSON matching the schema. Refer to events by their numeric index. ' +
      'Only report a relationship when the supplied text or commonly accepted history supports it.',
    userPrompt:
      `${contextSection ? `Context:\n${contextSection}\n\n` : ''}Events:\n${indexed}\n\nReturn causal links between these events.`,
    responseFormat: 'json',
    schema: RELATIONSHIP_RESPONSE_SCHEMA,
  };
}

export function buildDescriptionPrompt(event: ExtractedEvent): LLMExtractionPrompt {
  return {
    systemPrompt:
      'Rewrite the historical event description to be clear and specific. ' +
      'Return only JSON of the form {"description": "..."}. Do not add facts not present in the input.',
    userPrompt: `Description: ${event.description}\nActor: ${event.actor}\nTarget: ${event.target}\nTimestamp: ${event.timestamp}`,
    responseFormat: 'json',
    schema: {
      type: 'object',
      required: ['description'],
      properties: { description: { type: 'string' } },
    },
  };
}
