/**
 * Reading a timestamp an agent or a person gives the CLI or an MCP tool.
 *
 * Both engines read it here, before anything is sent or stored, so direct
 * and remote mode take and refuse the same text: ISO 8601 in any spelling
 * (`readTimestamp`: a zone-less time is UTC, "1871-03" is a month), sent on
 * as toISOString's spelling; prose ("Feb 14 1870") is refused rather than
 * guessed at in the host's zone.
 */

import {
  type WorldCalendarSet,
  calendarIn,
  datePrecisionMetadata,
  formatInWorld,
  parseIsoInstant,
  readWorldTimestamp,
  unreadDateReason,
  withDatePrecision,
} from '@althistory/calendar';
import { ValidationErrorCLI } from './exitCodes';

export interface AgentTimestamp {
  /** toISOString's spelling, which every reader reads as the same instant. */
  iso: string;
  /** How much the text stated: a month or a year alone is stored as its first day with this noted. */
  precision: 'day' | 'month' | 'year';
  /** The world calendar it was written in, when it was. */
  calendar?: string;
}

/** Whether text is ISO 8601, which needs no calendar to read. */
export function isIsoText(text: string): boolean {
  return parseIsoInstant(String(text).trim()) !== null;
}

/**
 * Whether reading the text needs the graph's calendars: anything but an ISO
 * date or date and time does (a world's notation, and an ISO month or year,
 * which a world refuses).
 */
export function needsCalendar(text: string): boolean {
  const iso = parseIsoInstant(String(text).trim());
  return iso === null || iso.precision === 'month' || iso.precision === 'year';
}

/**
 * An agent's timestamp: ISO 8601, or in a graph with world calendars a date
 * in the world's notation ("Thaw 4, 312 AR", "Thaw 312 AR"). With `edge:
 * 'end'`, a world date without a time is the last moment of the day, month
 * or year it names (an arc's end); ISO text is the instant it names.
 */
export function readAgentTimestamp(text: string, calendar?: WorldCalendarSet, edge: 'start' | 'end' = 'start'): AgentTimestamp {
  // As an end, a world date without a time is the last moment of what it names (the package's rule).
  const read = readWorldTimestamp(calendar, String(text), edge);
  if (!read) {
    if (calendar) {
      throw new ValidationErrorCLI(`Invalid timestamp: ${unreadDateReason(calendar, String(text))} A date in the world's calendar reads like "${worldExample(calendar)}".`);
    }
    throw new ValidationErrorCLI(
      `Invalid timestamp: ${text}. Give an ISO 8601 date, such as 1843-11-20, 1843-11-20T14:30 (UTC) or 1871-03, or a year such as 312 or 44 BCE`
    );
  }
  // Not the axis time: this is sent and stored as text, and a bigint is not JSON.
  const { time: _time, ...text_ } = read;
  return text_;
}

/** The first day of the world's year 1, written in its primary calendar's notation. */
function worldExample(calendar: WorldCalendarSet): string {
  const primary = calendarIn(calendar);
  return formatInWorld(calendar, primary.definition.epoch * primary.dayMs);
}

/** The metadata that records a month or a year given alone (and its calendar), as every door records it. */
export function precisionMetadata(read: AgentTimestamp): Record<string, unknown> {
  return datePrecisionMetadata(read);
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
  return withDatePrecision(metadata, read);
}
