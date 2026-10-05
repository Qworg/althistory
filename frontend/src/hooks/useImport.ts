/**
 * useImport Hook
 * 
 * Provides React Query hooks for import operations:
 * - Validate import data
 * - Generate import preview
 * - Execute import with conflict resolution
 */

import { useMutation, UseMutationOptions } from '@tanstack/react-query'
import { apiClient, APIError } from '@/services/api'
import {
  AlthistoryExport,
  ImportValidationResult,
  ImportPreview,
  ImportResult,
  ImportMode,
  ConflictResolution,
} from '@/types'

// Types for mutation options
export interface ValidateImportOptions {
  data: AlthistoryExport
}

export interface PreviewImportOptions {
  data: AlthistoryExport
  targetGraphId?: string
  mode?: ImportMode
}

export interface ExecuteImportOptions {
  data: AlthistoryExport
  targetGraphId?: string
  mode: ImportMode
  conflictResolution: ConflictResolution | 'manual'
  manualResolutions?: Record<string, ConflictResolution>
}

/**
 * Hook for validating import data
 */
export function useValidateImport(
  options?: UseMutationOptions<ImportValidationResult, APIError, ValidateImportOptions>
) {
  return useMutation({
    mutationFn: async ({ data }: ValidateImportOptions) => {
      return apiClient.import.validate(data)
    },
    ...options,
  })
}

/**
 * Hook for generating import preview
 */
export function usePreviewImport(
  options?: UseMutationOptions<ImportPreview, APIError, PreviewImportOptions>
) {
  return useMutation({
    mutationFn: async ({ data, targetGraphId, mode = 'create-new' }: PreviewImportOptions) => {
      return apiClient.import.preview(data, targetGraphId, mode)
    },
    ...options,
  })
}

/**
 * Hook for executing import
 */
export function useExecuteImport(
  options?: UseMutationOptions<ImportResult, APIError, ExecuteImportOptions>
) {
  return useMutation({
    mutationFn: async ({
      data,
      targetGraphId,
      mode,
      conflictResolution,
      manualResolutions,
    }: ExecuteImportOptions) => {
      return apiClient.import.execute(data, {
        targetGraphId,
        mode,
        conflictResolution,
        manualResolutions,
      })
    },
    ...options,
  })
}

/**
 * Combined import state for wizard
 */
export interface ImportWizardState {
  step: 'upload' | 'validate' | 'preview' | 'conflicts' | 'execute' | 'complete'
  data: AlthistoryExport | null
  validation: ImportValidationResult | null
  preview: ImportPreview | null
  resolutions: Record<string, ConflictResolution>
  result: ImportResult | null
  mode: ImportMode
  targetGraphId?: string
  error: string | null
}

export const initialImportState: ImportWizardState = {
  step: 'upload',
  data: null,
  validation: null,
  preview: null,
  resolutions: {},
  result: null,
  mode: 'create-new',
  targetGraphId: undefined,
  error: null,
}

export type ImportAction =
  | { type: 'SET_DATA'; payload: AlthistoryExport }
  | { type: 'SET_VALIDATION'; payload: ImportValidationResult }
  | { type: 'SET_PREVIEW'; payload: ImportPreview }
  | { type: 'SET_RESOLUTION'; payload: { conflictId: string; resolution: ConflictResolution } }
  | { type: 'SET_ALL_RESOLUTIONS'; payload: Record<string, ConflictResolution> }
  | { type: 'SET_RESULT'; payload: ImportResult }
  | { type: 'SET_MODE'; payload: ImportMode }
  | { type: 'SET_TARGET_GRAPH'; payload: string | undefined }
  | { type: 'SET_STEP'; payload: ImportWizardState['step'] }
  | { type: 'SET_ERROR'; payload: string | null }
  | { type: 'RESET' }

export function importReducer(state: ImportWizardState, action: ImportAction): ImportWizardState {
  switch (action.type) {
    case 'SET_DATA':
      return { ...state, data: action.payload, error: null }
    case 'SET_VALIDATION':
      return { ...state, validation: action.payload, error: null }
    case 'SET_PREVIEW':
      return { ...state, preview: action.payload, error: null }
    case 'SET_RESOLUTION':
      return {
        ...state,
        resolutions: {
          ...state.resolutions,
          [action.payload.conflictId]: action.payload.resolution,
        },
      }
    case 'SET_ALL_RESOLUTIONS':
      return { ...state, resolutions: action.payload }
    case 'SET_RESULT':
      return { ...state, result: action.payload, error: null }
    case 'SET_MODE':
      return { ...state, mode: action.payload }
    case 'SET_TARGET_GRAPH':
      return { ...state, targetGraphId: action.payload }
    case 'SET_STEP':
      return { ...state, step: action.payload }
    case 'SET_ERROR':
      return { ...state, error: action.payload }
    case 'RESET':
      return initialImportState
    default:
      return state
  }
}
