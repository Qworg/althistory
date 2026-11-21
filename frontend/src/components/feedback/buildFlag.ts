/**
 * Read an on/off switch the way the server reads FEEDBACK_ENABLED: unset or
 * empty is on; `true`, `1`, `yes`, `on` are on; anything else (`false`, `0`,
 * `no`, `off`, or a value that is not clearly yes) is off. An operator who
 * wrote something there meant to turn it off.
 */
export function readSwitch(value: string | undefined): boolean {
  const normalised = value?.trim().toLowerCase()
  if (!normalised) return true
  return ['true', '1', 'yes', 'on'].includes(normalised)
}

/**
 * Whether this build has feedback at all. `VITE_FEEDBACK_ENABLED=false` at
 * build time leaves it out: no button, no shortcut, and no errors recorded.
 * Its own module, so the error recorder can read it without a cycle.
 */
export const FEEDBACK_BUILT_IN = readSwitch(import.meta.env.VITE_FEEDBACK_ENABLED as string | undefined)
