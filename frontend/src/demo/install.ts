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
 * It also reads `?start=branch`, the landing page's link: a fresh visit opens
 * on the example branch, where the fork is, rather than the main history. The
 * parameter is removed from the address straight away, so a reload or a
 * shared link does not keep resetting the visitor's choice.
 */
import axios from 'axios'
import { DEMO_BRANCH_GRAPH_ID, DEMO_MODE, DEMO_STATE_KEY } from './flag'

function applyStartParameter(): void {
  try {
    const url = new URL(window.location.href)
    const start = url.searchParams.get('start')
    if (!start) return
    // Only a fresh visit: a tab that already has demo state keeps its graph.
    if (start === 'branch' && !sessionStorage.getItem(DEMO_STATE_KEY)) {
      localStorage.setItem('active_graph_id', DEMO_BRANCH_GRAPH_ID)
    }
    url.searchParams.delete('start')
    window.history.replaceState(window.history.state, '', url.toString())
  } catch {
    // No storage or history API: the demo opens on the main history.
  }
}

if (DEMO_MODE) {
  applyStartParameter()
  axios.defaults.adapter = (config) => import('./server').then((server) => server.respond(config))
}
