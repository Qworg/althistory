/**
 * The parent an arc edit names (issue 26, fifth review).
 *
 * An arc records its parent in `metadata.parentArcId` when the CLI, MCP or
 * the generator made it, and a PUT or a batch `update_arc` moves any arc by
 * naming one there; the export then reads it as `parent_arc_id`. Nothing
 * checked the arc it names, so an arc could be given itself, one of its own
 * descendants, or an arc that does not exist, and the export no longer
 * validated. `PUT /api/arcs/:id` and the batch step refuse those with a 400.
 *
 * Only a parent the edit changes is checked: an edit that resends the arc's
 * metadata as it is, or that moves the arc to the top level (where the parent
 * is cleared), is not refused for what it already held.
 */

import type { ResolvedGraphData } from '@/repositories/VersionRepository';
import type { ArcRepository } from '@/repositories/ArcRepository';
import { ValidationError } from '@/utils/errors';

interface ParentCheckContext {
  arcRepository: Pick<ArcRepository, 'findById'>;
  /** The graph's head, for the parents only it records (an imported arc's `parent_arc_id`); read only when needed. */
  head: () => Promise<ResolvedGraphData>;
}

function recordedParent(metadata: unknown): string | undefined {
  const value = metadata && typeof metadata === 'object' ? (metadata as Record<string, unknown>).parentArcId : undefined;
  return typeof value === 'string' && value !== '' ? value : undefined;
}

/** Refuse a parent the update names that is the arc itself, below it, or no arc of the graph. */
export async function checkNamedParent(arcId: string, updates: Record<string, unknown>, context: ParentCheckContext): Promise<void> {
  const named = recordedParent(updates.metadata);
  if (!named) return;
  const existing = await context.arcRepository.findById(arcId);
  if (!existing) return; // The update reports the missing arc itself.
  if (named === recordedParent(existing.metadata)) return;
  const level = typeof updates.level === 'number' ? updates.level : existing.level;
  if (level === 0) return; // A top-level arc's parent is cleared (ArcRepository.update).

  const refuse = (why: string): never => {
    throw new ValidationError(`metadata.parentArcId: ${why}`, 'metadata.parentArcId', named);
  };
  if (named === arcId) refuse('an arc cannot be its own parent');
  if (!(await context.arcRepository.findById(named))) refuse(`no arc "${named}" in this graph`);

  // Walk up from the named parent: reaching this arc means it is one of its descendants.
  let head: ResolvedGraphData | undefined;
  const parentOf = async (id: string): Promise<string | undefined> => {
    const live = recordedParent((await context.arcRepository.findById(id))?.metadata);
    if (live) return live;
    head ??= await context.head();
    const field = head.arcs[id]?.parent_arc_id;
    return typeof field === 'string' && field !== '' ? field : recordedParent(head.arcs[id]?.metadata);
  };
  const seen = new Set<string>();
  for (let current: string | undefined = named; current && !seen.has(current); current = await parentOf(current)) {
    if (current === arcId) refuse(`"${named}" is inside this arc, so it cannot be its parent`);
    seen.add(current);
  }
}
