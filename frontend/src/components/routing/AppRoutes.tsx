import { Routes, Route } from 'react-router'
import { TimelineView } from '@/components/views/TimelineView'
import { CausalGraphView } from '@/components/views/CausalGraphView'
import { ActorPerspectiveView } from '@/components/views/ActorPerspectiveView'

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<TimelineView />} />
      <Route path="/timeline" element={<TimelineView />} />
      <Route path="/causal-graph" element={<CausalGraphView />} />
      <Route path="/actor-perspective" element={<ActorPerspectiveView />} />
    </Routes>
  )
}