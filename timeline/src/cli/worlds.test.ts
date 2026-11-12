/**
 * @vitest-environment node
 */

/**
 * Invented worlds through the CLI and the MCP server: the calendar, the
 * authoring tools, the world mode of `generate timeline`, the prompts, and the
 * exports an agent reads back.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { formatInWorld, legacyCalendarSet } from '@althistory/calendar';
import { PassThrough } from 'stream';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { DirectEngine } from './engine/DirectEngine';
import { McpServer } from './mcp/McpServer';
import { MCP_TOOLS } from './mcp/toolDefinitions';
import { MCP_PROMPTS, renderPrompt } from './mcp/prompts';
import { TimelineGenerator } from './generator/TimelineGenerator';
import { runCLI } from './index';
import { ExitCode } from './utils/exitCodes';
import { ExecutionContext, isAlthistoryHealth } from './engine/ExecutionContext';
import axios from 'axios';
import { RemoteEngine } from './engine/RemoteEngine';
import express from 'express';
import { AddressInfo } from 'net';
import { LLMClient } from '../services/llm/LLMClient';
import { ExtractedEvent } from '../services/ingestion/types';

const CALENDAR = { epochYear: 1000, eraLabel: 'AR', name: 'the Reckoning' };

/** Call one MCP tool and return its parsed output, or throw with its error text. */
async function callTool(server: McpServer, name: string, args: Record<string, unknown>): Promise<any> {
  const raw = await server.handleMessage(
    JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } })
  );
  const response = JSON.parse(raw!);
  const text = response.result.content[0].text as string;
  if (response.result.isError) throw new Error(text);
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function rpc(server: McpServer, method: string, params?: Record<string, unknown>): Promise<any> {
  return JSON.parse((await server.handleMessage(JSON.stringify({ jsonrpc: '2.0', id: 7, method, params })))!);
}

/** Run the CLI and return the parsed JSON envelope and the exit code. */
async function cli(args: string[]): Promise<{ code: number; body: any }> {
  let out = '';
  const spy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array) => {
    out += chunk.toString();
    return true;
  });
  try {
    const code = await runCLI(['node', 'althistory', ...args]);
    return { code, body: JSON.parse(out) };
  } finally {
    spy.mockRestore();
  }
}

describe('invented worlds', () => {
  let engine: DirectEngine;
  let server: McpServer;
  const created: string[] = [];

  beforeEach(() => {
    engine = new DirectEngine();
    server = new McpServer(engine);
  });

  afterEach(async () => {
    for (const id of created.splice(0)) {
      try {
        await engine.deleteGraph(id);
      } catch {
        // Best-effort cleanup
      }
    }
    await engine.shutdown();
  });

  describe('authoring a world over MCP', () => {
    it('creates a graph with a calendar, an age, events in it and a causal link, and exports it in world years', async () => {
      const graph = await callTool(server, 'althistory_create_graph', {
        name: 'Vael',
        epochYear: 1000,
        eraLabel: 'AR',
        calendarName: 'the Reckoning',
      });
      created.push(graph.id);
      expect(graph.calendar).toEqual(legacyCalendarSet(CALENDAR));

      const age = await callTool(server, 'althistory_create_arc', {
        graphId: graph.id,
        name: 'The Age of Salt',
        startTime: '1000-01-01T00:00:00Z',
        endTime: '1200-01-01T00:00:00Z',
      });
      const reign = await callTool(server, 'althistory_create_arc', {
        graphId: graph.id,
        name: 'The Reign of Ysolde',
        startTime: '1100-01-01T00:00:00Z',
        endTime: '1150-01-01T00:00:00Z',
        parentArcId: age.id,
      });
      expect((await engine.getArc(graph.id, reign.id)).level).toBe(1);

      const founding = await callTool(server, 'althistory_create_event', {
        graphId: graph.id,
        description: 'The salt-kings found Vael',
        timestamp: '1001-03-04T00:00:00Z',
        actor: 'Salt-kings',
        target: 'Vael',
        arcId: age.id,
      });
      const war = await callTool(server, 'althistory_create_event', {
        graphId: graph.id,
        description: 'The Tide War breaks the salt-kings',
        timestamp: '1140-06-01T00:00:00Z',
        actor: 'Tide-folk',
        target: 'Salt-kings',
      });
      await callTool(server, 'althistory_assign_to_arc', { graphId: graph.id, eventId: war.id, arcId: reign.id });

      const link = await callTool(server, 'althistory_link_events', {
        graphId: graph.id,
        causeId: founding.id,
        effectId: war.id,
        type: 'indirect',
        weight: 0.6,
        reasoning: 'The salt monopoly bred resentment',
      });
      expect(link.type).toBe('indirect');
      expect(link.weight).toBe(0.6);

      const markdown = await callTool(server, 'althistory_export_context', { graphId: graph.id });
      expect(markdown).toContain('the Reckoning: 12 months');
      expect(markdown).toContain("tools take a date in the world's notation");
      expect(markdown).toContain('Mar 4, 2 AR (1001-03-04)');
      expect(markdown).toContain('Jan 1, 1 AR (1000-01-01) to Jan 1, 201 AR (1200-01-01)');
      // The arc each event sits in is named, so an agent can find empty ages.
      expect(markdown).toMatch(/The salt-kings found Vael \| The Age of Salt \|/);
      expect(markdown).toMatch(/The Tide War breaks the salt-kings \| The Reign of Ysolde \|/);

      const json = await callTool(server, 'althistory_export_context', { graphId: graph.id, format: 'json' });
      expect(json.metadata.calendar).toEqual(legacyCalendarSet(CALENDAR));
    });

    it('refuses a link from a later cause to an earlier effect, and a link type it does not know', async () => {
      const graph = await engine.createGraph('Order', undefined, { epochYear: 1000 });
      created.push(graph.id);
      const early = await engine.createEvent(graph.id, { description: 'Early', timestamp: '1001-01-01T00:00:00Z' });
      const late = await engine.createEvent(graph.id, { description: 'Late', timestamp: '1002-01-01T00:00:00Z' });

      await expect(
        callTool(server, 'althistory_link_events', { graphId: graph.id, causeId: late.id, effectId: early.id })
      ).rejects.toThrow(/Temporal ordering violation/);
      await expect(
        callTool(server, 'althistory_link_events', { graphId: graph.id, causeId: early.id, effectId: late.id, type: 'magic' })
      ).rejects.toThrow(/type must be one of/);
      await expect(
        callTool(server, 'althistory_link_events', { graphId: graph.id, causeId: early.id, effectId: late.id, weight: 2 })
      ).rejects.toThrow(/weight must be a number from 0 to 1/);
    });

    it('names a missing required argument instead of writing "undefined"', async () => {
      const graph = await engine.createGraph('Strict');
      created.push(graph.id);
      await expect(callTool(server, 'althistory_create_event', { graphId: graph.id })).rejects.toThrow(
        'althistory_create_event needs "description", "timestamp"'
      );
      expect(await engine.listEvents(graph.id)).toEqual([]);
    });

    it("reads an agent's timestamp with the package's ISO reader: no zone is UTC, prose is refused", async () => {
      // The reader's zone independence is tested in calendar/, in five zones
      // (TZ cannot be changed inside a vitest worker thread). Here: the tool
      // goes through it, so a zone-less time is stored as UTC on this host
      // too, and prose that new Date() would guess at is refused.
      const graph = await engine.createGraph('Zoneless');
      created.push(graph.id);
      for (const [timestamp, stored] of [
        ['1001-03-04T00:00', '1001-03-04T00:00:00.000Z'],
        ['1001-03-04 09:30', '1001-03-04T09:30:00.000Z'],
        ['1066', '1066-01-01T00:00:00.000Z'],
      ]) {
        const event = await callTool(server, 'althistory_create_event', {
          graphId: graph.id,
          description: `At ${timestamp}`,
          timestamp,
          actor: 'Salt-kings',
          target: 'Vael',
        });
        expect(new Date(event.timestamp).toISOString(), timestamp).toBe(stored);
      }
      await expect(
        callTool(server, 'althistory_create_event', { graphId: graph.id, description: 'Prose', timestamp: 'Feb 14 1001', actor: 'A', target: 'B' })
      ).rejects.toThrow(/Invalid timestamp/);
    });

    it('records the precision an agent gives a date, and replaces it when the date changes', async () => {
      const graph = await engine.createGraph('Precision');
      created.push(graph.id);
      const month = await engine.createEvent(graph.id, { description: 'Some day in March', timestamp: '1871-03' });
      expect((await engine.getEvent(graph.id, month.id)).metadata?.datePrecision).toBe('month');
      const day = await engine.updateEvent(graph.id, month.id, { timestamp: '1871-03-15' });
      expect(new Date(day.timestamp).toISOString()).toBe('1871-03-15T00:00:00.000Z');
      expect((await engine.getEvent(graph.id, month.id)).metadata?.datePrecision).toBeUndefined();
      const year = await engine.updateEvent(graph.id, month.id, { timestamp: '1872' });
      expect((await engine.getEvent(graph.id, year.id)).metadata?.datePrecision).toBe('year');
      // An arc's times are read as an event's are, so prose is refused here too.
      await expect(engine.createArc(graph.id, { name: 'Prose', startTime: 'Jan 1 1870', endTime: '1871' })).rejects.toThrow(/Invalid timestamp/);
    });

    it("imports an arc's times as its events' are read, so a zone-less arc holds its event", async () => {
      const graph = await engine.createGraph('Imported arcs');
      created.push(graph.id);
      const document = {
        version: '1.0',
        metadata: { graphId: 'x', graphName: 'x', exportedAt: new Date().toISOString(), sourceVersion: '1.0.0', graphVersion: 1, checksum: '' },
        data: {
          events: [{ id: 'e1', description: 'At the start', actor: 'A', target: 'B', timestamp: '1870-02-14T09:30' }],
          arcs: [{ id: 'a1', name: 'Age', description: '', start_time: '1870-02-14T09:30', end_time: '1870-12-31T12:00+05', level: 0 }],
          causalRelationships: [],
          inferredPressures: [],
        },
      };
      await engine.importGraph(JSON.stringify(document), { graphId: graph.id, strategy: 'overwrite' });
      const [arc] = await engine.listArcs(graph.id);
      const [event] = await engine.listEvents(graph.id);
      expect(new Date(arc!.startTime).toISOString()).toBe('1870-02-14T09:30:00.000Z');
      expect(new Date(arc!.endTime).toISOString()).toBe('1870-12-31T07:00:00.000Z');
      expect(new Date(event!.timestamp).toISOString()).toBe('1870-02-14T09:30:00.000Z');
    });

    it('says which event it created when it cannot put it in the arc', async () => {
      const graph = await engine.createGraph('No Such Arc');
      created.push(graph.id);
      await expect(
        callTool(server, 'althistory_create_event', {
          graphId: graph.id,
          description: 'Lost',
          timestamp: '1001-01-01T00:00:00Z',
          arcId: 'arc_missing',
        })
      ).rejects.toThrow(/Created event \S+, but could not put it in arc arc_missing/);
    });

    it('sets, keeps and clears a calendar with althistory_set_calendar', async () => {
      const graph = await engine.createGraph('Later World');
      created.push(graph.id);

      const set = await callTool(server, 'althistory_set_calendar', { graphId: graph.id, epochYear: 1200 });
      expect(set.calendar).toEqual(legacyCalendarSet({ epochYear: 1200 }));

      await expect(callTool(server, 'althistory_set_calendar', { graphId: graph.id })).rejects.toThrow(/or clear: true/);
      await expect(
        callTool(server, 'althistory_set_calendar', { graphId: graph.id, epochYear: 1200, clear: true })
      ).rejects.toThrow(/not both/);
      await expect(
        callTool(server, 'althistory_set_calendar', { graphId: graph.id, eraLabel: 'AR' })
      ).rejects.toThrow(/needs an epoch year/);

      const cleared = await callTool(server, 'althistory_set_calendar', { graphId: graph.id, clear: true });
      expect(cleared.calendar).toBeUndefined();
    });
  });

  describe('the world mode of generate timeline', () => {
    it('chronicles a world from its epoch in its own calendar, without a model', async () => {
      const result = await engine.generateTimeline({
        world: 'A drowned archipelago ruled by salt-kings',
        calendar: { eraLabel: 'AR' },
        eventCount: 5,
        dryRun: true,
      });
      expect(result.world).toBe('A drowned archipelago ruled by salt-kings');
      expect(result.source).toBe('template');
      expect(result.calendar).toEqual(legacyCalendarSet({ epochYear: 1000, eraLabel: 'AR' }));
      expect(result.graphName).toBe('World: A drowned archipelago ruled by…');
      expect(result.events[0].timestamp.startsWith('1000-01-01')).toBe(true);
      expect(result.events[0].description).toBe('The founding of the world: A drowned archipelago ruled by salt-kings');
      // A template date is a day, so it falls at midnight rather than showing an hour.
      for (const event of result.events) expect(event.timestamp).toMatch(/T00:00:00\.000Z$/);
      // The preview places events in arcs as the write would.
      const previewArcs = new Set(result.arcs.map((arc) => arc.id));
      for (const event of result.events) expect(previewArcs.has(event.metadata?.arcId as string)).toBe(true);
      // Nothing of the real-history template leaks in.
      const text = JSON.stringify(result);
      expect(text).not.toMatch(/1914|Divergent|counterfactual|Point of Divergence/i);
      // The arcs are named in the world's years.
      expect(result.arcs.some((arc) => / AR/.test(arc.name))).toBe(true);
    });

    it('reads its start and end dates as ISO 8601, refusing prose rather than reading it in the host zone', async () => {
      await expect(engine.generateTimeline({ world: 'Isles', startDate: 'Feb 14 1870', dryRun: true })).rejects.toThrow(/Invalid start date/);
      const zoneless = await engine.generateTimeline({ world: 'Isles', startDate: '1870-02-14T00:00', eventCount: 3, dryRun: true });
      expect(zoneless.calendar).toEqual(legacyCalendarSet({ epochYear: 1870 }));
    });

    it('takes the epoch from the start date when none is given, and writes the calendar on the graph', async () => {
      const result = await engine.generateTimeline({
        world: 'The kingdoms under the glacier',
        startDate: '1500-01-01T00:00:00Z',
        eventCount: 3,
      });
      created.push(result.graphId);
      expect(result.calendar).toEqual(legacyCalendarSet({ epochYear: 1500 }));
      expect((await engine.getGraph(result.graphId)).calendar).toEqual(legacyCalendarSet({ epochYear: 1500 }));
      // Every event is placed in an arc that holds it, as the app and exports read it.
      const arcIds = new Set(result.arcs.map((arc) => arc.id));
      for (const event of await engine.listEvents(result.graphId)) {
        expect(arcIds.has(event.metadata?.arcId as string), event.description).toBe(true);
      }
    });

    it('refuses a request that mixes the two kinds, or puts a calendar on an alternate history', async () => {
      await expect(
        engine.generateTimeline({ world: 'Somewhere', premise: 'What if', divergencePoint: 'x', dryRun: true })
      ).rejects.toThrow(/not both/);
      await expect(
        engine.generateTimeline({ premise: 'What if', divergencePoint: 'x', calendar: { eraLabel: 'AR' }, dryRun: true })
      ).rejects.toThrow(/A calendar is for an invented world/);
      await expect(engine.generateTimeline({ premise: 'What if', dryRun: true })).rejects.toThrow(
        /a premise and a point of divergence/
      );
      await expect(engine.generateTimeline({ world: 'Somewhere', startDate: 'soon', dryRun: true })).rejects.toThrow(
        /Invalid start date/
      );
    });

    it('asks the model for an invented world, not a counterfactual, and tells it how years are stored', async () => {
      const events: ExtractedEvent[] = ['First', 'Second', 'Third'].map((description, index) => ({
        tempId: `e${index}`,
        description,
        actor: '',
        target: '',
        timestamp: `${1010 + index * 10}-01-01T00:00:00Z`,
        confidence: 0.9,
        source: { type: 'llm', extractedAt: new Date().toISOString() },
        selected: true,
        edited: false,
      }));
      const llm: LLMClient = {
        provider: 'mock-llm',
        extractEvents: vi.fn().mockResolvedValue(events),
        suggestRelationships: vi.fn().mockResolvedValue([]),
        enrichDescription: vi.fn().mockResolvedValue(''),
      };
      const generator = new TimelineGenerator({ llmClient: llm });
      const result = await generator.generateTimeline(
        { world: 'Vael', calendar: { epochYear: 1000, eraLabel: 'AR' }, eventCount: 3, dryRun: true },
        await engine.getContainer()
      );
      const prompt = vi.mocked(llm.extractEvents).mock.calls[0][0];
      expect(prompt).toContain('invented world');
      expect(prompt).not.toContain('counterfactual');
      // The model writes dates in the world's notation, which the server reads with its calendars.
      expect(prompt).toContain("dated in the world's own calendar");
      expect(prompt).toContain('write a date as "Jan 1, 1 AR"');
      expect(prompt).toContain('do not convert it to an ISO date');
      expect(result.events[0].actor).toBe('Unnamed Realm');
      expect(result.source).toBe('model');
    });

    it('keeps a branch of an invented world in that world', async () => {
      const world = await engine.generateTimeline({ world: 'Vael', calendar: { eraLabel: 'AR' }, eventCount: 4 });
      created.push(world.graphId);
      const branch = await engine.generateBranch({
        sourceGraphId: world.graphId,
        divergeAtEventId: world.events[1].id,
        counterfactualPrompt: 'The salt-kings make peace',
        branchName: 'Peace',
        eventCount: 3,
      });
      created.push(branch.graphId);
      expect((await engine.getGraph(branch.graphId)).calendar).toEqual(legacyCalendarSet({ epochYear: 1000, eraLabel: 'AR' }));
      expect(JSON.stringify(branch.events)).not.toMatch(/counterfactual|Divergent/i);
      expect(branch.events.some((event) => event.description === 'The chronicle turns: The salt-kings make peace')).toBe(
        true
      );
      // The branch's events sit in its arc, which is recorded, so the export carries both.
      const branchArc = branch.arcs[0];
      for (const event of branch.events) expect(event.metadata?.arcId).toBe(branchArc.id);
      const document = JSON.parse((await engine.exportGraph(branch.graphId, 'json')).content!);
      expect(document.data.arcs.map((arc: { id: string }) => arc.id)).toContain(branchArc.id);
    });
  });

  describe('what the review found', () => {
    it('lists every graph created by parallel tool calls', async () => {
      const made = await Promise.all(
        [1, 2, 3, 4, 5, 6].map((n) => callTool(server, 'althistory_create_graph', { name: `Parallel ${n}` }))
      );
      created.push(...made.map((graph) => graph.id));
      const listed = new Set((await engine.listGraphs()).map((graph) => graph.id));
      for (const graph of made) expect(listed.has(graph.id)).toBe(true);
    });

    it('keeps a world generated near the year 9999 within four-digit years', async () => {
      const result = await engine.generateTimeline({ world: 'Late', calendar: { epochYear: 9900 }, eventCount: 4, dryRun: true });
      for (const event of result.events) expect(event.timestamp).toMatch(/^\d{4}-/);
      await expect(
        engine.generateTimeline({ world: 'Late', calendar: { epochYear: 9900 }, endDate: '+010100-01-01T00:00:00Z', dryRun: true })
      ).rejects.toThrow(/no later than the year 9999/);
    });

    it('reads a start date without a zone as UTC', async () => {
      const result = await engine.generateTimeline({ world: 'Isles', startDate: '1000-01-01T00:00', eventCount: 3, dryRun: true });
      expect(result.calendar).toEqual(legacyCalendarSet({ epochYear: 1000 }));
      expect(result.events[0].timestamp.startsWith('1000-01-01T00:00')).toBe(true);
    });

    it('treats an empty calendar argument as not given', async () => {
      const result = await callTool(server, 'althistory_generate_timeline', {
        premise: 'What if the Armada landed',
        divergencePoint: '1588-08-08',
        eraLabel: '',
        epochYear: '',
        calendarName: '',
        eventCount: 3,
        dryRun: true,
      });
      expect(result.calendar).toBeUndefined();
    });

    it('writes valid four-digit dates into the worldbuild prompt for an early epoch, and refuses a label the tools would refuse', () => {
      const text = renderPrompt('worldbuild', { world: 'Isles', epochYear: '50' }).text;
      for (const stamp of text.match(/\d{4}-01-01T00:00:00Z/g) ?? []) expect(Number.isNaN(Date.parse(stamp))).toBe(false);
      expect(text).toContain('Year 312 is 0361-01-01T00:00:00Z');
      expect(renderPrompt('worldbuild', { world: 'Late', epochYear: '9990' }).text).toContain('Year 2 is 9991-01-01T00:00:00Z');
      expect(() => renderPrompt('worldbuild', { world: 'Isles', eraLabel: 'x'.repeat(17) })).toThrow(/at most 16/);
      // The epoch is read as the tools read it, so the prompt cannot promise a calendar they refuse.
      for (const epochYear of ['1e3', '0x3E8', '1000.0']) {
        expect(() => renderPrompt('worldbuild', { world: 'Isles', epochYear }), epochYear).toThrow(/Invalid epochYear/);
      }
      expect(renderPrompt('worldbuild', { world: 'Isles', epochYear: '+1000' }).text).toContain('epochYear 1000.');
      // `/althistory:worldbuild 1200` puts the number in the first argument, eraLabel.
      expect(renderPrompt('worldbuild', { eraLabel: '1200' }).text).toContain('epochYear 1200.');
    });

    it('nests an arc one level below its parent, and refuses a parent that does not exist', async () => {
      const graph = await engine.createGraph('Nesting');
      created.push(graph.id);
      const age = await engine.createArc(graph.id, { name: 'Age', startTime: '1000-01-01T00:00:00Z', endTime: '1200-01-01T00:00:00Z' });
      const reign = await engine.createArc(graph.id, {
        name: 'Reign',
        startTime: '1100-01-01T00:00:00Z',
        endTime: '1150-01-01T00:00:00Z',
        parentArcId: age.id,
      });
      expect((await engine.getArc(graph.id, reign.id)).level).toBe(1);
      await expect(
        engine.createArc(graph.id, { name: 'Orphan', startTime: '1100-01-01T00:00:00Z', endTime: '1101-01-01T00:00:00Z', parentArcId: 'arc_none' })
      ).rejects.toThrow(/Parent arc not found/);

      // The JSON export names the parent, so the import's level check holds.
      const document = JSON.parse((await engine.exportGraph(graph.id, 'json')).content!);
      const exportedReign = document.data.arcs.find((arc: { name: string }) => arc.name === 'Reign');
      expect(exportedReign.parent_arc_id).toBe(age.id);
    });
  });

  describe('the prompts', () => {
    it('lists the three prompts over MCP and fills one in', async () => {
      const init = await rpc(server, 'initialize', {});
      expect(init.result.capabilities.prompts).toBeDefined();

      const list = await rpc(server, 'prompts/list');
      expect(list.result.prompts.map((prompt: { name: string }) => prompt.name)).toEqual([
        'worldbuild',
        'alternate_history',
        'grow_history',
      ]);

      const got = await rpc(server, 'prompts/get', {
        name: 'worldbuild',
        arguments: { world: 'A drowned archipelago', eraLabel: 'AR', epochYear: '1200' },
      });
      const text = got.result.messages[0].content.text as string;
      expect(got.result.messages[0].role).toBe('user');
      expect(text).toContain('A drowned archipelago');
      expect(text).toContain('epochYear 1200, eraLabel "AR"');
      expect(text).toContain('312 AR is 1511-01-01T00:00:00Z');
    });

    it('answers a bad prompt request as invalid params', async () => {
      expect((await rpc(server, 'prompts/get', { name: 'nope' })).error.code).toBe(-32602);
      // Every argument is optional: without the world, the agent is told to ask for it.
      const bare = await rpc(server, 'prompts/get', { name: 'worldbuild', arguments: {} });
      expect(bare.result.messages[0].content.text).toContain('has not described the world yet');
      // One-word arguments come first, so a Claude Code slash command's words land in them.
      expect(MCP_PROMPTS[0].arguments.map((argument) => argument.name)).toEqual(['eraLabel', 'epochYear', 'world']);
      expect(MCP_PROMPTS.every((prompt) => prompt.arguments.every((argument) => !argument.required))).toBe(true);
      expect(
        (await rpc(server, 'prompts/get', { name: 'grow_history', arguments: { graphId: 'g', extra: 'x' } })).error.message
      ).toContain('does not take "extra"');
      expect(
        (await rpc(server, 'prompts/get', { name: 'worldbuild', arguments: { world: 'w', epochYear: 'soon' } })).error.code
      ).toBe(-32602);
    });

    it('names only tools the server offers', () => {
      const tools = new Set(MCP_TOOLS.map((tool) => tool.name));
      const samples: Record<string, Record<string, string>> = {
        worldbuild: { world: 'w', eraLabel: 'AR' },
        alternate_history: { premise: 'p', divergencePoint: 'd' },
        grow_history: { graphId: 'g' },
      };
      for (const prompt of MCP_PROMPTS) {
        const named = renderPrompt(prompt.name, samples[prompt.name]).text.match(/althistory_[a-z_]+/g) ?? [];
        expect(named.length).toBeGreaterThan(0);
        for (const name of named) {
          expect(tools.has(name), `${prompt.name} names ${name}`).toBe(true);
        }
      }
    });

    it('are all documented in the MCP guide, with every tool', () => {
      const guide = fs.readFileSync(path.resolve(__dirname, '../../../docs/mcp-agent-guide.md'), 'utf8');
      expect(guide).toContain(`The server exposes ${MCP_TOOLS.length} tools.`);
      for (const tool of MCP_TOOLS) {
        expect(guide, `the guide documents ${tool.name}`).toContain(`#### \`${tool.name}\``);
        for (const argument of Object.keys(tool.inputSchema.properties)) {
          expect(guide, `the guide names ${tool.name}'s ${argument}`).toContain(`\`${argument}\``);
        }
      }
      for (const prompt of MCP_PROMPTS) {
        expect(guide).toContain(`| \`${prompt.name}\` |`);
      }
    });

    it('prints a prompt from the CLI, and refuses an argument that is not key=value', async () => {
      const ok = await cli(['prompt', 'grow_history', 'graphId=abc']);
      expect(ok.code).toBe(ExitCode.SUCCESS);
      expect(ok.body.data.text).toContain('graph abc');

      const bad = await cli(['prompt', 'grow_history', 'abc']);
      expect(bad.code).toBe(ExitCode.VALIDATION_FAILED);
    });
  });

  describe('a world of its own shape', () => {
    // Twelve months and two festivals (one with a leap day every sixth year), and a 30-hour day of twenty hours.
    const VAEL = {
      version: 2,
      dayLength: 30 * 3600,
      primary: 'reckoning',
      calendars: [
        {
          id: 'reckoning',
          name: 'the Reckoning of the Rising',
          parts: [
            ...['Lowtide', 'Greywater', 'Thaw', 'Seedtide', 'Brightwater', 'Highsun'].map((name) => ({ name, days: 30 })),
            { name: "Midyear's Day", days: 1, intercalary: true },
            ...['Saltreap', 'Panfire', 'Gale', 'Ebb', 'Wrack', 'Longnight'].map((name) => ({ name, days: 30 })),
            { name: 'The Drowned Days', days: 4, intercalary: true },
          ],
          leapRules: [{ every: 6, part: 13, days: 1 }],
          epoch: 0,
          eras: [{ label: 'AR', from: 1 }],
          time: { hoursPerDay: 20, minutesPerHour: 100, secondsPerMinute: 100 },
        },
        { id: 'tide', name: 'the Tide-count', parts: [{ name: 'Ebbing', days: 183 }, { name: 'Flooding', days: 183 }], epoch: -100, eras: [{ label: 'TC', from: 1 }] },
      ],
    };

    it('is created over MCP, and takes and gives its dates in its own notation', async () => {
      const graph = await callTool(server, 'althistory_create_graph', { name: 'Vael', calendar: VAEL });
      created.push(graph.id);
      expect(graph.calendar.calendars.map((definition: { id: string }) => definition.id)).toEqual(['reckoning', 'tide']);

      const war = await callTool(server, 'althistory_create_event', {
        graphId: graph.id,
        description: 'The Tide War begins',
        timestamp: 'Greywater 4, 312 AR, 13:50',
        actor: 'Tide-folk',
        target: 'Salt-kings',
      });
      const shown = (timestamp: string, precision: 'day' | 'month' = 'day', calendar?: string) =>
        formatInWorld(graph.calendar, Date.parse(timestamp), precision, calendar);
      expect(shown(war.timestamp)).toBe('Greywater 4, 312 AR, 13:50');

      // A date in the other calendar names the same timeline.
      const tide = await callTool(server, 'althistory_create_event', { graphId: graph.id, description: 'Flood', timestamp: 'Flooding 20, 5 TC' });
      expect(shown(tide.timestamp, 'day', 'tide')).toBe('Flooding 20, 5 TC');

      const month = await engine.createEvent(graph.id, { description: 'Some time in Thaw', timestamp: 'Thaw 312 AR' });
      expect((await engine.getEvent(graph.id, month.id)).metadata?.datePrecision).toBe('month');
      await expect(engine.createEvent(graph.id, { description: 'x', timestamp: 'Greywater 31, 312 AR' })).rejects.toThrow(/Invalid timestamp/);

      const arc = await callTool(server, 'althistory_create_arc', { graphId: graph.id, name: 'The war years', startTime: 'Lowtide 312 AR', endTime: 'Longnight 312 AR' });
      expect(shown(arc.startTime)).toBe('Lowtide 1, 312 AR');
      expect(shown(arc.endTime)).toBe('Longnight 30, 312 AR, 19:99');

      const markdown = await callTool(server, 'althistory_export_context', { graphId: graph.id });
      expect(markdown).toContain('Greywater 4, 312 AR, 13:50 (');
      expect(markdown).toContain('the Reckoning of the Rising (primary): 12 months and 2 festivals, 365 to 366 days a year, eras AR');
    });

    it('is set from a JSON file on the command line, and not mixed with the simple flags', async () => {
      const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'vael-')), 'vael-calendar.json');
      fs.writeFileSync(file, JSON.stringify(VAEL));
      const made = await cli(['graph', 'create', 'Filed', '--calendar-file', file]);
      expect(made.code).toBe(ExitCode.SUCCESS);
      created.push(made.body.data.id);
      expect(made.body.data.calendar.primary).toBe('reckoning');
      const mixed = await cli(['graph', 'create', 'Mixed', '--calendar-file', file, '--epoch-year', '1000']);
      expect(mixed.code).toBe(ExitCode.VALIDATION_FAILED);
      expect(JSON.stringify(mixed.body)).toContain('not both');
      const broken = await cli(['graph', 'create', 'Broken', '--calendar-file', file.replace('.json', '-missing.json')]);
      expect(broken.code).toBe(ExitCode.VALIDATION_FAILED);
    });

    it('is chronicled from a start written in its own calendar', async () => {
      const result = await engine.generateTimeline({ world: 'Vael', calendar: VAEL as never, startDate: 'Lowtide 1, 300 AR', eventCount: 3, dryRun: true });
      expect(formatInWorld(result.calendar!, Date.parse(result.events[0]!.timestamp), 'year')).toBe('300 AR');
    });
  });

  describe('the CLI calendar flags', () => {
    it('creates a graph with a calendar, changes it, and clears it', async () => {
      const made = await cli(['graph', 'create', 'Flagged', '--epoch-year', '1000', '--era-label', 'AR']);
      expect(made.code).toBe(ExitCode.SUCCESS);
      created.push(made.body.data.id);
      expect(made.body.data.calendar).toEqual(legacyCalendarSet({ epochYear: 1000, eraLabel: 'AR' }));

      const changed = await cli(['graph', 'calendar', made.body.data.id, '--epoch-year', '1100']);
      expect(changed.body.data.calendar).toEqual(legacyCalendarSet({ epochYear: 1100 }));

      const cleared = await cli(['graph', 'calendar', made.body.data.id, '--clear']);
      expect(cleared.body.data.calendar).toBeUndefined();
    });

    it('names the months from --month-names, and refuses the wrong count', async () => {
      const months = 'Thaw,Seedfall,Greening,Highsun,Brine,Harvest,Ember,Ashfall,Gale,Dimming,Frost,Deepwinter';
      const made = await cli(['graph', 'create', 'Months', '--epoch-year', '1000', '--month-names', months]);
      expect(made.code).toBe(ExitCode.SUCCESS);
      created.push(made.body.data.id);
      expect(made.body.data.calendar).toEqual(legacyCalendarSet({ epochYear: 1000, monthNames: months.split(',') }));

      const short = await cli(['graph', 'calendar', made.body.data.id, '--epoch-year', '1000', '--month-names', 'A,B']);
      expect(short.code).toBe(ExitCode.VALIDATION_FAILED);
      expect(JSON.stringify(short.body)).toContain('all 12 months');
    });

    it('reads month names sent as JSON text as the list, not as names with brackets', async () => {
      const months = ['Thaw', 'Seedfall', 'Greening', 'Highsun', 'Brine', 'Harvest', 'Ember', 'Ashfall', 'Gale', 'Dimming', 'Frost', 'Deepwinter'];
      const graph = await callTool(server, 'althistory_create_graph', { name: 'JSON months', epochYear: 1000, monthNames: JSON.stringify(months) });
      created.push(graph.id);
      expect(graph.calendar.calendars[0].parts.map((part: { name: string }) => part.name)).toEqual(months);
    });

    it('refuses a bracketed list that is not JSON, rather than keeping the brackets in the names', async () => {
      for (const months of [
        '[Lowtide, Greywater, Thaw, Seedtide, Brightwater, Highsun, Saltreap, Panfire, Gale, Ebb, Wrack, Longnight]',
        '[Lowtide, Greywater, Thaw, Seedtide, Brightwater, Highsun, Saltreap, Panfire, Gale, Ebb, Wrack, Longnight],',
      ]) {
        const wrapped = await cli(['graph', 'create', 'Wrapped', '--epoch-year', '1000', '--month-names', months]);
        expect(wrapped.code, months).toBe(ExitCode.VALIDATION_FAILED);
        expect(JSON.stringify(wrapped.body), months).toContain('brackets');
      }
      const none = await cli(['graph', 'create', 'No names', '--epoch-year', '1000', '--month-names', ',']);
      expect(none.code).toBe(ExitCode.VALIDATION_FAILED);
      expect(JSON.stringify(none.body)).toContain('got 0');
    });

    it('ignores a comma after the last name, and reads one name per line', async () => {
      for (const months of [
        'Lowtide,Greywater,Thaw,Seedtide,Brightwater,Highsun,Saltreap,Panfire,Gale,Ebb,Wrack,Longnight,',
        'Lowtide\nGreywater\nThaw\nSeedtide\nBrightwater\nHighsun\nSaltreap\nPanfire\nGale\nEbb\nWrack\nLongnight',
      ]) {
        const made = await cli(['graph', 'create', 'Listed', '--epoch-year', '1000', '--month-names', months]);
        expect(made.code, months).toBe(ExitCode.SUCCESS);
        created.push(made.body.data.id);
        const parts = made.body.data.calendar.calendars[0].parts.map((part: { name: string }) => part.name);
        expect(parts, months).toHaveLength(12);
        expect(parts[11]).toBe('Longnight');
      }
    });

    it('takes month names as a list over MCP, and dates the export in them', async () => {
      const months = ['Thaw', 'Seedfall', 'Greening', 'Highsun', 'Brine', 'Harvest', 'Ember', 'Ashfall', 'Gale', 'Dimming', 'Frost', 'Deepwinter'];
      const graph = await callTool(server, 'althistory_create_graph', { name: 'Named months', epochYear: 1000, eraLabel: 'AR', monthNames: months });
      created.push(graph.id);
      expect(graph.calendar).toEqual(legacyCalendarSet({ epochYear: 1000, eraLabel: 'AR', monthNames: months }));
      await callTool(server, 'althistory_create_event', {
        graphId: graph.id,
        description: 'The first thaw',
        timestamp: '1140-03-04T00:00:00Z',
      });
      const context = await callTool(server, 'althistory_export_context', { graphId: graph.id });
      const text = typeof context === 'string' ? context : JSON.stringify(context);
      expect(text).toContain('Greening 4, 141 AR (1140-03-04)');
      expect(text).toContain('Thaw (31), Seedfall (28)');
    });

    it('refuses a label without an epoch, and a year that is not a whole number', async () => {
      expect((await cli(['graph', 'create', 'No Epoch', '--era-label', 'AR'])).code).toBe(ExitCode.VALIDATION_FAILED);
      expect((await cli(['graph', 'create', 'Bad Epoch', '--epoch-year', '10.5'])).code).toBe(
        ExitCode.VALIDATION_FAILED
      );
    });

    it('reads the epoch year as the app\'s form does, a leading "+" included', async () => {
      const made = await cli(['graph', 'create', 'Signed', '--epoch-year', '+1000']);
      expect(made.code).toBe(ExitCode.SUCCESS);
      created.push(made.body.data.id);
      expect(made.body.data.calendar).toEqual(legacyCalendarSet({ epochYear: 1000 }));
      // Read, then refused for its range, with the range in the message.
      const zero = await cli(['graph', 'create', 'Zero', '--epoch-year', '-5']);
      expect(zero.code).toBe(ExitCode.VALIDATION_FAILED);
      expect(JSON.stringify(zero.body)).toContain('between 1 and 9999');
    });
  });

  describe('importing a world', () => {
    it('brings the calendar back with the graph', async () => {
      const graph = await engine.createGraph('Round Trip', undefined, CALENDAR);
      created.push(graph.id);
      await engine.createEvent(graph.id, { description: 'Founding', timestamp: '1001-01-01T00:00:00Z' });
      const exported = await engine.exportGraph(graph.id, 'json');
      const document = JSON.parse(exported.content!);
      document.metadata.graphId = 'graph_not_here';

      const imported = await engine.importGraph(JSON.stringify(document));
      created.push(imported.graphId!);
      expect((await engine.getGraph(imported.graphId!)).calendar).toEqual(legacyCalendarSet(CALENDAR));
    });
  });

  describe('finding the running app', () => {
    it("recognises only althistory's own health report, so another server on port 3000 is never sent the key", () => {
      // What althistory answers while its services warm up (a 503), and when healthy.
      expect(isAlthistoryHealth({ status: 'unhealthy', services: { graphService: true, eventRepository: false } })).toBe(true);
      expect(isAlthistoryHealth({ status: 'healthy', services: { graphService: true } })).toBe(true);
      // A dev server's page, another API's health check, nothing at all.
      expect(isAlthistoryHealth('<!doctype html><html></html>')).toBe(false);
      expect(isAlthistoryHealth({ status: 'ok' })).toBe(false);
      expect(isAlthistoryHealth({ status: 'ok', services: { db: true } })).toBe(false);
      expect(isAlthistoryHealth(undefined)).toBe(false);
    });

    it('sends the key the caller chose to the app it finds, never swapping it for the admin key', async () => {
      const health = { status: 'unhealthy', services: { graphService: true } };
      const probe = vi.spyOn(axios, 'get').mockResolvedValue({ data: health });
      const saved = { scoped: process.env.ALTHISTORY_API_KEY, admin: process.env.ADMIN_API_KEY };
      const keyOf = async (options: ConstructorParameters<typeof ExecutionContext>[0]) => {
        const context = new ExecutionContext(options);
        const found = (await context.getEngine()) as unknown as { client: { defaults: { headers: Record<string, string> } } };
        expect(found).toBeInstanceOf(RemoteEngine);
        return found.client.defaults.headers['X-API-Key'];
      };
      try {
        process.env.ALTHISTORY_API_KEY = 'scoped-read-only';
        process.env.ADMIN_API_KEY = 'admin-from-env';
        expect(await keyOf({})).toBe('scoped-read-only');
        expect(await keyOf({ apiKey: 'from-flag' })).toBe('from-flag');
        delete process.env.ALTHISTORY_API_KEY;
        expect(await keyOf({})).toBe('admin-from-env');
        expect(probe.mock.calls[0][0]).toBe('http://127.0.0.1:3000/health');
      } finally {
        probe.mockRestore();
        if (saved.scoped === undefined) delete process.env.ALTHISTORY_API_KEY;
        else process.env.ALTHISTORY_API_KEY = saved.scoped;
        if (saved.admin === undefined) delete process.env.ADMIN_API_KEY;
        else process.env.ADMIN_API_KEY = saved.admin;
      }
    });

    it('reports the running app as degraded, not as a failure, while its health check answers 503', async () => {
      const app = express();
      app.get('/health', (_req, res) => {
        res.status(503).json({ status: 'unhealthy', services: { graphService: true }, uptime: 12 });
      });
      const server = app.listen(0);
      try {
        const { port } = server.address() as AddressInfo;
        const health = await new RemoteEngine(`http://127.0.0.1:${port}`).getHealth();
        expect(health.status).toBe('degraded');
        expect(health.executionMode).toBe('remote');
      } finally {
        await new Promise((resolve) => server.close(resolve));
      }
    });
  });

  describe('what generation records', () => {
    it("records a branch's links, so a diff sees them and a merge can carry them", async () => {
      const world = await engine.generateTimeline({ world: 'Vael', eventCount: 4 });
      created.push(world.graphId);
      const branch = await engine.generateBranch({
        sourceGraphId: world.graphId,
        divergeAtEventId: world.events[1].id,
        counterfactualPrompt: 'The salt-kings make peace',
        branchName: 'Peace',
        eventCount: 3,
      });
      created.push(branch.graphId);
      const diff = (await engine.diffGraph(world.graphId, branch.graphId)) as {
        relationships: { added: number };
        arcs: { added: number };
      };
      expect(diff.relationships.added).toBe(branch.relationships.length);
      expect(diff.arcs.added).toBe(1);
    });

    it('previews a branch as the write makes it', async () => {
      const world = await engine.generateTimeline({ world: 'Vael', eventCount: 4 });
      created.push(world.graphId);
      const request = {
        sourceGraphId: world.graphId,
        divergeAtEventId: world.events[1].id,
        counterfactualPrompt: 'The salt-kings make peace',
        branchName: 'Peace',
        eventCount: 3,
      };
      const preview = await engine.generateBranch({ ...request, dryRun: true });
      const written = await engine.generateBranch(request);
      created.push(written.graphId);
      expect(preview.arcs.map((arc) => arc.name)).toEqual(written.arcs.map((arc) => arc.name));
      expect(preview.events.map((event) => event.timestamp)).toEqual(written.events.map((event) => event.timestamp));
      expect(preview.relationships.length).toBe(written.relationships.length);
      for (const event of preview.events) expect(event.metadata?.arcId).toBe(preview.arcs[0].id);
      expect(preview.calendar).toEqual(written.calendar ?? (await engine.getGraph(written.graphId)).calendar);
    });

    it("records an expansion's arc and events in the graph's history", async () => {
      const world = await engine.generateTimeline({ world: 'Vael', eventCount: 4 });
      created.push(world.graphId);
      const expanded = await engine.generateExpand({ graphId: world.graphId, eventCount: 2 });
      const history = await (await engine.getContainer()).graphRepository.checkout(world.graphId);
      expect(Object.keys(history.arcs)).toContain(expanded.arcs[0].id);
      for (const event of expanded.events) expect(Object.keys(history.events)).toContain(event.id);
    });
  });

  describe('the stdio server', () => {
    it('answers every request even when the client closes its end first', async () => {
      const input = new PassThrough();
      const output = new PassThrough();
      let written = '';
      output.on('data', (chunk) => (written += chunk.toString()));

      server.start(input, output);
      input.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'althistory_list_graphs' } }) + '\n');
      input.write(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'ping' }) + '\n');
      input.end();
      await new Promise((resolve) => setImmediate(resolve));
      await server.whenIdle();
      server.stop();

      const ids = written
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line).id)
        .sort();
      expect(ids).toEqual([1, 2]);
    });
  });
});
