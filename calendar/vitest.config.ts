import { defineConfig } from 'vitest/config'

/**
 * Every suite runs once per time zone. Historical dates are UTC instants and
 * nothing here may read the host's zone, but a stray `getFullYear()` or
 * `new Date('1843-11-20T00:00')` passes in UTC and fails west of it, so the
 * zones are the ones most likely to expose that:
 * - UTC, the control;
 * - America/Los_Angeles, west of Greenwich with daylight saving, and local
 *   mean time (-7:52:58) before 1883;
 * - Pacific/Kiritimati (+14) and Pacific/Pago_Pago (-11), the extremes, where
 *   a local midnight is a different UTC day;
 * - Asia/Kathmandu (+5:45), an offset that is not a whole hour.
 *
 * `src/test/zone.test.ts` checks that each project really runs in its zone.
 */
export const ZONES = ['UTC', 'America/Los_Angeles', 'Pacific/Kiritimati', 'Pacific/Pago_Pago', 'Asia/Kathmandu']

/** FC_SCALE (src/test/setup.ts) lengthens every property, so it lengthens their time limit too. */
const scale = Math.max(1, Number(process.env.FC_SCALE) || 1)

export default defineConfig({
  test: {
    projects: ZONES.map((zone) => ({
      test: {
        name: zone,
        include: ['src/**/*.test.ts'],
        setupFiles: ['src/test/setup.ts'],
        // Per project: projects do not inherit the root's test options.
        // The five projects run side by side, each file's properties generate
        // world calendars (the slowest thing here), and a property that takes
        // 20 s alone takes twice that when every core is busy: 60 s is for
        // that contention, not for a hang, which the worker's own timeout
        // still catches.
        testTimeout: 60_000 * scale,
        env: { TZ: zone },
      },
    })),
  },
})
