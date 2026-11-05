/**
 * The domain vocabulary shown in the "Help & reference" dialog.
 *
 * Definitions follow `frontend/PRODUCT.md` (Core domain terminology) and the
 * export format in `docs/export-format.md`; keep them short and neutral.
 */
export interface GlossaryEntry {
  id: string
  term: string
  /** Other words a reader might search for. */
  aliases?: readonly string[]
  definition: string
}

export const GLOSSARY: readonly GlossaryEntry[] = [
  {
    id: 'graph',
    term: 'Graph',
    aliases: ['timeline', 'history'],
    definition:
      'An isolated timeline history with its own events, arcs, causal links and versions. Every change applies to the active graph, which you switch from the header.',
  },
  {
    id: 'event',
    term: 'Event',
    definition:
      'A dated occurrence: a description, a timestamp, a confidence score, and who acted (the actor) on whom (the target).',
  },
  {
    id: 'arc',
    term: 'Arc',
    aliases: ['period', 'phase'],
    definition:
      'A named period with a start and an end that groups events. Arcs can nest, so a period can contain sub-periods.',
  },
  {
    id: 'actor-target',
    term: 'Actor and target',
    aliases: ['actor', 'target'],
    definition:
      'The actor is who acts in an event; the target is who is acted upon. Every event needs both. The Actor Perspective view follows one actor or target across the graph.',
  },
  {
    id: 'causal-link',
    term: 'Causal link',
    aliases: ['relationship', 'edge', 'link'],
    definition:
      'A directed relationship from a cause event to an effect event. Each link has a type (direct, indirect or contributory), a weight and a confidence.',
  },
  {
    id: 'direct',
    term: 'Direct link',
    definition: 'The cause brings about the effect without an intervening step.',
  },
  {
    id: 'indirect',
    term: 'Indirect link',
    definition: 'The cause leads to the effect through intermediate events or conditions.',
  },
  {
    id: 'contributory',
    term: 'Contributory link',
    definition: 'The cause is one of several factors that together bring about the effect.',
  },
  {
    id: 'weight',
    term: 'Weight',
    aliases: ['strength'],
    definition: 'How strongly a cause influences its effect, from 0 (negligible) to 1 (decisive).',
  },
  {
    id: 'confidence',
    term: 'Confidence',
    aliases: ['certainty', 'score'],
    definition:
      'How sure the record is, from 0 to 1. Events, causal links and inferred pressures each carry one; imported and generated material is a hypothesis until reviewed.',
  },
  {
    id: 'causal-order',
    term: 'Causal-order invariant',
    aliases: ['paradox', 'temporal paradox', 'causal order'],
    definition:
      'A cause must happen at the same moment as or before its effect (cause ≤ effect). A cause dated strictly after its effect is a temporal paradox, and both the app and the server reject it.',
  },
  {
    id: 'inferred-pressure',
    term: 'Inferred pressure',
    aliases: ['pressure', 'economic', 'social', 'political', 'environmental'],
    definition:
      'An economic, social, political or environmental pressure that the system infers from clusters of related events, shown when it clears an adjustable confidence threshold.',
  },
  {
    id: 'point-of-divergence',
    term: 'Point of divergence',
    aliases: ['PoD', 'divergence'],
    definition:
      'The earliest moment at which a counterfactual branch differs from its baseline. History before it is shared; after it the two may differ.',
  },
  {
    id: 'baseline',
    term: 'Baseline',
    definition: 'The graph a branch was forked from, which the branch is compared against.',
  },
  {
    id: 'branch',
    term: 'Branch',
    aliases: ['counterfactual', 'fork', 'what if'],
    definition:
      'A fork of a graph made to explore a counterfactual. It starts as a full copy and remembers the graph it came from (its baseline), so the two can be compared and merged. Changing a branch never changes its baseline.',
  },
  {
    id: 'copy',
    term: 'Copy',
    aliases: ['duplicate'],
    definition:
      'An independent duplicate of a graph, or of part of it (a time range, or the events matching a filter). Unlike a branch it keeps no link to the original and is not listed among its branches.',
  },
  {
    id: 'version',
    term: 'Version',
    aliases: ['snapshot'],
    definition:
      'An immutable snapshot of a graph. Versions can be compared, and an earlier one can be restored.',
  },
  {
    id: 'merge',
    term: 'Merge',
    aliases: ['conflict'],
    definition:
      'Combining a branch into another graph. Where the two disagree about the same event, arc, link or pressure, you choose which side to keep before the merge is committed.',
  },
]

/** Case-insensitive match against the term, its aliases and its definition. */
export function filterGlossary(query: string, entries: readonly GlossaryEntry[] = GLOSSARY): GlossaryEntry[] {
  const needle = query.trim().toLowerCase()
  if (!needle) return [...entries]
  return entries.filter((entry) =>
    [entry.term, entry.definition, ...(entry.aliases ?? [])].some((text) =>
      text.toLowerCase().includes(needle)
    )
  )
}
