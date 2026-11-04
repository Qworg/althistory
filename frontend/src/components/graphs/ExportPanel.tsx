/**
 * ExportPanel Component
 * 
 * Panel for exporting graph data with filtering options and job management.
 */

import { useState, useCallback, memo } from 'react'
import { ExportHistoryList } from './ExportHistoryList'
import { useExportManagement } from '@/hooks/useExport'
import { useActiveGraphId, useActiveGraph } from '@/hooks/useGraphs'
import { ExportFilters } from '@/types'

interface ExportPanelProps {
  className?: string
  /**
   * Whether the panel folds behind an "Export" header. Off in the Export
   * drawer, where the drawer is already the disclosure: a collapsed accordion
   * as a drawer's only content was a second click for nothing.
   */
  collapsible?: boolean
}

export const ExportPanel = memo(function ExportPanel({
  className = '',
  collapsible = true,
}: ExportPanelProps) {
  const [isExpandedState, setIsExpanded] = useState(false)
  const isExpanded = !collapsible || isExpandedState
  const [scope, setScope] = useState<'full' | 'filtered'>('full')
  const [includeProvenance, setIncludeProvenance] = useState(false)
  const [filters, setFilters] = useState<ExportFilters>({})
  const [showFilters, setShowFilters] = useState(false)


  const activeGraphId = useActiveGraphId()
  const { data: activeGraph } = useActiveGraph()
  
  const {
    activeJob,
    stats,
    isCreating,
    isDownloading,
    isSyncExporting,
    createExport,
    syncExport,
    downloadExport,
    cancelExport,
    hasActiveJobs,
    completedJobs,
  } = useExportManagement(activeGraphId || undefined)

  // Handlers
  const handleExport = useCallback(async () => {
    try {
      await createExport({
        scope,
        filters: scope === 'filtered' ? filters : undefined,
        includeProvenance,
      })
    } catch (error) {
      console.error('Export failed:', error)
    }
  }, [createExport, scope, filters, includeProvenance])

  const handleQuickExport = useCallback(async () => {
    try {
      const result = await syncExport({
        scope: 'full',
        includeProvenance: false,
      })
      
      // Download the result directly
      const blob = new Blob([JSON.stringify(result.export, null, 2)], { type: 'application/json' })
      const url = window.URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `${activeGraph?.name || 'export'}_${Date.now()}.json`
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      window.URL.revokeObjectURL(url)
    } catch (error) {
      console.error('Quick export failed:', error)
    }
  }, [syncExport, activeGraph])

  const handleDownload = useCallback(async (jobId: string) => {
    try {
      await downloadExport(jobId, `${activeGraph?.name || 'export'}_${jobId}.json`)
    } catch (error) {
      console.error('Download failed:', error)
    }
  }, [downloadExport, activeGraph])


  const handleFilterChange = useCallback(<K extends keyof ExportFilters>(key: K, value: ExportFilters[K]) => {
    setFilters(prev => ({ ...prev, [key]: value }))
  }, [])

  // The two time-range bounds are edited independently while ExportFilters
  // requires both, so the not-yet-entered bound falls back to an empty string.
  const handleTimeRangeChange = useCallback((bound: 'start' | 'end', value: string) => {
    setFilters(prev => {
      const previous = prev.timeRange
      const timeRange = bound === 'start'
        ? { start: value, end: previous?.end ?? '' }
        : { start: previous?.start ?? '', end: value }
      return { ...prev, timeRange }
    })
  }, [])

  if (!activeGraphId) {
    return (
      <div className={`p-4 ${className}`}>
        <div className="text-ink-muted text-sm">Choose a graph from the header to export it.</div>
      </div>
    )
  }

  return (
    <div className={collapsible ? `bg-card border border-line rounded-lg overflow-hidden ${className}` : className}>
      {/* Header */}
      {collapsible && (
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full px-4 py-3 flex items-center justify-between bg-subtle hover:bg-subtle transition-colors"
      >
        <div className="flex items-center gap-2">
          <svg className="w-5 h-5 text-ink-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} 
              d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" 
            />
          </svg>
          <span className="font-medium text-ink-secondary">Export</span>
        </div>
        <div className="flex items-center gap-2">
          {hasActiveJobs && (
            <span className="text-xs bg-blue-100 text-baseline px-2 py-0.5 rounded animate-pulse">
              Preparing…
            </span>
          )}
          <svg 
            className={`w-4 h-4 text-ink-muted transition-transform ${isExpanded ? 'rotate-180' : ''}`}
            fill="none" viewBox="0 0 24 24" stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </button>
      )}

      {/* Content */}
      {isExpanded && (
        <div className={collapsible ? 'p-4 space-y-4' : 'space-y-4'}>
          {/* Quick Export */}
          <div className="flex gap-2">
            <button
              onClick={handleQuickExport}
              disabled={isSyncExporting}
              className="flex-1 px-4 py-2 bg-baseline text-on-accent rounded-lg hover:bg-baseline/90 disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {isSyncExporting ? (
                <>
                  <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Downloading…
                </>
              ) : (
                <>
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                  </svg>
                  Download the whole graph (.json)
                </>
              )}
            </button>
          </div>

          {/* Export Options */}
          <div className="border border-line rounded-lg p-3 space-y-3">
            <h3 className="text-sm font-semibold text-ink">A custom export</h3>
            <p className="-mt-2 text-xs text-ink-muted">Prepared in the background; the file appears under Recent exports when it is ready.</p>
            
            {/* Scope Selection */}
            <div className="flex gap-2">
              <label className="flex-1">
                <input
                  type="radio"
                  name="scope"
                  value="full"
                  checked={scope === 'full'}
                  onChange={() => setScope('full')}
                  className="sr-only"
                />
                <div className={`
                  p-2 text-center border rounded cursor-pointer text-sm
                  ${scope === 'full' ? 'border-selected bg-selected/10 text-ink font-medium' : 'border-line text-ink-secondary hover:bg-subtle'}
                `}>
                  Everything
                </div>
              </label>
              <label className="flex-1">
                <input
                  type="radio"
                  name="scope"
                  value="filtered"
                  checked={scope === 'filtered'}
                  onChange={() => setScope('filtered')}
                  className="sr-only"
                />
                <div className={`
                  p-2 text-center border rounded cursor-pointer text-sm
                  ${scope === 'filtered' ? 'border-selected bg-selected/10 text-ink font-medium' : 'border-line text-ink-secondary hover:bg-subtle'}
                `}>
                  Only some events
                </div>
              </label>
            </div>

            {/* Filters (when filtered) */}
            {scope === 'filtered' && (
              <div className="space-y-2 pt-2 border-t border-line">
                <button
                  onClick={() => setShowFilters(!showFilters)}
                  className="flex items-center gap-1 text-sm text-baseline hover:text-blue-700"
                >
                  <svg className={`w-4 h-4 transition-transform ${showFilters ? 'rotate-90' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                  Choose which events
                </button>
                
                {showFilters && (
                  <div className="space-y-2 ml-5">
                    {/* Time Range */}
                    <div>
                      <label className="text-xs text-ink-muted">Between</label>
                      <div className="flex gap-2">
                        <input
                          type="date"
                          value={filters.timeRange?.start || ''}
                          onChange={(e) => handleTimeRangeChange('start', e.target.value)}
                          className="flex-1 px-2 py-1 border border-line bg-card text-ink rounded text-sm"
                        />
                        <input
                          type="date"
                          value={filters.timeRange?.end || ''}
                          onChange={(e) => handleTimeRangeChange('end', e.target.value)}
                          className="flex-1 px-2 py-1 border border-line bg-card text-ink rounded text-sm"
                        />
                      </div>
                    </div>

                    {/* Actors */}
                    <div>
                      <label className="text-xs text-ink-muted">Actors, separated by commas</label>
                      <input
                        type="text"
                        value={filters.actors?.join(', ') || ''}
                        onChange={(e) => handleFilterChange('actors', 
                          e.target.value.split(',').map(s => s.trim()).filter(Boolean)
                        )}
                        placeholder="e.g., Napoleon, Wellington"
                        className="w-full px-2 py-1 border border-line bg-card text-ink rounded text-sm"
                      />
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Include Provenance */}
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={includeProvenance}
                onChange={(e) => setIncludeProvenance(e.target.checked)}
                className="rounded"
              />
              <span>Include where each record came from (its source and how it was extracted)</span>
            </label>

            {/* Start Export Button */}
            <button
              onClick={handleExport}
              disabled={isCreating}
              className="w-full px-4 py-2 border border-line bg-card text-ink rounded-md hover:bg-subtle disabled:opacity-50 text-sm font-medium"
            >
              {isCreating ? 'Preparing…' : 'Prepare export file'}
            </button>
          </div>

          {/* Active Job Progress */}
          {activeJob && (activeJob.status === 'pending' || activeJob.status === 'processing') && (
            <div className="border border-line rounded-lg p-3 bg-blue-50">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-ink">Preparing the export…</span>
                <button
                  onClick={() => cancelExport(activeJob.id)}
                  className="text-xs text-red-600 hover:text-red-700"
                >
                  Cancel
                </button>
              </div>
              <div className="h-2 bg-blue-200 rounded-full overflow-hidden">
                <div 
                  className="h-full bg-baseline transition-all duration-300"
                  style={{ width: `${activeJob.progress}%` }}
                />
              </div>
              <div className="text-xs text-baseline mt-1">{activeJob.progress}%</div>
            </div>
          )}

          {/* Completed Exports */}
          {completedJobs.length > 0 && (
            <div className="space-y-2">
              <div className="text-sm font-medium text-ink-secondary">Recent exports</div>
              <ExportHistoryList
                jobs={completedJobs}
                maxItems={3}
                onDownload={handleDownload}
                isDownloading={isDownloading}
              />
            </div>
          )}

          {/* Checking a file before importing it is the import flow's first step
              (Bring in history → Import an export file), which validates before
              anything is written; a second validator here reported by alert(). */}
          <p className="border-t border-line pt-4 text-xs text-ink-muted">
            To check a file before importing it, use Bring in history → Import an export file: it validates the file before anything is written.
          </p>

          {/* Stats */}
          {stats && stats.total > 0 && (
            <div className="text-xs text-ink-muted pt-2 border-t border-line">
              {stats.total} total exports - {stats.completed} completed
            </div>
          )}
        </div>
      )}
    </div>
  )
})

export default ExportPanel
