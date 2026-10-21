/**
 * Reading an Althistory export document back into the CLI's object model.
 *
 * The daemon serves an export document (`GET /api/export`), and the CLI
 * exports the same document shape from `GraphExporter`. The remote engine
 * therefore receives a document rather than model instances, and the text
 * formats (Markdown, Graphviz DOT, GraphML) have to be rendered from it.
 *
 * The document is untrusted input: it comes from a remote process. Every field
 * is therefore narrowed before use, and a document that does not have the
 * expected shape is rejected rather than silently producing an empty export.
 */

import { Event } from '@/models/Event';
import { Arc } from '@/models/Arc';
import { ExportRelationship } from './GraphExporter';

export interface ParsedExportDocument {
  graphId: string;
  graphName: string;
  description: string | undefined;
  events: Event[];
  arcs: Arc[];
  relationships: ExportRelationship[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function readOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function readNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function readMetadata(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
}

/**
 * Parse an export document into the objects the exporters render.
 *
 * Throws when the document is not an export document at all, so a caller can
 * tell "the daemon answered with something else" (an async export job, an
 * error envelope) from "the daemon answered with an empty graph".
 */
export function parseExportDocument(document: unknown): ParsedExportDocument {
  if (!isRecord(document)) {
    throw new Error('Export response is not an export document');
  }

  const data = isRecord(document.data) ? document.data : undefined;
  if (!data) {
    throw new Error('Export response has no "data" section');
  }

  const metadata = isRecord(document.metadata) ? document.metadata : {};

  const rawEvents = Array.isArray(data.events) ? data.events : [];
  const rawArcs = Array.isArray(data.arcs) ? data.arcs : [];
  const rawRelationships = Array.isArray(data.causalRelationships) ? data.causalRelationships : [];

  const events: Event[] = [];
  for (const raw of rawEvents) {
    if (!isRecord(raw)) continue;
    const id = readString(raw.id);
    if (!id) continue;
    events.push(
      new Event({
        id,
        description: readString(raw.description, 'Untitled event'),
        actor: readString(raw.actor, 'Unknown'),
        target: readString(raw.target, 'Unknown'),
        timestamp: new Date(readString(raw.timestamp)),
        metadata: readMetadata(raw.metadata),
      })
    );
  }

  const arcs: Arc[] = [];
  for (const raw of rawArcs) {
    if (!isRecord(raw)) continue;
    const id = readString(raw.id);
    if (!id) continue;
    const start = new Date(readString(raw.start_time));
    const end = new Date(readString(raw.end_time));
    // An arc whose bounds are unusable cannot be rendered; it is dropped and
    // the export says so through the count it reports.
    if (isNaN(start.getTime()) || isNaN(end.getTime())) continue;
    const metadata = readMetadata(raw.metadata);
    if (readOptionalString(raw.parent_arc_id) && metadata) {
      metadata.parent_arc_id = raw.parent_arc_id;
    }
    arcs.push(
      new Arc({
        id,
        name: readString(raw.name, 'Untitled arc'),
        description: readString(raw.description),
        start_time: start,
        end_time: end,
        level: readNumber(raw.level, 0),
        metadata,
      })
    );
  }

  const relationships: ExportRelationship[] = [];
  for (const raw of rawRelationships) {
    if (!isRecord(raw)) continue;
    const causeId = readString(raw.cause_event_id);
    const effectId = readString(raw.effect_event_id);
    if (!causeId || !effectId) continue;
    relationships.push({
      id: readString(raw.id, `${causeId}->${effectId}`),
      cause_event_id: causeId,
      effect_event_id: effectId,
      weight: readNumber(raw.weight, 1),
      confidence: readNumber(raw.confidence, 1),
      evidence: readString(raw.evidence),
      relationship_type: readString(raw.relationship_type, 'direct'),
    });
  }

  return {
    graphId: readString(metadata.graphId),
    graphName: readString(metadata.graphName),
    description: readOptionalString(metadata.description),
    events,
    arcs,
    relationships,
  };
}
