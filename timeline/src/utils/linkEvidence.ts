/**
 * The rule for a causal link's `evidence`.
 *
 * Every link says why: `evidence` is required, a string with something in it.
 * A missing, empty or whitespace-only value is refused at every door (the
 * routes, the batch routes and the transaction, the CLI and MCP commands, the
 * stream), with {@link LINK_EVIDENCE_REQUIRED} as the message.
 *
 * Links stored before the rule have none. The importers do not refuse an old
 * export for it: they keep the link and fill {@link NO_EVIDENCE_PLACEHOLDER}
 * (see `importedEvidence`), and say so in a warning, so the link is visible as
 * unsupported rather than lost.
 */

export const LINK_EVIDENCE_REQUIRED =
  'evidence is required: say why the cause led to the effect, as a non-empty string';

/** What an importer stores for a link that arrives without evidence. */
export const NO_EVIDENCE_PLACEHOLDER = '(no evidence recorded)';

/** Whether `value` is evidence a link can be stored with. */
export function hasLinkEvidence(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/** The evidence trimmed of surrounding space, or `undefined` when there is none. */
export function readLinkEvidence(value: unknown): string | undefined {
  return hasLinkEvidence(value) ? value.trim() : undefined;
}

/**
 * The evidence an importer stores: the link's own, or the placeholder for a
 * link exported before evidence was required. `placeholder` says which.
 */
export function importedEvidence(value: unknown): { evidence: string; placeholder: boolean } {
  const evidence = readLinkEvidence(value);
  return evidence === undefined
    ? { evidence: NO_EVIDENCE_PLACEHOLDER, placeholder: true }
    : { evidence, placeholder: false };
}
