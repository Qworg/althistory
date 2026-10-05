/**
 * ImportWizard Component
 * 
 * Main container for the 5-step import wizard:
 * 1. Upload - File upload or JSON paste
 * 2. Validate - Format validation
 * 3. Preview - Show what will change
 * 4. Conflicts - Resolve any conflicts
 * 5. Execute - Run the import
 */

import { useReducer, useCallback, useState, useEffect, useRef } from 'react'
import {
  useValidateImport,
  usePreviewImport,
  useExecuteImport,
  importReducer,
  initialImportState,
} from '@/hooks/useImport'
import { ImportUploadStep } from './ImportUploadStep'
import { ImportValidationStep } from './ImportValidationStep'
import { ImportPreviewStep } from './ImportPreviewStep'
import { ImportConflictStep } from './ImportConflictStep'
import { ImportExecuteStep } from './ImportExecuteStep'
import { AlthistoryExport, ImportMode, ConflictResolution, ImportResult, ExecuteImportResponse, SyncImportResponse } from '@/types'

/** FIX #19: Default polling interval for async imports (500ms) */
export const DEFAULT_POLLING_INTERVAL_MS = 500

export interface ImportWizardProps {
  isOpen: boolean
  onClose: () => void
  onImportComplete?: (result: ImportResult) => void
  targetGraphId?: string
  /** FIX #19: Polling interval in ms for async import status checks (default: 500) */
  pollingIntervalMs?: number
}

type WizardStep = 'upload' | 'validate' | 'preview' | 'conflicts' | 'execute' | 'complete'

const STEP_ORDER: WizardStep[] = ['upload', 'validate', 'preview', 'conflicts', 'execute']

const STEP_LABELS: Record<WizardStep, string> = {
  upload: 'Upload',
  validate: 'Validate',
  preview: 'Preview',
  conflicts: 'Conflicts',
  execute: 'Import',
  complete: 'Complete',
}

export function ImportWizard({
  isOpen,
  onClose,
  onImportComplete,
  targetGraphId,
  pollingIntervalMs = DEFAULT_POLLING_INTERVAL_MS,
}: ImportWizardProps) {
  const [state, dispatch] = useReducer(importReducer, {
    ...initialImportState,
    targetGraphId,
  })

  const [executeProgress, setExecuteProgress] = useState(0)
  // FIX #17: Track current async job for cancellation
  const [currentJobId, setCurrentJobId] = useState<string | null>(null)
  const [isCancelling, setIsCancelling] = useState(false)
  
  // FIX #2: Track polling interval for cleanup
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  
  // FIX #2: Track mounted state to prevent state updates after unmount
  const isMountedRef = useRef(true)

  const validateMutation = useValidateImport()
  
  // FIX #2: Cleanup polling interval on unmount and track mounted state
  useEffect(() => {
    isMountedRef.current = true
    return () => {
      isMountedRef.current = false
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current)
        pollIntervalRef.current = null
      }
    }
  }, [])
  
  // Also cleanup when wizard is closed
  useEffect(() => {
    if (!isOpen && pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current)
      pollIntervalRef.current = null
    }
  }, [isOpen])
  
  const previewMutation = usePreviewImport()
  const executeMutation = useExecuteImport()
  
  // FIX #13: Warn user before leaving page during import
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      // Only warn if import is in progress (executing or polling)
      if (executeMutation.isPending || pollIntervalRef.current) {
        e.preventDefault()
        // Modern browsers ignore custom messages, but we still need to set returnValue
        e.returnValue = 'Import in progress. Are you sure you want to leave?'
        return e.returnValue
      }
    }
    
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload)
    }
  }, [executeMutation.isPending])

  // Handle file upload
  const handleUpload = useCallback(
    async (data: AlthistoryExport) => {
      dispatch({ type: 'SET_DATA', payload: data })
      dispatch({ type: 'SET_ERROR', payload: null })

      try {
        const validation = await validateMutation.mutateAsync({ data })
        dispatch({ type: 'SET_VALIDATION', payload: validation })
        dispatch({ type: 'SET_STEP', payload: 'validate' })
      } catch (error) {
        dispatch({
          type: 'SET_ERROR',
          payload: error instanceof Error ? error.message : 'Validation failed',
        })
      }
    },
    [validateMutation]
  )

  // Handle validation continue
  const handleValidationContinue = useCallback(async () => {
    if (!state.data) return

    try {
      const preview = await previewMutation.mutateAsync({
        data: state.data,
        targetGraphId: state.targetGraphId,
        mode: state.mode,
      })
      dispatch({ type: 'SET_PREVIEW', payload: preview })
      dispatch({ type: 'SET_STEP', payload: 'preview' })
    } catch (error) {
      dispatch({
        type: 'SET_ERROR',
        payload: error instanceof Error ? error.message : 'Preview failed',
      })
    }
  }, [state.data, state.targetGraphId, state.mode, previewMutation])

  // Handle mode change (re-fetch preview)
  const handleModeChange = useCallback(
    async (mode: ImportMode) => {
      dispatch({ type: 'SET_MODE', payload: mode })

      if (!state.data) return

      try {
        const preview = await previewMutation.mutateAsync({
          data: state.data,
          targetGraphId: state.targetGraphId,
          mode,
        })
        dispatch({ type: 'SET_PREVIEW', payload: preview })
      } catch (error) {
        dispatch({
          type: 'SET_ERROR',
          payload: error instanceof Error ? error.message : 'Preview failed',
        })
      }
    },
    [state.data, state.targetGraphId, previewMutation]
  )

  // Handle preview continue
  const handlePreviewContinue = useCallback(() => {
    if (state.preview?.conflicts && state.preview.conflicts.length > 0) {
      dispatch({ type: 'SET_STEP', payload: 'conflicts' })
    } else {
      dispatch({ type: 'SET_STEP', payload: 'execute' })
    }
  }, [state.preview])

  // Handle conflict resolution
  const handleResolve = useCallback(
    (conflictId: string, resolution: ConflictResolution) => {
      dispatch({ type: 'SET_RESOLUTION', payload: { conflictId, resolution } })
    },
    []
  )

  // Handle resolve all
  const handleResolveAll = useCallback(
    (resolution: ConflictResolution) => {
      if (!state.preview?.conflicts) return
      const resolutions: Record<string, ConflictResolution> = {}
      state.preview.conflicts.forEach((conflict) => {
        resolutions[conflict.id] = resolution
      })
      dispatch({ type: 'SET_ALL_RESOLUTIONS', payload: resolutions })
    },
    [state.preview]
  )

  // Handle conflicts continue
  const handleConflictsContinue = useCallback(() => {
    dispatch({ type: 'SET_STEP', payload: 'execute' })
  }, [])

  // Handle execute
  // FIX #2: Properly track and cleanup polling interval
  const handleExecute = useCallback(async () => {
    if (!state.data) return

    // Clear any existing poll interval
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current)
      pollIntervalRef.current = null
    }

    setExecuteProgress(0)

    try {
      const response = await executeMutation.mutateAsync({
        data: state.data,
        targetGraphId: state.targetGraphId,
        mode: state.mode,
        conflictResolution:
          Object.keys(state.resolutions).length > 0 ? 'manual' : 'skip',
        manualResolutions:
          Object.keys(state.resolutions).length > 0 ? state.resolutions : undefined,
      })

      // FIX #1: Proper type checking for async vs sync response
      // Check if async import (has async: true and jobId)
      const typedResponse = response as ExecuteImportResponse
      if (typedResponse.async === true && 'jobId' in typedResponse) {
        const jobId = typedResponse.jobId
        // FIX #17: Track jobId for cancellation
        setCurrentJobId(jobId)
        // Poll for progress - store interval in ref for cleanup
        pollIntervalRef.current = setInterval(async () => {
          // FIX #2: Check if component is still mounted before any state updates
          if (!isMountedRef.current) {
            if (pollIntervalRef.current) {
              clearInterval(pollIntervalRef.current)
              pollIntervalRef.current = null
            }
            return
          }
          
          try {
            const job = await fetch(`/api/import/jobs/${jobId}`).then(r => r.json())
            
            // FIX #2: Double-check mounted state after async operation
            if (!isMountedRef.current) return
            
            if (job.progress !== undefined) {
              setExecuteProgress(job.progress)
            }
            if (job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled') {
              // Clear interval on completion
              if (pollIntervalRef.current) {
                clearInterval(pollIntervalRef.current)
                pollIntervalRef.current = null
              }
              // FIX #17: Reset job tracking state
              setCurrentJobId(null)
              setIsCancelling(false)
              
              if (job.status === 'completed' && job.result) {
                dispatch({ type: 'SET_RESULT', payload: job.result as ImportResult })
              } else if (job.status === 'failed') {
                dispatch({
                  type: 'SET_ERROR',
                  payload: job.error || 'Import failed',
                })
              } else if (job.status === 'cancelled') {
                dispatch({
                  type: 'SET_ERROR',
                  payload: 'Import was cancelled',
                })
              }
            }
          } catch {
            // Ignore polling errors, will retry
          }
        }, pollingIntervalMs)
      } else {
        // Sync import - result is immediate (async: false)
        // FIX #8: Don't show fake progress - sync imports complete instantly
        // Show indeterminate progress instead of fake percentages
        setExecuteProgress(-1) // -1 indicates indeterminate/sync import
        
        // FIX #1: Use type guard to safely extract ImportResult
        const syncResponse = typedResponse as SyncImportResponse
        // Extract ImportResult fields, excluding async flag
        // `_async` is bound only to exclude the key from the rest object; it is
        // deliberately never read, so discard it explicitly.
        const { async: _async, ...importResult } = syncResponse
        void _async
        
        // Small delay to show completion transition
        await new Promise(resolve => setTimeout(resolve, 150))
        if (!isMountedRef.current) return
        
        setExecuteProgress(100)
        dispatch({ type: 'SET_RESULT', payload: importResult as ImportResult })
      }
    } catch (error) {
      // Clear interval on error
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current)
        pollIntervalRef.current = null
      }
      setExecuteProgress(0)
      dispatch({
        type: 'SET_ERROR',
        payload: error instanceof Error ? error.message : 'Import failed',
      })
    }
  }, [state.data, state.targetGraphId, state.mode, state.resolutions, executeMutation, pollingIntervalMs])

  // Handle complete
  const handleComplete = useCallback(() => {
    if (state.result && onImportComplete) {
      onImportComplete(state.result)
    }
    onClose()
  }, [state.result, onImportComplete, onClose])

  // Handle back navigation
  const handleBack = useCallback(() => {
    const currentIndex = STEP_ORDER.indexOf(state.step as WizardStep)
    if (currentIndex > 0) {
      // If going back from execute after completion, reset
      if (state.step === 'execute' && state.result) {
        dispatch({ type: 'RESET' })
        return
      }
      const prevStep = STEP_ORDER[currentIndex - 1]
      if (prevStep) {
        dispatch({ type: 'SET_STEP', payload: prevStep })
      }
    }
  }, [state.step, state.result])

  // Handle error
  const handleError = useCallback((message: string) => {
    dispatch({ type: 'SET_ERROR', payload: message })
  }, [])

  // FIX #17: Handle import cancellation
  const handleCancel = useCallback(async () => {
    if (!currentJobId) return
    
    setIsCancelling(true)
    try {
      await fetch(`/api/import/jobs/${currentJobId}/cancel`, { method: 'POST' })
      // The polling will detect the cancelled status and update UI
    } catch (error) {
      console.error('Failed to cancel import:', error)
      // Don't reset isCancelling - let polling handle the state
    }
  }, [currentJobId])

  if (!isOpen) return null

  const currentStepIndex = STEP_ORDER.indexOf(state.step)
  const hasConflicts = (state.preview?.conflicts?.length ?? 0) > 0

  return (
    // FIX #16: Add ARIA attributes for accessibility
    <div 
      className="fixed inset-0 z-50 overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-labelledby="import-wizard-title"
    >
      <div className="flex min-h-screen items-center justify-center px-4 pt-4 pb-20 text-center sm:block sm:p-0">
        {/* Background overlay */}
        <div
          className="fixed inset-0 bg-gray-500 bg-opacity-75 transition-opacity"
          onClick={onClose}
          aria-hidden="true"
        />

        {/* Modal panel */}
        <div 
          className="inline-block transform overflow-hidden rounded-lg bg-white text-left align-bottom shadow-xl transition-all sm:my-8 sm:w-full sm:max-w-2xl sm:align-middle"
          role="document"
        >
          {/* Header */}
          <div className="border-b border-gray-200 px-6 py-4">
            <div className="flex items-center justify-between">
              <h2 id="import-wizard-title" className="text-xl font-semibold text-gray-900">Import Data</h2>
              <button
                type="button"
                onClick={onClose}
                className="text-gray-400 hover:text-gray-500"
                aria-label="Close import wizard"
              >
                <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            </div>

            {/* Step indicators - FIX #16: Add ARIA for progress */}
            <nav aria-label="Import progress" className="mt-4 flex items-center justify-between">
              {STEP_ORDER.map((step, index) => {
                // Skip conflicts step if no conflicts
                if (step === 'conflicts' && !hasConflicts && state.step !== 'conflicts') {
                  return null
                }

                const isActive = index === currentStepIndex
                const isCompleted = index < currentStepIndex
                // Note: isDisabled would be: index > currentStepIndex
                const stepStatus = isCompleted ? 'completed' : isActive ? 'current' : 'upcoming'

                return (
                  <div 
                    key={step} 
                    className="flex items-center"
                    aria-current={isActive ? 'step' : undefined}
                  >
                    <div
                      className={`flex items-center justify-center w-8 h-8 rounded-full text-sm font-medium ${
                        isActive
                          ? 'bg-blue-600 text-white'
                          : isCompleted
                          ? 'bg-green-500 text-white'
                          : 'bg-gray-200 text-gray-500'
                      }`}
                      aria-label={`Step ${index + 1}: ${STEP_LABELS[step]} - ${stepStatus}`}
                    >
                      {isCompleted ? (
                        <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
                          <path
                            fillRule="evenodd"
                            d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                            clipRule="evenodd"
                          />
                        </svg>
                      ) : (
                        index + 1
                      )}
                    </div>
                    <span
                      className={`ml-2 text-sm ${
                        isActive
                          ? 'text-blue-600 font-medium'
                          : isCompleted
                          ? 'text-green-600'
                          : 'text-gray-500'
                      }`}
                    >
                      {STEP_LABELS[step]}
                    </span>
                    {index < STEP_ORDER.length - 1 && (
                      <div
                        className={`w-8 h-0.5 mx-2 ${
                          isCompleted ? 'bg-green-500' : 'bg-gray-200'
                        }`}
                        aria-hidden="true"
                      />
                    )}
                  </div>
                )
              })}
            </nav>
          </div>

          {/* Error Banner - FIX #16: Add ARIA for alerts */}
          {state.error && (
            <div 
              className="bg-red-50 border-l-4 border-red-400 p-4 mx-6 mt-4"
              role="alert"
              aria-live="assertive"
            >
              <div className="flex">
                <svg className="h-5 w-5 text-red-400" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
                  <path
                    fillRule="evenodd"
                    d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
                    clipRule="evenodd"
                  />
                </svg>
                <p className="ml-3 text-sm text-red-700">{state.error}</p>
              </div>
            </div>
          )}

          {/* Content */}
          <div className="px-6 py-6">
            {state.step === 'upload' && (
              <ImportUploadStep
                onUpload={handleUpload}
                onError={handleError}
                isLoading={validateMutation.isPending}
              />
            )}

            {state.step === 'validate' && state.validation && (
              <ImportValidationStep
                validation={state.validation}
                onContinue={handleValidationContinue}
                onBack={handleBack}
                isLoading={previewMutation.isPending}
              />
            )}

            {state.step === 'preview' && state.preview && (
              <ImportPreviewStep
                preview={state.preview}
                mode={state.mode}
                onModeChange={handleModeChange}
                onContinue={handlePreviewContinue}
                onBack={handleBack}
                hasConflicts={hasConflicts}
                isLoading={previewMutation.isPending}
              />
            )}

            {state.step === 'conflicts' && state.preview && (
              <ImportConflictStep
                conflicts={state.preview.conflicts}
                resolutions={state.resolutions}
                onResolve={handleResolve}
                onResolveAll={handleResolveAll}
                onContinue={handleConflictsContinue}
                onBack={handleBack}
              />
            )}

            {state.step === 'execute' && (
              <ImportExecuteStep
                isExecuting={executeMutation.isPending || (currentJobId !== null && !state.result && !state.error)}
                progress={executeProgress}
                result={state.result}
                error={state.error}
                onExecute={handleExecute}
                onBack={handleBack}
                onComplete={handleComplete}
                onCancel={currentJobId ? handleCancel : undefined}
                isCancelling={isCancelling}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export default ImportWizard
