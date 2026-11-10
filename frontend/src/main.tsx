// First: in the demo build this points axios at the in-browser server, and it
// must run before the API client creates its axios instance.
import './demo/install'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryProvider } from './components/providers/QueryProvider'
import App from './App.tsx'
import { OfflineIndicator } from './offline/OfflineIndicator'
import { startOfflineSync } from './offline/offlineSync'
import { registerServiceWorker } from './offline/registerServiceWorker'
import { DEMO_MODE } from './demo/flag'
import { DemoBanner } from './demo/DemoBanner'
// Self-hosted typefaces (latin subset, font-display: swap). Only the weights
// the type scale in index.css uses; add a weight here before using it.
import '@fontsource/ibm-plex-sans/latin-400.css'
import '@fontsource/ibm-plex-sans/latin-500.css'
import '@fontsource/ibm-plex-sans/latin-600.css'
import '@fontsource/ibm-plex-mono/latin-400.css'
import '@fontsource/ibm-plex-mono/latin-500.css'
import '@fontsource/newsreader/latin-500.css'
import '@fontsource/newsreader/latin-600.css'
import './index.css'

// Mirror connectivity into the store, replay queued writes on reconnect, and
// register the app-shell service worker. See src/offline/README.md for the
// scope and limits of the offline subsystem.
startOfflineSync()
// The demo is served from a sub-path of GitHub Pages; a worker registered at
// the site root would be out of scope, and there is no app shell to cache.
if (!DEMO_MODE) registerServiceWorker()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {DEMO_MODE && <DemoBanner />}
    <QueryProvider>
      <App />
      <OfflineIndicator />
    </QueryProvider>
  </StrictMode>,
)
