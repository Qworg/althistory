/**
 * @althistory/calendar: historical dates and invented-world calendars.
 *
 * The one implementation the API, the CLI, the MCP tools and the app share.
 * It has no dependencies and reads no ambient state: every function that can
 * show a world's dates takes the calendar as an argument (`null` for none),
 * and none reads the host's time zone. The app supplies the open graph's
 * calendar in thin wrappers (frontend/src/utils/historicalTime.ts).
 *
 * The property tests beside each module (`*.property.test.ts`) state what
 * must hold for every input, and run in five time zones (vitest.config.ts).
 */

export * from './calendar'
export * from './years'
export * from './parse'
export * from './draft'
export * from './describe'
export * from './locale'
export * from './bounds'
export * from './axis'
export * from './instant'
export { isLeapYear, daysInMonth } from './gregorian'
