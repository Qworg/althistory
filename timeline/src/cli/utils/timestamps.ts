/**
 * Reading a timestamp an agent or a person gives the CLI or an MCP tool.
 *
 * Both engines read it here, before anything is sent or stored, so direct
 * and remote mode take and refuse the same text: ISO 8601 in any spelling
 * (`readTimestamp`: a zone-less time is UTC, "1871-03" is a month), sent on
 * as toISOString's spelling; prose ("Feb 14 1870") is refused rather than
 * guessed at in the host's zone.
 */

import { type WorldCalendarSet, calendarIn, formatInWorld, parseIsoInstant, parseWorldText, readWorldTimestamp, worldPeriod } from '@althistory/calendar';
import { ValidationErrorCLI } from './exitCodes';

export interface AgentTimestamp {
  /** toISOString's spelling, which every reader reads as the same instant. */
  iso: string;
  /** How much the text stated: a month or a year alone is stored as its first day with this noted. */
  precision: 'day' | 'month' | 'year';
}

/** Whether text is ISO 8601, which needs no calendar to read. */
export function isIsoText(text: string): boolean {
  return parseIsoInstant(String(text).trim()) !== null;
}

/**
 * An agent's timestamp: ISO 8601, or in a graph with world calendars a date
 * in the world's notation ("Thaw 4, 312 AR", "Thaw 312 AR"). With `edge:
 * 'end'`, a world date at month or year precision is that period's last
 * moment (an arc's end).
 */
export function readAgentTimestamp(text: string, calendar?: WorldCalendarSet, edge: 'start' | 'end' = 'start'): AgentTimestamp {
  const read = readWorldTimestamp(calendar, String(text));
  if (!read) {
    const example = calendar ? `a date in the world's calendar, such as "${worldExample(calendar)}", or ` : '';
    throw new ValidationErrorCLI(
      `Invalid timestamp: ${text}. Give ${example}an ISO 8601 date, such as 1843-11-20, 1843-11-20T14:30 (UTC) or 1871-03`
    );
  }
  if (edge === 'end' && calendar && !isIsoText(text) && read.precision !== 'day') {
    const world = parseWorldText(calendar, String(text));
    if (world.ok) {
      const period = worldPeriod(calendarIn(calendar, world.calendar), world.fields, world.precision);
      if (period) return { iso: new Date(period.end).toISOString(), precision: read.precision };
    }
  }
  return read;
}

/** The first day of the world's year 1, written in its primary calendar's notation. */
function worldExample(calendar: WorldCalendarSet): string {
  const primary = calendarIn(calendar);
  return formatInWorld(calendar, primary.definition.epoch * primary.dayMs);
}

/** The metadata that records a month or a year given alone, as ingestion records it. */
export function precisionMetadata(read: AgentTimestamp): Record<string, unknown> {
  return read.precision === 'day' ? {} : { datePrecision: read.precision };
}

/**
 * An event's metadata once its date is replaced: the old precision goes (a
 * month that is now a day would still read "Mar 1871"), and the new text's
 * is recorded.
 */
export function withNewDatePrecision(
  metadata: Record<string, unknown> | undefined,
  read: AgentTimestamp
): Record<string, unknown> {
  const { datePrecision: _replaced, ...rest } = metadata ?? {};
  return { ...rest, ...precisionMetadata(read) };
}
