import { Routes, Route, Navigate, useLocation } from 'react-router'
import { TimelineView } from '@/components/views/TimelineView'
import { CausalGraphView } from '@/components/views/CausalGraphView'
import { ActorPerspectiveView } from '@/components/views/ActorPerspectiveView'

/** "/" -> "/timeline", keeping a shared link's filters (query) and fragment. */
function RootRedirect() {
  const { search, hash } = useLocation()
  return <Navigate to={{ pathname: '/timeline', search, hash }} replace />
}

export function AppRoutes() {
  return (
    <Routes>
      {/* One address per view: "/" is the timeline, so it goes there, and
          the navigation's Timeline item is the active one. */}
      <Route path="/" element={<RootRedirect />} />
      <Route path="/timeline" element={<TimelineView />} />
      <Route path="/causal-graph" element={<CausalGraphView />} />
      <Route path="/actor-perspective" element={<ActorPerspectiveView />} />
    </Routes>
  )
}