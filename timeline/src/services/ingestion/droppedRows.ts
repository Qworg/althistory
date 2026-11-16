/**
 * The report of Wikidata results an extraction left out (#33): how many, why,
 * and which items, so a person or an agent can act on them.
 *
 * A "result" is one binding of the query's answer. The query returns one per
 * place, so one item can be several results; `items` counts the distinct
 * items among them.
 */

import type { DroppedRowReason, DroppedRows } from './types';

/** The most item ids kept for one reason. */
export const MAX_DROPPED_ITEM_IDS = 10;

const TEXT: Record<DroppedRowReason, string> = {
  'no-date': 'there is no date',
  unreadable: 'the date could not be read',
  'before-timeline': 'the date is beyond the timeline (older than about 285 million years)',
  'after-timeline': 'the date is beyond the timeline (more than about 285 million years ahead)',
  'outside-range': 'the date is outside the time range asked for',
  'below-confidence': 'the confidence is below the minimum asked for',
};

/** What is counted while a response is read: per reason, the results and the distinct items among them. */
export type DroppedRowCounts = Partial<Record<DroppedRowReason, { count: number; ids: Set<string> }>>;

/** Count one result left out for `reason`; `itemId` is the Wikidata id of its item, or '' when it has none. */
export function countDropped(counts: DroppedRowCounts, reason: DroppedRowReason, itemId: string): void {
  const entry = (counts[reason] ??= { count: 0, ids: new Set<string>() });
  entry.count += 1;
  if (itemId) entry.ids.add(itemId);
}

/** The counts as the report every front end shows; undefined when nothing was left out. */
export function describeDroppedRows(counts: DroppedRowCounts): DroppedRows | undefined {
  const reasons = (Object.keys(TEXT) as DroppedRowReason[])
    .flatMap((reason) => {
      const entry = counts[reason];
      if (!entry || entry.count === 0) return [];
      const ids = [...entry.ids];
      return [{ reason, count: entry.count, items: ids.length, itemIds: ids.slice(0, MAX_DROPPED_ITEM_IDS), description: TEXT[reason] }];
    })
    .sort((a, b) => b.count - a.count);
  if (reasons.length === 0) return undefined;
  return { total: reasons.reduce((sum, entry) => sum + entry.count, 0), reasons };
}

/** Two reports as one: their reasons side by side, their totals added. */
export function mergeDroppedRows(a: DroppedRows | undefined, b: DroppedRows | undefined): DroppedRows | undefined {
  if (!a) return b;
  if (!b) return a;
  const reasons = [...a.reasons, ...b.reasons].sort((x, y) => y.count - x.count);
  return { total: a.total + b.total, reasons };
}
