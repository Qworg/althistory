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

/**
 * The moment on the axis, exactly: a double cannot tell apart two moments a
 * second apart past about 285,000 years. Null for a time that names no moment
 * (an invalid Date, NaN): such a pair is never an inversion and never
 * simultaneous, as it was when the times were compared as doubles.
 */
function toMillis(value: CausalTime): bigint | null {
  if (typeof value === 'bigint') return value;
  return toAxisTime(value);
}

/**
 * Whether the cause happens strictly after the effect.
 *
 * A cause at the very same moment as its effect is not an inversion, and
 * neither is a pair with a time that cannot be read (that is the timestamp's
 * own error, not a causal one).
 */
export function isTemporalInversion(causeTime: CausalTime, effectTime: CausalTime): boolean {
  const cause = toMillis(causeTime);
  const effect = toMillis(effectTime);
  return cause !== null && effect !== null && cause > effect;
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
 * Whether the two moments are the same one (false when either is unreadable).
 */
export function isSimultaneous(causeTime: CausalTime, effectTime: CausalTime): boolean {
  const cause = toMillis(causeTime);
  const effect = toMillis(effectTime);
  return cause !== null && effect !== null && cause === effect;
}
