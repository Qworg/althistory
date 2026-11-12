/**
 * Reading a timestamp an agent or a person gives the CLI or an MCP tool.
 *
 * Both engines read it here, before anything is sent or stored, so direct
 * and remote mode take and refuse the same text: ISO 8601 in any spelling
 * (`readTimestamp`: a zone-less time is UTC, "1871-03" is a month), sent on
 * as toISOString's spelling; prose ("Feb 14 1870") is refused rather than
 * guessed at in the host's zone.
 */

import { readTimestamp } from '@althistory/calendar';
import { ValidationErrorCLI } from './exitCodes';

export interface AgentTimestamp {
  /** toISOString's spelling, which every reader reads as the same instant. */
  iso: string;
  /** How much the text stated: a month or a year alone is stored as its first day with this noted. */
  precision: 'day' | 'month' | 'year';
}

export function readAgentTimestamp(text: string): AgentTimestamp {
  const read = readTimestamp(String(text));
  if (!read) {
    throw new ValidationErrorCLI(
      `Invalid timestamp: ${text}. Give an ISO 8601 date, such as 1843-11-20, 1843-11-20T14:30 (UTC) or 1871-03`
    );
  }
  return read;
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
