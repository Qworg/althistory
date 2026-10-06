/**
 * Tests for the ingestion orchestrator: extraction dispatch, review storage,
 * validation gating, selection/edits, and conversion into the import path.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  ImportExecutor,
  IngestionJobNotFoundError,
  IngestionOrchestrator,
  IngestionValidationError,
  toAlthistoryExport,
  validateExtraction,
} from './IngestionOrchestrator';
import {
  ExtractedArc,
  ExtractedEvent,
  ExtractedRelationship,
  ExtractionResult,
  Extractor,
  TextExtractionInput,
  WikidataExtractionInput,
  WikipediaExtractionInput,
} from './types';
import { ImportOptions, ImportResult, ImportService } from '../ImportService';
import { AlthistoryExport, ExportMetadata } from '../ExportService';

function makeEvent(overrides: Partial<ExtractedEvent> = {}): ExtractedEvent {
  return {
    tempId: 'event-1',
    description: 'Event one',
    actor: 'Actor',
    target: 'Target',
    timestamp: '1066-10-14T00:00:00Z',
    confidence: 0.9,
    source: { type: 'text', extractedAt: '2020-01-01T00:00:00Z' },
    selected: true,
    edited: false,
    ...overrides,
  };
}

function makeArc(overrides: Partial<ExtractedArc> = {}): ExtractedArc {
  return {
    tempId: 'arc-1',
    name: 'Arc',
    description: 'An arc',
    start_time: '1066-01-01T00:00:00Z',
    end_time: '1067-01-01T00:00:00Z',
    level: 0,
    confidence: 0.8,
    source: { type: 'text', extractedAt: '2020-01-01T00:00:00Z' },
    selected: true,
    edited: false,
    ...overrides,
  };
}

function makeRelationship(overrides: Partial<ExtractedRelationship> = {}): ExtractedRelationship {
  return {
    tempId: 'rel-1',
    causeEventTempId: 'event-1',
    effectEventTempId: 'event-2',
    weight: 0.5,
    confidence: 0.7,
    reasoning: 'because',
    source: { type: 'text', extractedAt: '2020-01-01T00:00:00Z' },
    selected: true,
    ...overrides,
  };
}

function makeExtraction(overrides: Partial<ExtractionResult> = {}): ExtractionResult {
  return {
    events: [
      makeEvent(),
      makeEvent({ tempId: 'event-2', description: 'Event two', timestamp: '1066-12-25T00:00:00Z' }),
    ],
    arcs: [makeArc()],
    relationships: [makeRelationship()],
    sources: [
      {
        id: 'text-source',
        type: 'text-extraction',
        accessedAt: '2020-01-01T00:00:00Z',
        confidence: 0.9,
        entityIds: ['event-1', 'event-2'],
      },
    ],
    overallConfidence: 0.9,
    ...overrides,
  };
}

function makeImportExecutor(): ImportExecutor & { calls: Array<{ data: AlthistoryExport; options: ImportOptions }> } {
  const calls: Array<{ data: AlthistoryExport; options: ImportOptions }> = [];
  return {
    calls,
    initialize: vi.fn().mockResolvedValue(undefined),
    executeImport: vi.fn(async (data: AlthistoryExport, options: ImportOptions) => {
      calls.push({ data, options });
      return {
        success: true,
        graphId: options.graphId ?? 'created',
        graphVersion: 1,
        imported: { events: data.data.events.length, arcs: data.data.arcs.length, relationships: data.data.causalRelationships.length, pressures: 0 },
        skipped: { events: 0, arcs: 0, relationships: 0, pressures: 0 },
        deleted: { events: 0, arcs: 0, relationships: 0, pressures: 0 },
        errors: [],
        warnings: [],
      } satisfies ImportResult;
    }),
  };
}

function makeOrchestrator(extraction: ExtractionResult = makeExtraction()) {
  const textExtractor: Extractor<TextExtractionInput> = {
    sourceType: 'text',
    extract: vi.fn().mockResolvedValue(extraction),
  };
  const wikipediaExtractor: Extractor<WikipediaExtractionInput> = {
    sourceType: 'wikipedia',
    extract: vi.fn().mockResolvedValue(extraction),
  };
  const wikidataExtractor: Extractor<WikidataExtractionInput> = {
    sourceType: 'wikidata',
    extract: vi.fn().mockResolvedValue(extraction),
  };
  const importExecutor = makeImportExecutor();
  const orchestrator = new IngestionOrchestrator({
    extractors: { wikipedia: wikipediaExtractor, wikidata: wikidataExtractor, text: textExtractor },
    importExecutor,
    now: () => new Date('2021-01-01T00:00:00Z'),
    idFactory: () => 'job-1',
  });
  return { orchestrator, importExecutor, textExtractor };
}

describe('IngestionOrchestrator.ingest', () => {
  it('stores a review job and returns a preview', async () => {
    const { orchestrator, textExtractor } = makeOrchestrator();

    const preview = await orchestrator.ingest({ source: 'text', text: { text: 'anything' } });

    expect(textExtractor.extract).toHaveBeenCalledTimes(1);
    expect(preview.jobId).toBe('job-1');
    expect(preview.status).toBe('review');
    expect(preview.extraction.events).toHaveLength(2);
    expect(preview.validationIssues).toEqual([]);
    expect(orchestrator.getJob('job-1')?.status).toBe('review');
    expect(orchestrator.getPreview('job-1').jobId).toBe('job-1');
    expect(orchestrator.deleteJob('job-1')).toBe(true);
    expect(orchestrator.getJob('job-1')).toBeUndefined();
  });

  it('dispatches to the extractor matching the request source', async () => {
    const { orchestrator } = makeOrchestrator();
    const wikipedia = (orchestrator as unknown as { extractors: { wikipedia: Extractor<WikipediaExtractionInput> } })
      .extractors.wikipedia;
    await orchestrator.ingest({
      source: 'wikipedia',
      wikipedia: { url: 'https://en.wikipedia.org/wiki/X' },
    });
    expect(wikipedia.extract).toHaveBeenCalledTimes(1);
  });
});

describe('IngestionOrchestrator.approve', () => {
  it('imports the selected entities through the import executor', async () => {
    const { orchestrator, importExecutor } = makeOrchestrator();
    const preview = await orchestrator.ingest({ source: 'text', text: { text: 'x' } });

    const result = await orchestrator.approve(preview.jobId, { targetGraphId: 'graph-1' });

    expect(result.success).toBe(true);
    expect(importExecutor.calls).toHaveLength(1);
    const [call] = importExecutor.calls;
    expect(call.options).toMatchObject({ graphId: 'graph-1', mode: 'merge', conflictResolution: 'skip' });
    expect(call.data.data.events).toHaveLength(2);
    expect(call.data.data.arcs).toHaveLength(1);
    expect(call.data.data.causalRelationships).toHaveLength(1);
    expect(call.data.metadata.graphId).toBe('graph-1');
    expect(call.data.metadata.checksum).toMatch(/^[0-9a-f]{64}$/);
    expect(call.data.provenance?.sources[0].type).toBe('text-extraction');
    expect(orchestrator.getJob(preview.jobId)?.status).toBe('imported');
  });

  it('restricts to the approved event ids and drops dangling relationships', async () => {
    const { orchestrator, importExecutor } = makeOrchestrator();
    const preview = await orchestrator.ingest({ source: 'text', text: { text: 'x' } });
    const [first] = preview.extraction.events;

    await orchestrator.approve(preview.jobId, {
      targetGraphId: 'graph-1',
      approvedEventIds: [first.tempId],
      approvedArcIds: ['not-an-arc'],
      approvedRelationshipIds: ['rel-1'],
    });

    const [call] = importExecutor.calls;
    expect(call.data.data.events.map((event) => event.id)).toEqual([first.tempId]);
    expect(call.data.data.causalRelationships).toHaveLength(0);
    expect(call.data.data.arcs).toHaveLength(0);
  });

  it('applies reviewer edits before import', async () => {
    const { orchestrator, importExecutor } = makeOrchestrator();
    const preview = await orchestrator.ingest({ source: 'text', text: { text: 'x' } });

    await orchestrator.approve(preview.jobId, {
      targetGraphId: 'graph-1',
      edits: { 'event-1': { description: 'Edited description', actor: 'New Actor' } },
    });

    const [call] = importExecutor.calls;
    const event = call.data.data.events.find((entry) => entry.id === 'event-1');
    expect(event?.description).toBe('Edited description');
    expect(event?.actor).toBe('New Actor');
  });

  it('rejects approval when the selected subset still has validation errors', async () => {
    const invalid = makeExtraction({
      events: [makeEvent({ actor: '' })],
      relationships: [],
      arcs: [],
    });
    const { orchestrator, importExecutor } = makeOrchestrator(invalid);
    const preview = await orchestrator.ingest({ source: 'text', text: { text: 'x' } });

    await expect(orchestrator.approve(preview.jobId, { targetGraphId: 'g' })).rejects.toBeInstanceOf(
      IngestionValidationError
    );
    expect(importExecutor.calls).toHaveLength(0);
  });

  it('allows an edit to fix a validation error', async () => {
    const invalid = makeExtraction({ events: [makeEvent({ actor: '' })], relationships: [], arcs: [] });
    const { orchestrator, importExecutor } = makeOrchestrator(invalid);
    const preview = await orchestrator.ingest({ source: 'text', text: { text: 'x' } });

    await orchestrator.approve(preview.jobId, {
      targetGraphId: 'g',
      edits: { 'event-1': { actor: 'Fixed' } },
    });

    expect(importExecutor.calls).toHaveLength(1);
  });

  it('throws for an unknown job', async () => {
    const { orchestrator } = makeOrchestrator();
    await expect(orchestrator.approve('missing', {})).rejects.toBeInstanceOf(IngestionJobNotFoundError);
  });
});

describe('validateExtraction', () => {
  it('flags missing required fields, invalid timestamps and dangling relationships', () => {
    const extraction = makeExtraction({
      events: [makeEvent({ actor: '', timestamp: 'not-a-date' })],
      relationships: [makeRelationship({ effectEventTempId: 'ghost' })],
    });

    const issues = validateExtraction(extraction);
    const errors = issues.filter((issue) => issue.severity === 'error');
    expect(errors.some((issue) => issue.message.includes('actor'))).toBe(true);
    expect(errors.some((issue) => issue.message.includes('timestamp'))).toBe(true);
    expect(errors.some((issue) => issue.message.includes('effect event'))).toBe(true);
  });

  it('flags an arc whose start is after its end', () => {
    const extraction = makeExtraction({
      events: [],
      relationships: [],
      arcs: [makeArc({ start_time: '1067-01-01T00:00:00Z', end_time: '1066-01-01T00:00:00Z' })],
    });
    const errors = validateExtraction(extraction).filter((issue) => issue.severity === 'error');
    expect(errors.some((issue) => issue.message.includes('after end_time'))).toBe(true);
  });
});

describe('toAlthistoryExport', () => {
  it('produces a checksum the import validator accepts', () => {
    const service = new ImportService({ dataDir: '/tmp/unused' });
    const extraction = makeExtraction();
    const exported = toAlthistoryExport(extraction, {
      graphId: 'graph-1',
      graphName: 'Test',
      now: () => new Date('2021-01-01T00:00:00Z'),
    });

    const metadata: ExportMetadata = exported.metadata;
    expect(metadata.checksum).toMatch(/^[0-9a-f]{64}$/);
    const error = service.validateChecksum({ metadata, data: exported.data });
    expect(error).toBeNull();
  });
});
