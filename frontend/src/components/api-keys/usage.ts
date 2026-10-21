/**
 * The share of a rate limit window that has been used.
 *
 * Kept out of the component file so that the file exports only components,
 * which is what the fast-refresh rule wants.
 */

/**
 * The share of a window that has been used, clamped to 0..1.
 */
export function usageRatio(count: number, limit: number): number {
  if (limit <= 0) return 0
  return Math.min(1, Math.max(0, count / limit))
}
