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
  meta?: { durationMs?: number; graphId?: string }
): string {
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
