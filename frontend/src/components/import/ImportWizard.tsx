/**
 * ImportWizard Component
 * 
 * Imports an althistory export file in up to five steps:
 * Upload, Validate, Preview, Conflicts (only when the preview finds some),
 * and Import. Built on ModalBase like every other dialog, so it shares its
 * focus handling, Escape behaviour, phone sheet and theme tokens.
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
import { storedCalendarSet } from '@althistory/calendar'
import { apiClient } from '@/services/api'
import { ModalBase } from '@/components/modals/ModalBase'

/** FIX #19: Default polling interval for async imports (500ms) */
export const DEFAULT_POLLING_INTERVAL_MS = 500

export interface ImportWizardProps {
  isOpen: boolean
  onClose: () => void
  onImportComplete?: (result: ImportResult) => void
  targetGraphId?: string
  /** FIX #19: Polling interval in ms for async import status checks (default: 500) */
  pollingIntervalMs?: number
  /** Name of the graph the import writes into, shown so the destination is never a guess. */
  targetGraphName?: string
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
  targetGraphName,
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
            // Through the API client, so the request carries the API key and
            // base URL like every other call (a bare fetch did neither).
            const job = await apiClient.import.getJob(jobId)
            
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
      await apiClient.import.cancelJob(currentJobId)
      // The polling will detect the cancelled status and update UI
    } catch (error) {
      console.error('Failed to cancel import:', error)
      // Don't reset isCancelling - let polling handle the state
    }
  }, [currentJobId])

  const hasConflicts = (state.preview?.conflicts?.length ?? 0) > 0
  // The steps the user will actually pass through: Conflicts only when the
  // preview found some. Numbering runs over these, so it never skips a number.
  const visibleSteps = STEP_ORDER.filter(
    (step) => step !== 'conflicts' || hasConflicts || state.step === 'conflicts'
  )
  const currentStepIndex = visibleSteps.indexOf(state.step)
  // While an import is running, a stray Escape or backdrop click must not
  // close the wizard and orphan the job.
  const isBusy =
    executeMutation.isPending || (currentJobId !== null && !state.result && !state.error)

  return (
    <ModalBase
      isOpen={isOpen}
      onClose={onClose}
      title="Import an export file"
      size="2xl"
      closeOnEscape={!isBusy}
      closeOnBackdrop={!isBusy}
      closeLabel="Close import"
    >
      <div className="space-y-5">
        {targetGraphName && (
          <p className="text-sm text-ink-secondary">
            Imports into <span className="font-medium text-ink">{targetGraphName}</span>
          </p>
        )}

        <ol aria-label="Import steps" className="flex flex-wrap items-center gap-x-2 gap-y-2">
          {visibleSteps.map((step, index) => {
            const isActive = index === currentStepIndex
            const isCompleted = currentStepIndex > index || (step === 'execute' && Boolean(state.result))
            const stepStatus = isCompleted ? 'done' : isActive ? 'current' : 'to do'

            return (
              <li
                key={step}
                className="flex items-center gap-2"
                aria-current={isActive ? 'step' : undefined}
              >
                <span
                  className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-medium font-mono-code ${
                    isActive
                      ? 'bg-ink text-card'
                      : isCompleted
                      ? 'border border-line bg-subtle text-ink-secondary'
                      : 'border border-line text-ink-muted'
                  }`}
                  aria-hidden="true"
                >
                  {isCompleted ? (
                    <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  ) : (
                    index + 1
                  )}
                </span>
                <span className={`text-sm ${isActive ? 'font-medium text-ink' : 'text-ink-muted'}`}>
                  <span className="sr-only">{`Step ${index + 1} of ${visibleSteps.length}: `}</span>
                  <span>{STEP_LABELS[step]}</span>
                  <span className="sr-only">{` (${stepStatus})`}</span>
                </span>
                {index < visibleSteps.length - 1 && (
                  <span className="h-px w-6 bg-line" aria-hidden="true" />
                )}
              </li>
            )
          })}
        </ol>

        {state.error && (
          <div
            role="alert"
            className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800"
          >
            {state.error}
          </div>
        )}

        <div>
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
              calendar={storedCalendarSet(state.data?.metadata?.calendar)}
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
              isExecuting={isBusy}
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
    </ModalBase>
  )
}

export default ImportWizard
