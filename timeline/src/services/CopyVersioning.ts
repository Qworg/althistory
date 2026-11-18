import type { Container } from '@/container';
import type { EntityChanges } from '@/repositories/VersionRepository';

/**
 * Give a copied graph the version a branch gets (#35): the source's version head, recorded as
 * the copy's first version, before the live store is written.
 *
 * A branch commits `checkout(source)` as one `branch` version. A copy takes the same head, so what
 * the copy's history holds is what the source's holds, to the field: `parent_arc_id`, `sourceRef`,
 * a link at weight 0, a link to another graph's event. Rebuilding it from the live store lost
 * those, because the live store keeps less than the version store does. A full copy takes the
 * whole head; a time-range or filtered copy takes the head limited to the ids that were copied
 * (`selected`), and a link only when both its events are among them.
 *
 * Done first, so a copy that cannot be versioned has written nothing to the live store, and the
 * caller can remove the empty graph. Pressures are not versioned: a copy gives them new ids and
 * the inference recomputes them. A source with no versions yields no version.
 */
export async function versionCopyFromHead(
  container: Pick<Container, 'graphRepository'>,
  sourceGraphId: string,
  targetGraphId: string,
  sourceName: string,
  selected: ReadonlySet<string> | null
): Promise<void> {
  const head = await container.graphRepository.checkout(sourceGraphId);
  const keep = (id: string): boolean => selected === null || selected.has(id);
  const changes: EntityChanges = { added: [], modified: [], deleted: [] };

  for (const [id, data] of Object.entries(head.events)) {
    if (keep(id)) changes.added.push({ type: 'event', id, data });
  }
  for (const [id, data] of Object.entries(head.arcs)) {
    if (keep(id)) changes.added.push({ type: 'arc', id, data });
  }
  for (const [id, data] of Object.entries(head.relationships)) {
    const cause = String(data.cause_event_id);
    const effect = String(data.effect_event_id);
    if (selected === null || (selected.has(cause) && selected.has(effect))) {
      changes.added.push({ type: 'relationship', id, data });
    }
  }

  if (changes.added.length === 0) return;
  await container.graphRepository.commitChanges(targetGraphId, changes, 'branch', `Copied from ${sourceName}`);
}
