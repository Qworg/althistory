/**
 * Shared class strings and copy helpers for the branch dialogs, so the
 * comparison, merge and simulation surfaces use one button hierarchy.
 *
 * Primary is a cobalt (baseline accent) fill with card-coloured text: both are
 * tokens, so it stays legible in dark mode, where the accent lightens and the
 * card darkens. There is one primary per footer.
 */
export const PRIMARY_BUTTON =
  'inline-flex items-center justify-center gap-2 px-4 py-2 text-sm font-semibold rounded-md bg-baseline text-card hover:bg-baseline/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors'

export const SECONDARY_BUTTON =
  'inline-flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium rounded-md border border-line bg-card text-ink hover:bg-subtle disabled:opacity-50 disabled:cursor-not-allowed transition-colors'

export const QUIET_BUTTON =
  'inline-flex items-center justify-center gap-2 px-3 py-2 text-sm font-medium rounded-md text-ink-secondary hover:text-ink hover:bg-subtle disabled:opacity-50 disabled:cursor-not-allowed transition-colors'

/**
 * A dialog footer: a status line and the actions. Below `sm` (the full-screen
 * sheet on a phone) both stack and the buttons fill the width, in DOM order,
 * so the primary — always last — sits at the bottom, nearest the thumb.
 */
export const FOOTER_ROW = 'flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between'
export const FOOTER_ACTIONS = 'flex flex-col gap-2 sm:flex-row sm:items-center sm:ml-auto'

export const FIELD =
  'border border-line rounded-md px-2 py-1.5 text-sm bg-card text-ink focus:outline-none focus:ring-2 focus:ring-selected/40 focus:border-selected disabled:opacity-60'

/** "1 event", "2 events". */
export function countNoun(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`
}

/** "a", "a and b", "a, b and c". */
export function joinList(parts: readonly string[]): string {
  if (parts.length <= 1) return parts[0] ?? ''
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`
}

/** A graph name in running copy. */
export function quoted(name: string): string {
  return `“${name}”`
}
