import {
  HealthInfo,
  GraphSummaryDto,
  EventDto,
  ArcDto,
  CausalRelationshipDto,
  IngestTextOptions,
  IngestUrlOptions,
  IngestWikidataOptions,
  IngestResultDto,
  GenerateTimelineOptions,
  GenerateBranchOptions,
  GenerateExpandOptions,
  GenerateSimulateOptions,
  GenerationResultDto,
  ValidationReportDto,
  ExportFormat,
  ExportResultDto,
  ImportResultDto,
} from '../types';
import type { CalendarInput } from '../../models/Graph';

/**
 * What a caller can ask of a generation run: to hear how it is going, and to be
 * able to stop it. A run writes as it goes, so what was written when it is
 * stopped stays written.
 */
export interface GenerationRunHooks {
  onProgress?: (progress: {
    /** 0 to 100. */
    progress: number;
    phase: string;
    /** One line a person can read: "Writing events (3 of 8)". */
    message: string;
    graphId?: string;
    source?: 'model' | 'template';
  }) => void;
  /** Aborting asks the run to stop before its next write. */
  signal?: AbortSignal;
}

export interface IEngine {
  readonly mode: 'direct' | 'remote';

  // System
  getHealth(): Promise<HealthInfo>;
  shutdown(): Promise<void>;
  /**
   * Write what this engine holds in memory to the files it works on, without
   * closing anything. Only an engine that works on the files has anything to
   * flush; a remote one has nothing in memory.
   */
  flush?(): Promise<void>;

  // Graph CRUD & Versioning
  listGraphs(): Promise<GraphSummaryDto[]>;
  createGraph(name: string, description?: string, calendar?: CalendarInput): Promise<GraphSummaryDto>;
  /** Give a graph its own calendars (a set, or the earlier form), or remove them with `null`. */
  setGraphCalendar(id: string, calendar: CalendarInput | null): Promise<GraphSummaryDto>;
  getGraph(id: string): Promise<GraphSummaryDto>;
  branchGraph(id: string, name: string): Promise<GraphSummaryDto>;
  mergeGraph(sourceId: string, targetId: string, strategy?: string): Promise<{ success: boolean; version?: string }>;
  diffGraph(sourceId: string, targetId: string): Promise<Record<string, unknown>>;
  rollbackGraph(id: string, version: string): Promise<{ success: boolean; currentVersion: string }>;
  deleteGraph(id: string): Promise<void>;

  // Event CRUD
  createEvent(graphId: string, data: { description: string; timestamp: string; actor?: string; target?: string; importance?: number; metadata?: Record<string, unknown> }): Promise<EventDto>;
  listEvents(graphId: string, filters?: { actor?: string; from?: string; to?: string }): Promise<EventDto[]>;
  getEvent(graphId: string, eventId: string): Promise<EventDto>;
  updateEvent(graphId: string, eventId: string, data: Partial<{ description: string; timestamp: string; actor?: string; target?: string }>): Promise<EventDto>;
  deleteEvent(graphId: string, eventId: string): Promise<void>;

  // Arc CRUD
  createArc(graphId: string, data: { name: string; startTime: string; endTime: string; description?: string; parentArcId?: string }): Promise<ArcDto>;
  listArcs(graphId: string): Promise<ArcDto[]>;
  getArc(graphId: string, arcId: string): Promise<ArcDto>;
  deleteArc(graphId: string, arcId: string): Promise<void>;
  /** Put an event inside an arc, by recording the arc on the event. */
  assignEventToArc(graphId: string, eventId: string, arcId: string): Promise<EventDto>;

  // Causal Relationships
  createCausalLink(graphId: string, data: { causeId: string; effectId: string; weight?: number; type?: string; reasoning?: string }): Promise<CausalRelationshipDto>;
  listCausalLinks(graphId: string): Promise<CausalRelationshipDto[]>;
  deleteCausalLink(graphId: string, causeId: string, effectId: string): Promise<void>;
  findCausalPaths(graphId: string, fromId: string, toId: string): Promise<{ paths: string[][]; count: number }>;

  // Ingestion & Generation
  ingestText(graphId: string | undefined, text: string, options: IngestTextOptions): Promise<IngestResultDto>;
  ingestUrl(graphId: string | undefined, url: string, options: IngestUrlOptions): Promise<IngestResultDto>;
  ingestWikidata(graphId: string | undefined, options: IngestWikidataOptions): Promise<IngestResultDto>;
  generateTimeline(options: GenerateTimelineOptions, hooks?: GenerationRunHooks): Promise<GenerationResultDto>;
  generateBranch(options: GenerateBranchOptions, hooks?: GenerationRunHooks): Promise<GenerationResultDto>;
  generateExpand(options: GenerateExpandOptions, hooks?: GenerationRunHooks): Promise<GenerationResultDto>;
  generateSimulate(options: GenerateSimulateOptions): Promise<GenerationResultDto>;

  // Validation & Export
  validateGraph(graphId: string, strict?: boolean, autoRepair?: boolean): Promise<ValidationReportDto>;
  exportGraph(graphId: string, format?: ExportFormat, outputPath?: string): Promise<ExportResultDto>;
  importGraph(contentOrPath: string, options?: { strategy?: 'skip' | 'overwrite' | 'rename'; graphId?: string }): Promise<ImportResultDto>;
}
