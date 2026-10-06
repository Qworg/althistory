/**
 * Web ingestion services (spec Req 7-10).
 *
 * Exports the extractor contract, the concrete extractors, the HTTP boundary
 * and the orchestrator that feeds the existing import pipeline.
 */

export * from './types';
export * from './http';
export * from './ids';
export * from './text-patterns';
export * from './TextExtractor';
export * from './WikipediaExtractor';
export * from './WikidataExtractor';
export * from './IngestionOrchestrator';
