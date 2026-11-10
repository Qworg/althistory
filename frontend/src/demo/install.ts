/**
 * Points every axios request at the in-browser demo server, in the demo build
 * only.
 *
 * `services/api.ts` creates its axios instance when it is first imported, and
 * `axios.create` copies `axios.defaults` at that moment. So this module must
 * be evaluated before anything imports the API client: `main.tsx` imports it
 * first. The server itself (and the recording it replays) is loaded on the
 * first request, as its own chunk.
 */
import axios from 'axios'
import { DEMO_MODE } from './flag'

if (DEMO_MODE) {
  axios.defaults.adapter = (config) => import('./server').then((server) => server.respond(config))
}
