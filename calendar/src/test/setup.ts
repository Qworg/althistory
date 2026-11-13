import fc from 'fast-check'
import { afterEach } from 'vitest'
import { SCALE } from './arbitraries'

/**
 * Every property runs 100 times per zone unless it asks for more. A failure
 * prints the seed and the shrunk counterexample; FC_SEED=<seed> replays it.
 * FC_SCALE=20 runs everything twenty times as long, as a soak before a merge.
 */
fc.configureGlobal({
  numRuns: Math.round(100 * SCALE),
  ...(process.env.FC_SEED ? { seed: Number(process.env.FC_SEED) } : {}),
})

/**
 * A property runs synchronously, and Vitest moves from one test to the next
 * through promises that are already settled, so a file of long properties
 * never lets the worker's event loop turn: the main process's replies to it
 * wait unread, and past a minute (a slow CI runner, or FC_SCALE) the worker
 * reports "Timeout calling onTaskUpdate" though every test passed. A
 * macrotask after each test lets those replies through.
 */
afterEach(() => new Promise<void>((resolve) => setTimeout(resolve, 0)))
