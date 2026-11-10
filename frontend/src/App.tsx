import { BrowserRouter, HashRouter } from 'react-router'
import { DEMO_MODE } from '@/demo/flag'
import { MainLayout } from '@/components/layout/MainLayout'
import { AppRoutes } from '@/components/routing/AppRoutes'
import { ErrorBoundary } from '@/components/notifications/ErrorBoundary'
import { NotificationCenter } from '@/components/notifications/NotificationCenter'
import { useStoreInitialization } from '@/hooks/useStoreInitialization'

// The demo is static files on GitHub Pages, which cannot answer /timeline or
// /causal-graph with the app; hash URLs keep every view on index.html.
const Router = DEMO_MODE ? HashRouter : BrowserRouter

function App() {
  // Load persisted preferences/session data and keep them in sync with storage.
  useStoreInitialization()

  return (
    <Router>
      <ErrorBoundary>
        <MainLayout>
          <AppRoutes />
        </MainLayout>
      </ErrorBoundary>
      <NotificationCenter />
    </Router>
  )
}

export default App
