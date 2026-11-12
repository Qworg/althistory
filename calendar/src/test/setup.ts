import fc from 'fast-check'
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
