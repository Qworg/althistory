import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryProvider } from './components/providers/QueryProvider'
import App from './App.tsx'
import { OfflineIndicator } from './offline/OfflineIndicator'
import { startOfflineSync } from './offline/offlineSync'
import { registerServiceWorker } from './offline/registerServiceWorker'
import './index.css'

// Mirror connectivity into the store, replay queued writes on reconnect, and
// register the app-shell service worker. See src/offline/README.md for the
// scope and limits of the offline subsystem.
startOfflineSync()
registerServiceWorker()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryProvider>
      <App />
      <OfflineIndicator />
    </QueryProvider>
  </StrictMode>,
)
