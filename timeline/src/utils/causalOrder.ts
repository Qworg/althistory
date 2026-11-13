/**
 * The one rule the project uses for the order of a cause and its effect.
 *
 * A cause may happen at the same moment as its effect. The two can be part
 * of the same occurrence, and historical data with day-level timestamps makes
 * such pairs common. What is an error is a cause that happens *strictly
 * after* its effect -- the effect would then precede its own cause.
 *
 * Every path that looks at a causal pair -- the importer, the merge, the
 * link-creation path, the validator, `/api/validate`, the CLI -- asks these
 * two functions, so they cannot drift apart again.
 */

import { toAxisTime } from '@althistory/calendar';

/**
 * The time of a value the project compares: a `Date` or a millisecond
 * timestamp.
 */
export type CausalTime = Date | number | bigint;

/** The moment on the axis, exactly: a double cannot tell apart two moments a second apart past about 285,000 years. */
function toMillis(value: CausalTime): bigint {
  if (typeof value === 'bigint') return value;
  const time = value instanceof Date ? toAxisTime(value) : toAxisTime(value);
  return time ?? BigInt(0);
}

/**
 * Whether the cause happens strictly after the effect.
 *
 * A cause at the very same moment as its effect is not an inversion.
 */
export function isTemporalInversion(causeTime: CausalTime, effectTime: CausalTime): boolean {
  return toMillis(causeTime) > toMillis(effectTime);
}

/**
 * Whether the pair is in an order the project accepts.
 *
 * The opposite of {@link isTemporalInversion}.
 */
export function isCausalOrderValid(causeTime: CausalTime, effectTime: CausalTime): boolean {
  return !isTemporalInversion(causeTime, effectTime);
}

/**
 * Whether the two moments are the same one.
 */
export function isSimultaneous(causeTime: CausalTime, effectTime: CausalTime): boolean {
  return toMillis(causeTime) === toMillis(effectTime);
}
