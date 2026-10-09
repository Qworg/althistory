import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { DirectEngine } from './engine/DirectEngine';
import { GraphValidator, ScopedGraphServices } from './validation/GraphValidator';
import { Event } from '@/models';
import { ExitCode } from './utils/exitCodes';
import { runCLI } from './index';

describe('CLI Phase 5: Validation, Self-Healing & Export/Import Engine', () => {
  let engine: DirectEngine;
  let testGraphId: string;
  const tempDir = path.join(process.cwd(), 'data', 'test-temp-export');

  beforeEach(async () => {
    engine = new DirectEngine();
    const graph = await engine.createGraph(
      'Validation Test Timeline',
      'Timeline for testing validation, self-healing, and exports'
    );
    testGraphId = graph.id;

    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
  });

  afterEach(async () => {
    try {
      await engine.deleteGraph(testGraphId);
    } catch {
      // Best-effort cleanup
    }
    await engine.shutdown();

    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('Validation & Self-Healing', () => {
    it('validates a clean, consistent graph as valid with zero errors', async () => {
      // Create arc
      const arc = await engine.createArc(testGraphId, {
        name: 'The Renaissance',
        startTime: '1400-01-01T00:00:00.000Z',
        endTime: '1600-01-01T00:00:00.000Z',
      });

      // Create two chronological events associated with the arc
      const evt1 = await engine.createEvent(testGraphId, {
        description: 'Invention of the Printing Press',
        timestamp: '1440-01-01T00:00:00.000Z',
        actor: 'Johannes Gutenberg',
        target: 'Mainz',
        metadata: { arcId: arc.id },
      });

      const evt2 = await engine.createEvent(testGraphId, {
        description: 'Publication of Gutenberg Bible',
        timestamp: '1455-01-01T00:00:00.000Z',
        actor: 'Johannes Gutenberg',
        target: 'Europe',
        metadata: { arcId: arc.id },
      });

      // Link cause -> effect (1440 -> 1455)
      await engine.createCausalLink(testGraphId, {
        causeId: evt1.id,
        effectId: evt2.id,
        weight: 0.9,
        type: 'direct',
      });

      const report = await engine.validateGraph(testGraphId);
      expect(report.valid).toBe(true);
      expect(report.errorCount).toBe(0);
      expect(report.issues.filter((i) => i.severity === 'error')).toHaveLength(0);
    });

    it('detects temporal paradox in causal relationship (cause occurs after effect)', async () => {
      const evt1 = await engine.createEvent(testGraphId, {
        description: 'Sputnik Launch',
        timestamp: '1957-10-04T19:28:00.000Z',
      });

      const evt2 = await engine.createEvent(testGraphId, {
        description: 'First Moon Landing',
        timestamp: '1969-07-20T20:17:00.000Z',
      });

      // Initially link cause (1957) -> effect (1969)
      await engine.createCausalLink(testGraphId, {
        causeId: evt1.id,
        effectId: evt2.id,
        weight: 0.8,
      });

      // Later update cause timestamp to after effect (temporal paradox)
      await engine.updateEvent(testGraphId, evt1.id, {
        timestamp: '1975-01-01T00:00:00.000Z',
      });

      const report = await engine.validateGraph(testGraphId);
      expect(report.valid).toBe(false);
      expect(report.errorCount).toBeGreaterThanOrEqual(1);
      const paradoxIssue = report.issues.find((i) => i.type === 'causal_direction');
      expect(paradoxIssue).toBeDefined();
      expect(paradoxIssue?.severity).toBe('error');
    });

    it('detects causal DAG cycles and auto-repairs them by breaking the cycle', async () => {
      const validator = new GraphValidator();
      const mockEvents = [
        new Event({ id: 'c1', description: 'Event Alpha', timestamp: new Date('2000-01-01'), actor: 'A', target: 'B' }),
        new Event({ id: 'c2', description: 'Event Beta', timestamp: new Date('2001-01-01'), actor: 'A', target: 'B' }),
        new Event({ id: 'c3', description: 'Event Gamma', timestamp: new Date('2002-01-01'), actor: 'A', target: 'B' }),
      ];
      let rels = [
        { id: 'r1', cause_event_id: 'c1', effect_event_id: 'c2', weight: 0.9, confidence: 0.9, evidence: 'e1', relationship_type: 'direct' },
        { id: 'r2', cause_event_id: 'c2', effect_event_id: 'c3', weight: 0.9, confidence: 0.9, evidence: 'e2', relationship_type: 'direct' },
        { id: 'r3', cause_event_id: 'c3', effect_event_id: 'c1', weight: 0.3, confidence: 0.3, evidence: 'e3', relationship_type: 'direct' },
      ];

      const scopedMock: ScopedGraphServices = {
        eventRepository: {
          findAll: async () => mockEvents,
          findById: async (id) => mockEvents.find((e) => e.id === id) || null,
          update: async () => null,
          delete: async () => true,
        },
        arcRepository: {
          findAll: async () => [],
          findById: async () => null,
          update: async () => null,
          delete: async () => true,
        },
        causalService: {
          getAllRelationships: async () => rels,
          createCausalLink: async () => {},
          deleteCausalLink: async (causeId, effectId) => {
            rels = rels.filter((r) => !(r.cause_event_id === causeId && r.effect_event_id === effectId));
            return true;
          },
        },
      };

      // 1. Without auto-repair: validation detects cycle
      const unRepaired = await validator.validate('mock-graph', scopedMock, { autoRepair: false });
      expect(unRepaired.valid).toBe(false);
      const cycleIssue = unRepaired.issues.find((i) => i.type === 'causal_cycle');
      expect(cycleIssue).toBeDefined();

      // 2. With auto-repair: cycle is broken
      const repaired = await validator.validate('mock-graph', scopedMock, { autoRepair: true });
      expect(repaired.repaired).toBe(true);
      expect(repaired.repairsApplied?.some((r) => r.includes('break cycle'))).toBe(true);

      // Verify that after auto-repair, no cycle remains
      const postReport = await validator.validate('mock-graph', scopedMock, { autoRepair: false });
      const postCycles = postReport.issues.filter((i) => i.type === 'causal_cycle');
      expect(postCycles).toHaveLength(0);
    });

    it('auto-repairs arc containment by expanding boundaries to enclose events', async () => {
      const arc = await engine.createArc(testGraphId, {
        name: 'Classical Antiquity',
        startTime: '1000-01-01T00:00:00.000Z',
        endTime: '1100-01-01T00:00:00.000Z',
      });

      // Event at 1150 (outside arc 1000-1100) referencing arc in metadata
      await engine.createEvent(testGraphId, {
        description: 'Late Crusades event',
        timestamp: '1150-01-01T00:00:00.000Z',
        actor: 'Crusaders',
        target: 'Levant',
        metadata: { arcId: arc.id },
      });

      // Without repair: containment error
      const report = await engine.validateGraph(testGraphId);
      expect(report.valid).toBe(false);
      const containmentIssue = report.issues.find((i) => i.type === 'containment');
      expect(containmentIssue).toBeDefined();

      // With auto-repair: arc boundaries expanded
      const repairedReport = await engine.validateGraph(testGraphId, false, true);
      expect(repairedReport.repaired).toBe(true);
      expect(repairedReport.repairsApplied?.some((r) => r.includes('Expanded arc'))).toBe(true);

      // Verify arc end_time was expanded
      const updatedArc = await engine.getArc(testGraphId, arc.id);
      expect(new Date(updatedArc.endTime).getTime()).toBeGreaterThanOrEqual(
        new Date('1150-01-01T00:00:00.000Z').getTime()
      );
    });
  });

  describe('Export Subsystem (JSON, Markdown, Graphviz DOT)', () => {
    beforeEach(async () => {
      const arc = await engine.createArc(testGraphId, {
        name: 'Space Age Arc',
        startTime: '1950-01-01T00:00:00.000Z',
        endTime: '1980-01-01T00:00:00.000Z',
      });

      const e1 = await engine.createEvent(testGraphId, {
        description: 'Yuri Gagarin orbits Earth',
        timestamp: '1961-04-12T06:07:00.000Z',
        actor: 'Soviet Union',
        target: 'Space',
        metadata: { arcId: arc.id },
      });

      const e2 = await engine.createEvent(testGraphId, {
        description: 'Apollo 11 lands on Moon',
        timestamp: '1969-07-20T20:17:00.000Z',
        actor: 'United States',
        target: 'Moon',
        metadata: { arcId: arc.id },
      });

      await engine.createCausalLink(testGraphId, {
        causeId: e1.id,
        effectId: e2.id,
        weight: 0.95,
        type: 'direct',
        reasoning: 'Space Race escalation triggered Moon landing program',
      });
    });

    it('exports standard Althistory JSON schema with checksum and full entity counts', async () => {
      const result = await engine.exportGraph(testGraphId, 'json');
      expect(result.format).toBe('json');
      expect(result.content).toBeDefined();

      const parsed = JSON.parse(result.content || '{}');
      expect(parsed.version).toBe('1.0');
      expect(parsed.metadata.graphId).toBe(testGraphId);
      expect(parsed.metadata.checksum).toBeDefined();
      expect(parsed.data.events).toHaveLength(2);
      expect(parsed.data.arcs).toHaveLength(1);
      expect(parsed.data.causalRelationships).toHaveLength(1);
    });

    it('exports LLM-optimized Markdown with narrative arcs table and chronological timeline', async () => {
      const result = await engine.exportGraph(testGraphId, 'markdown');
      expect(result.format).toBe('markdown');
      expect(result.content).toContain('# Timeline Context');
      expect(result.content).toContain('## Narrative Arcs');
      expect(result.content).toContain('Space Age Arc');
      expect(result.content).toContain('## Chronological Events');
      expect(result.content).toContain('Yuri Gagarin orbits Earth');
      expect(result.content).toContain('Apollo 11 lands on Moon');
      expect(result.content).toContain('## Causal Link Details');
    });

    it('exports Graphviz DOT syntax with clusters and causal edges', async () => {
      const result = await engine.exportGraph(testGraphId, 'dot');
      expect(result.format).toBe('dot');
      expect(result.content).toContain('digraph');
      expect(result.content).toContain('subgraph "cluster_');
      expect(result.content).toContain('Yuri Gagarin');
      expect(result.content).toContain('->');
    });

    it('writes export to disk when outputPath is supplied', async () => {
      const filePath = path.join(tempDir, 'exported-timeline.md');
      const result = await engine.exportGraph(testGraphId, 'markdown', filePath);
      expect(result.outputPath).toBe(filePath);
      expect(fs.existsSync(filePath)).toBe(true);

      const diskContent = fs.readFileSync(filePath, 'utf8');
      expect(diskContent).toContain('Space Age Arc');
      expect(result.bytesWritten).toBe(Buffer.byteLength(diskContent, 'utf8'));
    });
  });

  describe('Import Subsystem', () => {
    it('imports graph from exported JSON file with strategy: skip', async () => {
      await engine.createEvent(testGraphId, {
        description: 'Genesis Event',
        timestamp: '1900-01-01T00:00:00.000Z',
      });
      const exportRes = await engine.exportGraph(testGraphId, 'json');

      const jsonPath = path.join(tempDir, 'export-to-import.json');
      fs.writeFileSync(jsonPath, exportRes.content!, 'utf8');

      // Create a target graph using engine
      const targetGraph = await engine.createGraph('Import Target Graph');

      const importResult = await engine.importGraph(jsonPath, {
        strategy: 'skip',
        graphId: targetGraph.id,
      });

      expect(importResult.graphId).toBe(targetGraph.id);
      expect(importResult.imported.events).toBe(1);

      // Re-importing same file with skip should skip the duplicate
      const secondImport = await engine.importGraph(jsonPath, {
        strategy: 'skip',
        graphId: targetGraph.id,
      });
      expect(secondImport.skipped.events).toBe(1);
      expect(secondImport.conflicts).toBe(1);

      await engine.deleteGraph(targetGraph.id);
    });

    it('imports with strategy: rename to avoid ID collisions', async () => {
      const evt = await engine.createEvent(testGraphId, {
        description: 'Original Collision Event',
        timestamp: '1920-01-01T00:00:00.000Z',
      });
      const exportRes = await engine.exportGraph(testGraphId, 'json');

      // Import back into the same graph using strategy 'rename'
      const importResult = await engine.importGraph(exportRes.content!, {
        strategy: 'rename',
        graphId: testGraphId,
      });

      expect(importResult.conflicts).toBe(1);
      expect(importResult.imported.events).toBe(1);

      // Verify graph now has 2 events (original + renamed)
      const allEvents = await engine.listEvents(testGraphId);
      expect(allEvents.length).toBe(2);
      expect(allEvents.some((e) => e.id === evt.id)).toBe(true);
    });
  });

  describe('End-to-End CLI Runner Execution', () => {
    it('executes validate command via CLI runner and returns VALIDATION_FAILED on invalid graph', async () => {
      // Create initially ordered pair then invert timestamp to introduce paradox
      const e1 = await engine.createEvent(testGraphId, {
        description: 'Initial Event',
        timestamp: '2010-01-01T00:00:00.000Z',
      });
      const e2 = await engine.createEvent(testGraphId, {
        description: 'Subsequent Event',
        timestamp: '2020-01-01T00:00:00.000Z',
      });
      await engine.createCausalLink(testGraphId, { causeId: e1.id, effectId: e2.id });
      await engine.updateEvent(testGraphId, e1.id, { timestamp: '2030-01-01T00:00:00.000Z' });

      const exitCode = await runCLI([
        'node',
        'althistory',
        'validate',
        testGraphId,
        '--direct',
        '--json',
      ]);

      expect(exitCode).toBe(ExitCode.VALIDATION_FAILED);
    });

    it('executes export command via CLI runner to stdout', async () => {
      const exitCode = await runCLI([
        'node',
        'althistory',
        'export',
        testGraphId,
        '--format',
        'json',
        '--direct',
        '--json',
      ]);

      expect(exitCode).toBe(ExitCode.SUCCESS);
    });
  });
});
