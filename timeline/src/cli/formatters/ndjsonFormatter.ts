/**
 * Formats data as Newline-Delimited JSON (NDJSON) for streaming event consumers.
 */
export function formatNdjson(items: unknown[]): string {
  if (!items || items.length === 0) {
    return '';
  }
  return items.map((item) => JSON.stringify(item)).join('\n') + '\n';
}
