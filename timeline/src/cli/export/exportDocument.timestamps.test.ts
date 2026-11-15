import { describe, it, expect } from 'vitest';
import { parseExportDocument } from './exportDocument';

/**
 * The CLI renders an export (markdown, dot, graphml) from the document the
 * server sends, which holds times as they were stored: graphs imported
 * before the import stored toISOString's spelling may hold others. Events and
 * arcs are read with the one reader the server uses, so they agree.
 */
describe('times in an export document the CLI renders', () => {
  const document = (eventTime: string, arcStart: string, arcEnd: string) => ({
    data: {
      events: [{ id: 'e1', description: 'E', actor: 'A', target: 'B', timestamp: eventTime }],
      arcs: [{ id: 'a1', name: 'Age', start_time: arcStart, end_time: arcEnd, level: 0 }],
    },
  });

  it('reads zone-less times as UTC in events and arcs alike, so an event stays inside its arc', () => {
    const parsed = parseExportDocument(document('1870-02-14T09:30', '1870-02-14T09:30', '1870-02-15'));
    expect(parsed.events[0]!.timestamp.toISOString()).toBe('1870-02-14T09:30:00.000Z');
    expect(parsed.arcs[0]!.start_time.toISOString()).toBe('1870-02-14T09:30:00.000Z');
  });

  it('keeps an event and an arc whose times use an offset without minutes or a decimal comma', () => {
    const parsed = parseExportDocument(document('1066-10-14T09:30+05', '1066-01-01T00:00:00,5Z', '1066-12-31T12:00+05'));
    expect(parsed.events[0]!.timestamp.toISOString()).toBe('1066-10-14T04:30:00.000Z');
    expect(parsed.arcs).toHaveLength(1);
    expect(parsed.arcs[0]!.end_time.toISOString()).toBe('1066-12-31T07:00:00.000Z');
  });
});
