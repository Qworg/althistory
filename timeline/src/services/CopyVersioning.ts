import type { Container } from '@/container';
import type { StoredCausalRelationship } from './CausalService';

/**
 * Give a graph that was filled by a copy a version of its own (#35).
 *
 * A copy writes the live store only; a graph with no version has nothing for
 * rollback, export or a branch to read. Branching records the copied state as a
 * single version (`GraphRepository.branch`); this does the same for a copy by
 * reading what the copy wrote and committing it as one batch through the one
 * versioning path every write uses. A copy that wrote nothing makes no version.
 */
export async function versionCopiedGraph(
  container: Pick<Container, 'graphScopedRepositories' | 'graphWriteVersioningService'>,
  graphId: string,
  sourceName: string
): Promise<void> {
  const { eventRepository, arcRepository, causalService } = await container.graphScopedRepositories(graphId);
  const [events, arcs, relationships] = await Promise.all([
    eventRepository.findAll(),
    arcRepository.findAll(),
    causalService.getAllRelationships(),
  ]);
  if (events.length + arcs.length + relationships.length === 0) return;

  const pairs = new Map<string, { cause_event_id: string; effect_event_id: string; live: StoredCausalRelationship[] }>();
  for (const link of relationships) {
    const key = `${link.cause_event_id}\u0000${link.effect_event_id}`;
    const pair = pairs.get(key) ?? { cause_event_id: link.cause_event_id, effect_event_id: link.effect_event_id, live: [] };
    pair.live.push(link as StoredCausalRelationship);
    pairs.set(key, pair);
  }

  await container.graphWriteVersioningService.recordBatch(
    graphId,
    {
      events: new Map(events.map((event) => [event.id, event])),
      arcs: new Map(arcs.map((arc) => [arc.id, arc])),
      links: [...pairs.values()],
      // The hierarchy the copy carried over, as the arc's metadata states it.
      parents: new Map(
        arcs.map((arc) => {
          const parent = arc.metadata?.parentArcId;
          return [arc.id, typeof parent === 'string' ? parent : null] as const;
        })
      ),
    },
    [],
    { announceIfNotVersioned: false, summary: `Copied from ${sourceName}` }
  );
}
