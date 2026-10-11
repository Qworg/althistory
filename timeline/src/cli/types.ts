/**
 * Types and interfaces for the Althistory CLI.
 */

import type { SimulationDomain } from '@/services/SimulationService';


export type OutputFormat = 'json' | 'ndjson' | 'markdown' | 'plain';

export interface GlobalCLIOptions {
  json?: boolean;
  ndjson?: boolean;
  plain?: boolean;
  markdown?: boolean;
  direct?: boolean;
  url?: string;
  apiKey?: string;
  quiet?: boolean;
  verbose?: boolean;
}

export interface CLIResponseEnvelope<T> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
  meta: {
    mode: 'direct' | 'remote';
    timestamp: string;
    durationMs?: number;
    graphId?: string;
  };
}

export interface HealthInfo {
  status: 'healthy' | 'unhealthy' | 'degraded';
  mode: 'local' | 'cloud';
  executionMode: 'direct' | 'remote';
  uptimeSeconds?: number;
  activeGraph?: string;
  graphsCount?: number;
}

export interface GraphSummaryDto {
  id: string;
  name: string;
  description?: string;
  currentVersion: string;
  parentGraphId?: string;
  branchPointVersion?: string;
  createdAt: string;
  updatedAt: string;
  eventCount?: number;
  arcCount?: number;
  relationshipCount?: number;
}

export interface EventDto {
  id: string;
  graphId: string;
  description: string;
  timestamp: string;
  actor?: string;
  target?: string;
  importance?: number;
  metadata?: Record<string, unknown>;
  createdAt?: string;
  updatedAt?: string;
}

export interface ArcDto {
  id: string;
  graphId: string;
  name: string;
  description?: string;
  startTime: string;
  endTime: string;
  parentArcId?: string;
  level?: number;
  eventIds?: string[];
}

export interface CausalRelationshipDto {
  id: string;
  graphId: string;
  causeId: string;
  effectId: string;
  weight?: number;
  type?: string;
  reasoning?: string;
  confidence?: number;
  isCrossGraph?: boolean;
  causeGraphId?: string;
  effectGraphId?: string;
}

export interface ValidationIssueDto {
  type: 'temporal' | 'containment' | 'causal_direction' | 'causal_cycle' | 'orphan_reference';
  severity: 'error' | 'warning';
  message: string;
  entityId?: string;
  entityType?: 'event' | 'arc' | 'relationship';
  details?: Record<string, unknown>;
}

export interface ValidationReportDto {
  valid: boolean;
  graphId: string;
  errorCount: number;
  warningCount: number;
  issues: ValidationIssueDto[];
  repaired?: boolean;
  repairsApplied?: string[];
}

export interface ExportResultDto {
  graphId: string;
  format: 'json' | 'markdown' | 'dot';
  content?: string;
  outputPath?: string;
  bytesWritten?: number;
}

export interface ImportResultDto {
  graphId: string;
  imported: {
    events: number;
    arcs: number;
    relationships: number;
  };
  skipped: {
    events: number;
    arcs: number;
    relationships: number;
  };
  conflicts: number;
  strategy: 'skip' | 'overwrite' | 'rename';
}

export interface IngestTextOptions {
  mode?: 'pattern' | 'llm' | 'hybrid';
  provider?: 'openai' | 'anthropic';
  model?: string;
  temperature?: number;
  groupArcs?: boolean;
  inferCauses?: boolean;
  minConfidence?: number;
  dryRun?: boolean;
  graphName?: string;
}

export interface IngestUrlOptions {
  followLinks?: boolean;
  depth?: number;
  maxPages?: number;
  filter?: string;
  groupArcs?: boolean;
  inferCauses?: boolean;
  minConfidence?: number;
  dryRun?: boolean;
  graphName?: string;
}

export interface IngestWikidataOptions {
  preset?: string;
  sparql?: string;
  limit?: number;
  groupArcs?: boolean;
  inferCauses?: boolean;
  minConfidence?: number;
  dryRun?: boolean;
  graphName?: string;
}

export interface IngestResultDto {
  graphId: string;
  eventsCreated: number;
  arcsCreated: number;
  relationshipsCreated: number;
  dryRun: boolean;
  entities: {
    events: EventDto[];
    arcs: ArcDto[];
    relationships: CausalRelationshipDto[];
  };
}

export interface GenerateTimelineOptions {
  premise: string;
  divergencePoint: string;
  startDate?: string;
  endDate?: string;
  eventCount?: number;
  depth?: number;
  style?: 'academic' | 'narrative' | 'concise';
  provider?: 'openai' | 'anthropic';
  model?: string;
  temperature?: number;
  graphName?: string;
  dryRun?: boolean;
}

export interface GenerateBranchOptions {
  sourceGraphId: string;
  divergeAtEventId: string;
  counterfactualPrompt: string;
  branchName: string;
  eventCount?: number;
  provider?: 'openai' | 'anthropic';
  model?: string;
  dryRun?: boolean;
}

export interface GenerateExpandOptions {
  graphId: string;
  arcId?: string;
  timeWindow?: string;
  eventCount?: number;
  provider?: 'openai' | 'anthropic';
  model?: string;
  dryRun?: boolean;
}

export interface GenerateSimulateOptions {
  graphId: string;
  steps?: number;
  timeAdvanceMonths?: number;
  provider?: 'openai' | 'anthropic';
  model?: string;
  dryRun?: boolean;
  /** Point of divergence; defaults to the latest event in the graph. */
  anchorEventId?: string;
  /** Domain to evolve; defaults to the dominant inferred pressure. */
  domain?: SimulationDomain;
  /** 0..1 - biases causal weights and event importance. */
  aggressiveness?: number;
  /** Optional premise recorded on every generated event. */
  seedContext?: string;
}

export interface GenerationResultDto {
  graphId: string;
  graphName: string;
  premise: string;
  divergencePoint: string;
  eventCount: number;
  arcCount: number;
  relationshipCount: number;
  events: EventDto[];
  arcs: ArcDto[];
  relationships: CausalRelationshipDto[];
  validation: ValidationReportDto;
}
