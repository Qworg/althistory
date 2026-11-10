/**
 * True only in the GitHub Pages demo build (`npm run build:demo`), where the
 * API is answered in the browser by `./server.ts` instead of the backend.
 * Vite inlines the value, so in every other build the demo code is dead and
 * left out of the bundle.
 */
export const DEMO_MODE = import.meta.env.VITE_DEMO_MODE === 'true'

/** Where the demo sends people who want the real thing. */
export const REPO_URL = 'https://github.com/Qworg/althistory'

/** sessionStorage key of the demo's edits; clearing it resets the demo. */
export const DEMO_STATE_KEY = 'althistory-demo'

/** The example branch in the recording, which `?start=branch` opens on. */
export const DEMO_BRANCH_GRAPH_ID = 'graph_clerks_prevail'

/** The example's main history, which `?start=main` opens on. */
export const DEMO_MAIN_GRAPH_ID = 'graph_engine_age'
