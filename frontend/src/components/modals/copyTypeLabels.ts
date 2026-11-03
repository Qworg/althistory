import type { CopyOperation } from '@/types'

/**
 * What each kind of copy is called everywhere in the UI. A copy is an
 * independent graph; a branch (which records its baseline) is not a copy and
 * is not tracked by the copy operations.
 */
export const COPY_TYPE_LABELS: Record<CopyOperation['type'], string> = {
  full: 'Full copy',
  time_range: 'Time-range copy',
  filtered: 'Filtered copy',
}
