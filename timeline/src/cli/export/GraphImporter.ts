import * as fs from 'fs';
import { ServiceContainer } from '@/container';
import { CausalRelationshipType } from '@/models/relationships';
import { ImportResultDto } from '../types';
import { ValidationErrorCLI } from '../utils/exitCodes';

export class GraphImporter {
  async import(
    contentOrPath: string,
    container: ServiceContainer,
    options?: { strategy?: 'skip' | 'overwrite' | 'rename'; graphId?: string }
  ): Promise<ImportResultDto> {
    let rawContent = contentOrPath;

    // Check if input is a file path
    if (fs.existsSync(contentOrPath)) {
      rawContent = await fs.promises.readFile(contentOrPath, 'utf8');
    }

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(rawContent) as Record<string, unknown>;
    } catch {
      throw new ValidationErrorCLI('Import content must be valid JSON');
    }

    const strategy = options?.strategy || 'skip';

    // Extract entities from either AlthistoryExport shape or flat shape
    const dataObj = (parsed.data as Record<string, unknown> | undefined) || parsed;
    const metadataObj = parsed.metadata as Record<string, unknown> | undefined;

    const events = (dataObj.events as Array<Record<string, unknown>> | undefined) || [];
    const arcs = (dataObj.arcs as Array<Record<string, unknown>> | undefined) || [];
    const rels = (dataObj.causalRelationships as Array<Record<string, unknown>> | undefined) || [];

    // Resolve target graph
    let targetGraphId = options?.graphId;
    if (!targetGraphId) {
      if (metadataObj?.graphId && typeof metadataObj.graphId === 'string') {
        const existing = await container.graphRepository.findById(metadataObj.graphId);
        if (existing) {
          targetGraphId = existing.id;
        } else {
          // Create graph by name
          const created = await container.graphRepository.create({
            name: (metadataObj.graphName as string) || 'Imported Timeline',
            description: (metadataObj.description as string) || 'Imported from file',
          });
          targetGraphId = created.id;
        }
      } else {
        const created = await container.graphRepository.create({
          name: (metadataObj?.graphName as string) || 'Imported Timeline',
          description: (metadataObj?.description as string) || 'Imported from file',
        });
        targetGraphId = created.id;
      }
    }

    const scoped = await container.graphScopedRepositories(targetGraphId);
    const idMap = new Map<string, string>();

    const imported = { events: 0, arcs: 0, relationships: 0 };
    const skipped = { events: 0, arcs: 0, relationships: 0 };
    let conflicts = 0;

    // 1. Process Arcs
    for (const arcData of arcs) {
      const origId = String(arcData.id || '');
      if (!origId) continue;

      const existing = await scoped.arcRepository.findById(origId);
      if (existing) {
        conflicts++;
        if (strategy === 'skip') {
          skipped.arcs++;
          continue;
        } else if (strategy === 'overwrite') {
          await scoped.arcRepository.update(origId, {
            name: String(arcData.name || ''),
            description: arcData.description ? String(arcData.description) : undefined,
            start_time: new Date(String(arcData.start_time)),
            end_time: new Date(String(arcData.end_time)),
            level: typeof arcData.level === 'number' ? arcData.level : 0,
            metadata: (arcData.metadata as Record<string, unknown>) || {},
          });
          imported.arcs++;
          continue;
        } else if (strategy === 'rename') {
          const newId = `arc_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
          idMap.set(origId, newId);
          await scoped.arcRepository.create({
            id: newId,
            name: String(arcData.name || ''),
            description: arcData.description ? String(arcData.description) : undefined,
            start_time: new Date(String(arcData.start_time)),
            end_time: new Date(String(arcData.end_time)),
            level: typeof arcData.level === 'number' ? arcData.level : 0,
            metadata: (arcData.metadata as Record<string, unknown>) || {},
          });
          imported.arcs++;
          continue;
        }
      } else {
        await scoped.arcRepository.create({
          id: origId,
          name: String(arcData.name || ''),
          description: arcData.description ? String(arcData.description) : undefined,
          start_time: new Date(String(arcData.start_time)),
          end_time: new Date(String(arcData.end_time)),
          level: typeof arcData.level === 'number' ? arcData.level : 0,
          metadata: (arcData.metadata as Record<string, unknown>) || {},
        });
        imported.arcs++;
      }
    }

    // 2. Process Events
    for (const evtData of events) {
      const origId = String(evtData.id || '');
      if (!origId) continue;

      const existing = await scoped.eventRepository.findById(origId);
      const meta = { ...((evtData.metadata as Record<string, unknown>) || {}) };
      if (meta.arcId && idMap.has(String(meta.arcId))) {
        meta.arcId = idMap.get(String(meta.arcId));
      }

      if (existing) {
        conflicts++;
        if (strategy === 'skip') {
          skipped.events++;
          continue;
        } else if (strategy === 'overwrite') {
          await scoped.eventRepository.update(origId, {
            description: String(evtData.description || ''),
            timestamp: new Date(String(evtData.timestamp)),
            actor: String(evtData.actor || 'Unknown'),
            target: String(evtData.target || 'None'),
            metadata: meta,
          });
          imported.events++;
          continue;
        } else if (strategy === 'rename') {
          const newId = `evt_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
          idMap.set(origId, newId);
          await scoped.eventRepository.create({
            id: newId,
            description: String(evtData.description || ''),
            timestamp: new Date(String(evtData.timestamp)),
            actor: String(evtData.actor || 'Unknown'),
            target: String(evtData.target || 'None'),
            metadata: meta,
          });
          imported.events++;
          continue;
        }
      } else {
        await scoped.eventRepository.create({
          id: origId,
          description: String(evtData.description || ''),
          timestamp: new Date(String(evtData.timestamp)),
          actor: String(evtData.actor || 'Unknown'),
          target: String(evtData.target || 'None'),
          metadata: meta,
        });
        imported.events++;
      }
    }

    // 3. Process Causal Relationships
    const existingRels = await scoped.causalService.getAllRelationships();
    for (const relData of rels) {
      let causeId = String(relData.cause_event_id || '');
      let effectId = String(relData.effect_event_id || '');

      if (idMap.has(causeId)) causeId = idMap.get(causeId)!;
      if (idMap.has(effectId)) effectId = idMap.get(effectId)!;

      const causeExists = await scoped.eventRepository.findById(causeId);
      const effectExists = await scoped.eventRepository.findById(effectId);

      if (!causeExists || !effectExists) {
        skipped.relationships++;
        continue;
      }

      const existingRel = existingRels.find(
        (r) => r.cause_event_id === causeId && r.effect_event_id === effectId
      );

      const relType: CausalRelationshipType =
        relData.relationship_type === 'indirect' || relData.relationship_type === 'contributory'
          ? relData.relationship_type
          : 'direct';

      if (existingRel) {
        conflicts++;
        if (strategy === 'skip') {
          skipped.relationships++;
          continue;
        } else if (strategy === 'overwrite') {
          try {
            await scoped.causalService.deleteCausalLink(causeId, effectId);
            await scoped.causalService.createCausalLink(causeExists, effectExists, {
              weight: typeof relData.weight === 'number' ? relData.weight : 0.8,
              confidence: typeof relData.confidence === 'number' ? relData.confidence : 0.8,
              evidence: String(relData.evidence || 'Imported causal relationship'),
              relationship_type: relType,
            });
            imported.relationships++;
          } catch {
            skipped.relationships++;
          }
        } else if (strategy === 'rename') {
          // Already mapped; skip duplicate
          skipped.relationships++;
        }
      } else {
        try {
          await scoped.causalService.createCausalLink(causeExists, effectExists, {
            weight: typeof relData.weight === 'number' ? relData.weight : 0.8,
            confidence: typeof relData.confidence === 'number' ? relData.confidence : 0.8,
            evidence: String(relData.evidence || 'Imported causal relationship'),
            relationship_type: relType,
          });
          imported.relationships++;
        } catch {
          conflicts++;
          skipped.relationships++;
        }
      }
    }

    return {
      graphId: targetGraphId,
      imported,
      skipped,
      conflicts,
      strategy,
    };
  }
}
