/**
 * Ingesting text into a world graph in direct mode (`althistory ingest text`,
 * MCP `althistory_ingest_text`) keeps what the server's ingestion keeps: a
 * month or a year the model gave, and the calendar it gave it in (Req 16).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { formatInWorld, readWorldTimestamp, type WorldCalendarSet } from '@althistory/calendar';
import type { LLMClient } from '../services/llm/LLMClient';
import { DirectEngine } from './engine/DirectEngine';

const stub = vi.hoisted(() => ({ model: undefined as unknown }));
vi.mock('@/services/llm', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/llm')>()),
  createLLMClient: () => stub.model,
}));

const VAEL: WorldCalendarSet = {
  version: 2,
  dayLength: 30 * 3600,
  primary: 'reckoning',
  calendars: [
    {
      id: 'reckoning',
      name: 'the Reckoning of the Rising',
      parts: ['Lowtide', 'Greywater', 'Thaw', 'Seedtide'].map((name) => ({ name, days: 30 })),
      epoch: 0,
      eras: [{ label: 'AR', from: 1 }],
    },
    { id: 'tide', name: 'the Tide-count', parts: [{ name: 'Ebbing', days: 60 }, { name: 'Flooding', days: 60 }], epoch: -10, eras: [{ label: 'TC', from: 1 }] },
  ],
};

const model: LLMClient = {
  provider: 'mock-llm',
  extractEvents: vi.fn(async () =>
    ['Thaw 300 AR', 'Flooding 290 TC', '301 AR'].map((text, index) => {
      const date = readWorldTimestamp(VAEL, text)!;
      return {
        tempId: `e${index}`,
        description: `The council meets, ${index}`,
        actor: 'Council',
        target: 'Realm',
        timestamp: date.iso,
        datePrecision: date.precision,
        ...(date.calendar ? { dateCalendar: date.calendar } : {}),
        confidence: 0.9,
        source: { type: 'llm' as const, extractedAt: new Date().toISOString() },
        selected: true,
        edited: false,
      };
    })
  ),
  suggestRelationships: vi.fn(async () => []),
  enrichDescription: vi.fn(async () => ''),
};

stub.model = model;

describe('direct ingestion into a world graph', () => {
  const engine = new DirectEngine();
  const created: string[] = [];

  afterEach(async () => {
    for (const id of created.splice(0)) await engine.deleteGraph(id).catch(() => undefined);
    await engine.shutdown();
  });

  it("stores each date at the precision and in the calendar the model gave it", async () => {
    const graph = await engine.createGraph('Vael', undefined, VAEL as never);
    created.push(graph.id);
    const result = await engine.ingestText(graph.id, 'The council of Vael met thrice.', { mode: 'llm', dryRun: false });
    // What the tool answers carries each date's precision and calendar too.
    expect(result.entities.events.map((event) => event.metadata?.datePrecision).sort()).toEqual(['month', 'month', 'year']);
    const events = await engine.listEvents(graph.id);
    const shown = events
      .map((event) => formatInWorld(VAEL, Date.parse(event.timestamp), event.metadata?.datePrecision as never, event.metadata?.dateCalendar as never))
      .sort();
    expect(shown).toEqual(['301 AR', 'Flooding 290 TC', 'Thaw 300 AR'].sort());
  });
});
