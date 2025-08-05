import { BrowserRouter } from 'react-router'
import { MainLayout } from '@/components/layout/MainLayout'
import { AppRoutes } from '@/components/routing/AppRoutes'

function App() {
  return (
    <BrowserRouter>
      <MainLayout>
        <AppRoutes />
      </MainLayout>
    </BrowserRouter>
  )
}

export default App