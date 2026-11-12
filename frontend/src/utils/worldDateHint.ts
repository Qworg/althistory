/**
 * What a stored-date field's value reads as in a world calendar ("Mar 4,
 * 312 AR"), or null when there is no calendar or nothing readable to show:
 * `worldDateOf` in `@althistory/calendar` (calendar/src/bounds.ts), which
 * reads the field's value as UTC and refuses a date that does not exist.
 */
export { worldDateOf } from '@althistory/calendar'

/** An `aria-describedby` from the ids that apply, or undefined when none do. */
export function describedBy(...ids: Array<string | false | null | undefined>): string | undefined {
  const list = ids.filter((id): id is string => Boolean(id))
  return list.length > 0 ? list.join(' ') : undefined
}
