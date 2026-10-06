/**
 * Shared models and the extractor contract for web ingestion (spec Req 7-10).
 *
 * These types mirror the "Ingestion Models" section of
 * `.kiro/specs/input-output-system/design.md`. They are deliberately kept
 * independent of Express and of the import pipeline so every source can be
 * exercised against recorded fixtures without a network call.
 */

import { DataSource } from '../ExportService';

/** Which source produced an extracted entity. */
export type ExtractionSourceType = 'wikipedia' | 'wikidata' | 'text' | 'llm';

/** Where an entity came from, recorded on every extracted entity. */
export interface ExtractionSource {
  type: ExtractionSourceType;
  url?: string;
  articleTitle?: string;
  wikidataId?: string;
  extractedAt: string;
}

export interface ExtractedEvent {
  tempId: string;
  description: string;
  actor: string;
  target: string;
  timestamp: string;
  confidence: number;
  source: ExtractionSource;
  /** Whether the reviewer has selected this entity for import. */
  selected: boolean;
  /** Whether the reviewer changed any field. */
  edited: boolean;
}

export interface ExtractedArc {
  tempId: string;
  name: string;
  description: string;
  start_time: string;
  end_time: string;
  level: number;
  confidence: number;
  source: ExtractionSource;
  selected: boolean;
  edited: boolean;
}

export interface ExtractedRelationship {
  tempId: string;
  causeEventTempId: string;
  effectEventTempId: string;
  weight: number;
  confidence: number;
  reasoning: string;
  source: ExtractionSource;
  selected: boolean;
}

export interface ExtractionResult {
  events: ExtractedEvent[];
  arcs: ExtractedArc[];
  relationships: ExtractedRelationship[];
  sources: DataSource[];
  overallConfidence: number;
}

/** Optional hints that improve extraction accuracy (spec Req 9.4). */
export interface ExtractionContext {
  defaultTimeRange?: { start: string; end: string };
  defaultActors?: string[];
  knownEntities?: string[];
  locale?: string;
  instructions?: string;
}

export interface ValidationIssue {
  entityTempId: string;
  entityType: 'event' | 'arc' | 'relationship';
  severity: 'error' | 'warning';
  message: string;
}

/** Result of an extraction, held for review before import. */
export interface IngestionPreview {
  jobId: string;
  status: 'review';
  extraction: ExtractionResult;
  validationIssues: ValidationIssue[];
}

/**
 * A source is interchangeable behind this interface: the orchestrator selects
 * one by `sourceType` and calls `extract`. Adding a source means implementing
 * this interface, not editing the orchestrator's branches (though the request
 * union in the orchestrator still names the supported source types).
 */
export interface Extractor<TInput> {
  readonly sourceType: ExtractionSourceType;
  extract(input: TInput, context?: ExtractionContext): Promise<ExtractionResult>;
}

export interface WikipediaExtractionInput {
  url: string;
  options?: {
    followLinks?: boolean;
    /** Clamped to the spec maximum of 3. */
    linkDepth?: number;
    /** Regular expression (as a string) applied to linked article titles. */
    linkFilter?: string;
    /** Upper bound on pages fetched when link following is enabled. */
    maxPages?: number;
  };
}

export interface WikidataExtractionInput {
  queryType: 'historical-events' | 'person-timeline' | 'custom';
  parameters?: Record<string, string>;
  customQuery?: string;
  limit?: number;
}

export interface TextExtractionInput {
  text: string;
  /** Ask the configured LLM to attempt extraction first (spec Req 9.2). */
  useLLM?: boolean;
}

export type IngestionRequest =
  | { source: 'wikipedia'; wikipedia: WikipediaExtractionInput }
  | { source: 'wikidata'; wikidata: WikidataExtractionInput }
  | { source: 'text'; text: TextExtractionInput };

/** Response returned by the synchronous ingest endpoints. */
export interface IngestResponse extends IngestionPreview {
  estimatedPages?: number;
}
