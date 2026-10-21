/**
 * The rule the project uses for the order of a cause and its effect.
 *
 * A cause may happen at the same moment as its effect. The two can be part
 * of the same occurrence, and historical data with day-level timestamps
 * makes such pairs common. What is an error is a cause that happens
 * *strictly after* its effect -- the effect would then precede its own
 * cause.
 *
 * The backend keeps the same rule in `timeline/src/utils/causalOrder.ts`;
 * the two packages cannot import each other, so the rule is written down
 * twice and a test in each package checks that no other file in it
 * compares a cause with an effect on its own.
 */

/**
 * The time of a value the project compares: a `Date` or a millisecond
 * timestamp.
 */
export type CausalTime = Date | number;

function toMillis(value: CausalTime): number {
  return value instanceof Date ? value.getTime() : value;
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
