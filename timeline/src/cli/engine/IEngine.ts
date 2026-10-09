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
  GenerationResultDto,
  ValidationReportDto,
} from '../types';

export interface IEngine {
  readonly mode: 'direct' | 'remote';

  // System
  getHealth(): Promise<HealthInfo>;
  shutdown(): Promise<void>;

  // Graph CRUD & Versioning
  listGraphs(): Promise<GraphSummaryDto[]>;
  createGraph(name: string, description?: string): Promise<GraphSummaryDto>;
  getGraph(id: string): Promise<GraphSummaryDto>;
  branchGraph(id: string, name: string): Promise<GraphSummaryDto>;
  mergeGraph(sourceId: string, targetId: string, strategy?: string): Promise<{ success: boolean; version?: string }>;
  rollbackGraph(id: string, version: string): Promise<{ success: boolean; currentVersion: string }>;
  deleteGraph(id: string): Promise<void>;

  // Event CRUD
  createEvent(graphId: string, data: { description: string; timestamp: string; actor?: string; target?: string; importance?: number }): Promise<EventDto>;
  listEvents(graphId: string, filters?: { actor?: string; from?: string; to?: string }): Promise<EventDto[]>;
  getEvent(graphId: string, eventId: string): Promise<EventDto>;
  updateEvent(graphId: string, eventId: string, data: Partial<{ description: string; timestamp: string; actor?: string; target?: string }>): Promise<EventDto>;
  deleteEvent(graphId: string, eventId: string): Promise<void>;

  // Arc CRUD
  createArc(graphId: string, data: { name: string; startTime: string; endTime: string; description?: string; parentArcId?: string }): Promise<ArcDto>;
  listArcs(graphId: string): Promise<ArcDto[]>;

  // Causal Relationships
  createCausalLink(graphId: string, data: { causeId: string; effectId: string; weight?: number; type?: string; reasoning?: string }): Promise<CausalRelationshipDto>;
  listCausalLinks(graphId: string): Promise<CausalRelationshipDto[]>;
  findCausalPaths(graphId: string, fromId: string, toId: string): Promise<{ paths: string[][]; count: number }>;

  // Ingestion & Generation
  ingestText(graphId: string | undefined, text: string, options: IngestTextOptions): Promise<IngestResultDto>;
  ingestUrl(graphId: string | undefined, url: string, options: IngestUrlOptions): Promise<IngestResultDto>;
  ingestWikidata(graphId: string | undefined, options: IngestWikidataOptions): Promise<IngestResultDto>;
  generateTimeline(options: GenerateTimelineOptions): Promise<GenerationResultDto>;
  generateBranch(options: GenerateBranchOptions): Promise<GenerationResultDto>;

  // Validation & Export
  validateGraph(graphId: string, strict?: boolean, autoRepair?: boolean): Promise<ValidationReportDto>;
  exportGraph(graphId: string, format: string): Promise<string>;
  importGraph(content: string, options?: { strategy?: 'skip' | 'overwrite' | 'rename' }): Promise<{ success: boolean; count: number }>;
}
