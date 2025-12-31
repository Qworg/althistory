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

import { useReducer, useCallback, useState } from 'react'
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
import { AlthistoryExport, ImportMode, ConflictResolution, ImportResult } from '@/types'

export interface ImportWizardProps {
  isOpen: boolean
  onClose: () => void
  onImportComplete?: (result: ImportResult) => void
  targetGraphId?: string
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
}: ImportWizardProps) {
  const [state, dispatch] = useReducer(importReducer, {
    ...initialImportState,
    targetGraphId,
  })

  const [executeProgress, setExecuteProgress] = useState(0)

  const validateMutation = useValidateImport()
  const previewMutation = usePreviewImport()
  const executeMutation = useExecuteImport()

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
  // FIX #7: Use real progress from backend for async imports
  const handleExecute = useCallback(async () => {
    if (!state.data) return

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

      // Check if async import (has jobId)
      if ('jobId' in response && response.jobId) {
        // Poll for progress
        const pollInterval = setInterval(async () => {
          try {
            const job = await fetch(`/api/import/jobs/${response.jobId}`).then(r => r.json())
            if (job.progress !== undefined) {
              setExecuteProgress(job.progress)
            }
            if (job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled') {
              clearInterval(pollInterval)
              if (job.status === 'completed' && job.result) {
                dispatch({ type: 'SET_RESULT', payload: job.result })
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
        }, 500)
      } else {
        // Sync import - result is immediate
        setExecuteProgress(100)
        dispatch({ type: 'SET_RESULT', payload: response as unknown as ImportResult })
      }
    } catch (error) {
      setExecuteProgress(0)
      dispatch({
        type: 'SET_ERROR',
        payload: error instanceof Error ? error.message : 'Import failed',
      })
    }
  }, [state.data, state.targetGraphId, state.mode, state.resolutions, executeMutation])

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

  if (!isOpen) return null

  const currentStepIndex = STEP_ORDER.indexOf(state.step)
  const hasConflicts = (state.preview?.conflicts?.length ?? 0) > 0

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="flex min-h-screen items-center justify-center px-4 pt-4 pb-20 text-center sm:block sm:p-0">
        {/* Background overlay */}
        <div
          className="fixed inset-0 bg-gray-500 bg-opacity-75 transition-opacity"
          onClick={onClose}
        />

        {/* Modal panel */}
        <div className="inline-block transform overflow-hidden rounded-lg bg-white text-left align-bottom shadow-xl transition-all sm:my-8 sm:w-full sm:max-w-2xl sm:align-middle">
          {/* Header */}
          <div className="border-b border-gray-200 px-6 py-4">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-semibold text-gray-900">Import Data</h2>
              <button
                type="button"
                onClick={onClose}
                className="text-gray-400 hover:text-gray-500"
              >
                <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            </div>

            {/* Step indicators */}
            <div className="mt-4 flex items-center justify-between">
              {STEP_ORDER.map((step, index) => {
                // Skip conflicts step if no conflicts
                if (step === 'conflicts' && !hasConflicts && state.step !== 'conflicts') {
                  return null
                }

                const isActive = index === currentStepIndex
                const isCompleted = index < currentStepIndex
                // Note: isDisabled would be: index > currentStepIndex

                return (
                  <div key={step} className="flex items-center">
                    <div
                      className={`flex items-center justify-center w-8 h-8 rounded-full text-sm font-medium ${
                        isActive
                          ? 'bg-blue-600 text-white'
                          : isCompleted
                          ? 'bg-green-500 text-white'
                          : 'bg-gray-200 text-gray-500'
                      }`}
                    >
                      {isCompleted ? (
                        <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
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
                      />
                    )}
                  </div>
                )
              })}
            </div>
          </div>

          {/* Error Banner */}
          {state.error && (
            <div className="bg-red-50 border-l-4 border-red-400 p-4 mx-6 mt-4">
              <div className="flex">
                <svg className="h-5 w-5 text-red-400" fill="currentColor" viewBox="0 0 20 20">
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
                isExecuting={executeMutation.isPending}
                progress={executeProgress}
                result={state.result}
                error={state.error}
                onExecute={handleExecute}
                onBack={handleBack}
                onComplete={handleComplete}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export default ImportWizard
