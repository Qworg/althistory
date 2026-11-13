/**
 * Prompt builders and JSON schema for LLM-assisted extraction (spec Req 10.2).
 */

import { type WorldCalendarSet, formatInWorld, readWorldTimestamp } from '@althistory/calendar';
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
    // In a world, as the world writes dates: an ISO date here would contradict
    // the instruction never to write one.
    // Read by the rule every door applies; text it cannot read is shown as written.
    const { start, end } = context.defaultTimeRange;
    const shown = (value: string, edge: 'start' | 'end') => {
      if (!context.calendar) return value;
      const read = readWorldTimestamp(context.calendar, String(value), edge);
      return read ? formatInWorld(context.calendar, Date.parse(read.iso), read.precision, read.calendar) : value;
    };
    lines.push(`Default time range: ${shown(start, 'start')} to ${shown(end, 'end')}`);
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

/**
 * How the model writes a date: ISO 8601, or for a graph with world calendars
 * the world's own notation, which the server reads with them (docs/specs/
 * world-calendars.md, Req 16, 18). Never both: an ISO date given for a world
 * date would be read as a Gregorian day thousands of years away.
 */
function timestampRule(calendar: WorldCalendarSet | undefined): string {
  return calendar
    ? "a timestamp written as the world writes a date (the calendar is described in the context), never converted to an ISO date"
    : 'an ISO-8601 timestamp (a year before 0000 or after 9999 is written with a sign and six digits, as +300000-01-01 or -500000-03-15, and a history may run for hundreds of thousands of years)';
}

/** The extraction schema, its timestamp described as `timestampRule` says. */
export function extractionResponseSchema(calendar?: WorldCalendarSet): Record<string, unknown> {
  if (!calendar) return EXTRACTION_RESPONSE_SCHEMA;
  const events = (EXTRACTION_RESPONSE_SCHEMA.properties as Record<string, Record<string, unknown>>).events!;
  const item = events.items as { properties: Record<string, unknown> } & Record<string, unknown>;
  return {
    ...EXTRACTION_RESPONSE_SCHEMA,
    properties: {
      events: {
        ...events,
        items: {
          ...item,
          properties: { ...item.properties, timestamp: { type: 'string', description: "The date in the world's own notation" } },
        },
      },
    },
  };
}

export function buildEventExtractionPrompt(
  text: string,
  context?: ExtractionContext
): LLMExtractionPrompt {
  const contextSection = contextLines(context);
  return {
    systemPrompt:
      'You extract historical events from text. Return only JSON matching the schema. ' +
      `Every event must have a concise description and ${timestampRule(context?.calendar)}. ` +
      'Use the actor as the entity performing the action and the target as the entity affected. ' +
      'If a field is not stated, use an empty string rather than inventing a value. ' +
      'Set confidence between 0 and 1 reflecting how explicit the source text is.',
    userPrompt:
      `${contextSection ? `Context:\n${contextSection}\n\n` : ''}Extract events from the following text:\n\n${text}`,
    responseFormat: 'json',
    schema: extractionResponseSchema(context?.calendar),
  };
}

export function buildRelationshipPrompt(
  events: ExtractedEvent[],
  context?: ExtractionContext
): LLMExtractionPrompt {
  // Each event's date as the graph writes it: in a world, its own notation at
  // the precision it was given, not the ISO instant it is stored as.
  const calendar = context?.calendar;
  const when = (event: ExtractedEvent) =>
    calendar
      ? formatInWorld(calendar, Date.parse(event.timestamp), event.datePrecision ?? 'day', event.dateCalendar)
      : event.timestamp;
  const indexed = events.map((event, index) => `${index}: ${event.description} (${when(event)})`).join('\n');
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
