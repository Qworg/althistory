import type { WorldCalendarSet } from '@althistory/calendar';
import { withAxisTimes, withWorldDates } from '../mcp/worldDates';
import { OutputFormat } from '../types';
import { formatSuccessJson } from './jsonFormatter';
import { formatNdjson } from './ndjsonFormatter';
import { formatPlain } from './plainFormatter';

export * from './jsonFormatter';
export * from './ndjsonFormatter';
export * from './plainFormatter';

export function formatOutput<T>(
  data: T,
  format: OutputFormat,
  mode: 'direct' | 'remote',
  meta?: { durationMs?: number; graphId?: string; calendar?: WorldCalendarSet }
): string {
  // In a world, each date is shown as the world writes it beside its timestamp (Req 18), as the MCP tools show it.
  if (meta?.calendar) data = withWorldDates(data, meta.calendar) as T;
  // Each moment also as exact milliseconds on the axis (a decimal string).
  data = withAxisTimes(data) as T;
  const { calendar: _calendar, ...jsonMeta } = meta ?? {};
  meta = meta ? jsonMeta : undefined;
  switch (format) {
    case 'ndjson':
      return Array.isArray(data) ? formatNdjson(data) : formatNdjson([data]);
    case 'json':
      return formatSuccessJson(data, mode, meta);
    case 'plain':
      return formatPlain(data);
    case 'markdown':
      if (typeof data === 'string') return data;
      return formatPlain(data);
    default:
      return formatSuccessJson(data, mode, meta);
  }
}
