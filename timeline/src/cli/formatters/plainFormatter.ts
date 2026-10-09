/**
 * Simple table/plain formatter for human developer CLI use.
 */
export function formatPlain(data: unknown): string {
  if (data === null || data === undefined) {
    return 'None';
  }

  if (typeof data === 'string' || typeof data === 'number' || typeof data === 'boolean') {
    return String(data);
  }

  if (Array.isArray(data)) {
    if (data.length === 0) return '[] (empty)';
    // If array of objects with id/name or id/desc
    const sample = data[0];
    if (typeof sample === 'object' && sample !== null) {
      return data
        .map((item, idx) => {
          const id = item.id || `#${idx + 1}`;
          const name = item.name || item.description || item.status || '';
          const extra = item.timestamp ? ` [${item.timestamp}]` : '';
          return `${id}: ${name}${extra}`;
        })
        .join('\n');
    }
    return data.join('\n');
  }

  if (typeof data === 'object') {
    const lines: string[] = [];
    for (const [k, v] of Object.entries(data as Record<string, unknown>)) {
      if (typeof v === 'object' && v !== null) {
        lines.push(`${k}: ${JSON.stringify(v)}`);
      } else {
        lines.push(`${k}: ${v}`);
      }
    }
    return lines.join('\n');
  }

  return JSON.stringify(data, null, 2);
}
