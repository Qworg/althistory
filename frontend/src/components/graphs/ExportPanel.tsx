/**
 * ExportPanel Component
 * 
 * Panel for exporting graph data with filtering options and job management.
 */

import React, { useState, useCallback, memo, useRef } from 'react'
import { ExportHistoryList } from './ExportHistoryList'
import { useExportManagement } from '@/hooks/useExport'
import { useActiveGraphId, useActiveGraph } from '@/hooks/useGraphs'
import { ExportFilters, AlthistoryExport } from '@/types'

interface ExportPanelProps {
  className?: string
}

export const ExportPanel = memo(function ExportPanel({
  className = '',
}: ExportPanelProps) {
  const [isExpanded, setIsExpanded] = useState(false)
  const [scope, setScope] = useState<'full' | 'filtered'>('full')
  const [includeProvenance, setIncludeProvenance] = useState(false)
  const [filters, setFilters] = useState<ExportFilters>({})
  const [showFilters, setShowFilters] = useState(false)
  
  const fileInputRef = useRef<HTMLInputElement>(null)

  const activeGraphId = useActiveGraphId()
  const { data: activeGraph } = useActiveGraph()
  
  const {
    activeJob,
    stats,
    isCreating,
    isDownloading,
    isSyncExporting,
    isValidating,
    createExport,
    syncExport,
    downloadExport,
    cancelExport,
    validateExport,
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

  const handleValidateFile = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    try {
      const text = await file.text()
      const data = JSON.parse(text) as AlthistoryExport
      const result = await validateExport(data)
      
      alert(result.valid 
        ? `Valid export file!${result.warnings.length > 0 ? `\n\nWarnings:\n${result.warnings.join('\n')}` : ''}`
        : `Invalid export file:\n${result.errors.join('\n')}`
      )
    } catch (error) {
      alert('Failed to parse file: ' + (error instanceof Error ? error.message : 'Unknown error'))
    }
    
    // Reset input
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }, [validateExport])

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
      <div className={`bg-white border rounded-lg p-4 ${className}`}>
        <div className="text-gray-500 text-sm">Select a graph to export</div>
      </div>
    )
  }

  return (
    <div className={`bg-white border rounded-lg overflow-hidden ${className}`}>
      {/* Header */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full px-4 py-3 flex items-center justify-between bg-gray-50 hover:bg-gray-100 transition-colors"
      >
        <div className="flex items-center gap-2">
          <svg className="w-5 h-5 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} 
              d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" 
            />
          </svg>
          <span className="font-medium text-gray-700">Export</span>
        </div>
        <div className="flex items-center gap-2">
          {hasActiveJobs && (
            <span className="text-xs bg-blue-100 text-blue-600 px-2 py-0.5 rounded animate-pulse">
              Exporting...
            </span>
          )}
          <svg 
            className={`w-4 h-4 text-gray-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
            fill="none" viewBox="0 0 24 24" stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </button>

      {/* Content */}
      {isExpanded && (
        <div className="p-4 space-y-4">
          {/* Quick Export */}
          <div className="flex gap-2">
            <button
              onClick={handleQuickExport}
              disabled={isSyncExporting}
              className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {isSyncExporting ? (
                <>
                  <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Exporting...
                </>
              ) : (
                <>
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                  </svg>
                  Quick Export
                </>
              )}
            </button>
          </div>

          {/* Export Options */}
          <div className="border rounded-lg p-3 space-y-3">
            <div className="text-sm font-medium text-gray-700">Export Options</div>
            
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
                  ${scope === 'full' ? 'border-blue-500 bg-blue-50 text-blue-700' : 'hover:bg-gray-50'}
                `}>
                  Full Export
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
                  ${scope === 'filtered' ? 'border-blue-500 bg-blue-50 text-blue-700' : 'hover:bg-gray-50'}
                `}>
                  Filtered
                </div>
              </label>
            </div>

            {/* Filters (when filtered) */}
            {scope === 'filtered' && (
              <div className="space-y-2 pt-2 border-t">
                <button
                  onClick={() => setShowFilters(!showFilters)}
                  className="flex items-center gap-1 text-sm text-blue-600 hover:text-blue-700"
                >
                  <svg className={`w-4 h-4 transition-transform ${showFilters ? 'rotate-90' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                  Configure Filters
                </button>
                
                {showFilters && (
                  <div className="space-y-2 ml-5">
                    {/* Time Range */}
                    <div>
                      <label className="text-xs text-gray-500">Time Range</label>
                      <div className="flex gap-2">
                        <input
                          type="date"
                          value={filters.timeRange?.start || ''}
                          onChange={(e) => handleTimeRangeChange('start', e.target.value)}
                          className="flex-1 px-2 py-1 border rounded text-sm"
                        />
                        <input
                          type="date"
                          value={filters.timeRange?.end || ''}
                          onChange={(e) => handleTimeRangeChange('end', e.target.value)}
                          className="flex-1 px-2 py-1 border rounded text-sm"
                        />
                      </div>
                    </div>

                    {/* Actors */}
                    <div>
                      <label className="text-xs text-gray-500">Actors (comma-separated)</label>
                      <input
                        type="text"
                        value={filters.actors?.join(', ') || ''}
                        onChange={(e) => handleFilterChange('actors', 
                          e.target.value.split(',').map(s => s.trim()).filter(Boolean)
                        )}
                        placeholder="e.g., Napoleon, Wellington"
                        className="w-full px-2 py-1 border rounded text-sm"
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
              <span>Include provenance data</span>
            </label>

            {/* Start Export Button */}
            <button
              onClick={handleExport}
              disabled={isCreating}
              className="w-full px-4 py-2 bg-gray-800 text-white rounded hover:bg-gray-900 disabled:opacity-50 text-sm"
            >
              {isCreating ? 'Starting Export...' : 'Start Export Job'}
            </button>
          </div>

          {/* Active Job Progress */}
          {activeJob && (activeJob.status === 'pending' || activeJob.status === 'processing') && (
            <div className="border rounded-lg p-3 bg-blue-50">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-blue-700">Exporting...</span>
                <button
                  onClick={() => cancelExport(activeJob.id)}
                  className="text-xs text-red-600 hover:text-red-700"
                >
                  Cancel
                </button>
              </div>
              <div className="h-2 bg-blue-200 rounded-full overflow-hidden">
                <div 
                  className="h-full bg-blue-600 transition-all duration-300"
                  style={{ width: `${activeJob.progress}%` }}
                />
              </div>
              <div className="text-xs text-blue-600 mt-1">{activeJob.progress}%</div>
            </div>
          )}

          {/* Completed Exports */}
          {completedJobs.length > 0 && (
            <div className="space-y-2">
              <div className="text-sm font-medium text-gray-700">Recent Exports</div>
              <ExportHistoryList
                jobs={completedJobs}
                maxItems={3}
                onDownload={handleDownload}
                isDownloading={isDownloading}
              />
            </div>
          )}

          {/* Validate Import File */}
          <div className="border-t pt-4">
            <div className="text-sm font-medium text-gray-700 mb-2">Validate Import File</div>
            <input
              ref={fileInputRef}
              type="file"
              accept=".json"
              onChange={handleValidateFile}
              className="hidden"
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={isValidating}
              className="w-full px-4 py-2 border border-dashed rounded text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-50"
            >
              {isValidating ? 'Validating...' : 'Select file to validate'}
            </button>
          </div>

          {/* Stats */}
          {stats && (
            <div className="text-xs text-gray-400 pt-2 border-t">
              {stats.total} total exports - {stats.completed} completed
            </div>
          )}
        </div>
      )}
    </div>
  )
})

export default ExportPanel
