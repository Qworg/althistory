/**
 * Points every axios request at the in-browser demo server, in the demo build
 * only.
 *
 * `services/api.ts` creates its axios instance when it is first imported, and
 * `axios.create` copies `axios.defaults` at that moment. So this module must
 * be evaluated before anything imports the API client: `main.tsx` imports it
 * first. The server itself (and the recording it replays) is loaded on the
 * first request, as its own chunk.
 *
 * It also reads `?start=branch`, `?start=main` or `?start=world`, the site's
 * links: the demo opens on the example branch, where the fork is, on the main
 * history, or on Vael, the invented world with its own calendar. In a tab that already has demo state, the edits are kept and only
 * the active graph changes. The parameter is removed from the address
 * straight away, so a reload or a shared link does not keep resetting the
 * visitor's choice.
 */
import axios from 'axios'
import { DEMO_BRANCH_GRAPH_ID, DEMO_MAIN_GRAPH_ID, DEMO_MODE, DEMO_STATE_KEY, DEMO_WORLD_GRAPH_ID } from './flag'

const START_GRAPHS: Record<string, string> = {
  branch: DEMO_BRANCH_GRAPH_ID,
  main: DEMO_MAIN_GRAPH_ID,
  world: DEMO_WORLD_GRAPH_ID,
}

function applyStartParameter(): void {
  try {
    const url = new URL(window.location.href)
    const start = url.searchParams.get('start')
    if (!start) return
    const graph = START_GRAPHS[start]
    if (graph) {
      localStorage.setItem('active_graph_id', graph)
      const saved = sessionStorage.getItem(DEMO_STATE_KEY)
      if (saved) {
        // Every starting graph is in the recording, and the server adds a
        // recorded graph a tab saved before it existed, so it is always there.
        const state = JSON.parse(saved) as { active?: string }
        state.active = graph
        sessionStorage.setItem(DEMO_STATE_KEY, JSON.stringify(state))
      }
    }
    url.searchParams.delete('start')
    window.history.replaceState(window.history.state, '', url.toString())
  } catch {
    // No storage or history API: the demo opens where it would anyway.
  }
}

if (DEMO_MODE) {
  applyStartParameter()
  axios.defaults.adapter = (config) => import('./server').then((server) => server.respond(config))
}
