import { BrowserRouter } from 'react-router'
import { MainLayout } from '@/components/layout/MainLayout'
import { AppRoutes } from '@/components/routing/AppRoutes'
import { ErrorBoundary } from '@/components/notifications/ErrorBoundary'
import { NotificationCenter } from '@/components/notifications/NotificationCenter'
import { useStoreInitialization } from '@/hooks/useStoreInitialization'

function App() {
  // Load persisted preferences/session data and keep them in sync with storage.
  useStoreInitialization()

  return (
    <BrowserRouter>
      <ErrorBoundary>
        <MainLayout>
          <AppRoutes />
        </MainLayout>
      </ErrorBoundary>
      <NotificationCenter />
    </BrowserRouter>
  )
}

export default App
