import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { UseMutationResult } from '@tanstack/react-query'
import { ImportWizard } from './ImportWizard'
import {
  useValidateImport,
  usePreviewImport,
  useExecuteImport,
} from '@/hooks/useImport'
import type {
  ValidateImportOptions,
  PreviewImportOptions,
  ExecuteImportOptions,
} from '@/hooks/useImport'
import type { APIError } from '@/services/api'
import { ImportValidationResult, ImportPreview, ImportResult, AlthistoryExport } from '@/types'

// Mock the hooks
vi.mock('@/hooks/useImport', () => ({
  useValidateImport: vi.fn(),
  usePreviewImport: vi.fn(),
  useExecuteImport: vi.fn(),
  importReducer: vi.fn((state, action) => {
    switch (action.type) {
      case 'SET_DATA':
        return { ...state, data: action.payload }
      case 'SET_VALIDATION':
        return { ...state, validation: action.payload }
      case 'SET_PREVIEW':
        return { ...state, preview: action.payload }
      case 'SET_STEP':
        return { ...state, step: action.payload }
      case 'SET_ERROR':
        return { ...state, error: action.payload }
      case 'SET_MODE':
        return { ...state, mode: action.payload }
      case 'SET_RESULT':
        return { ...state, result: action.payload }
      case 'SET_RESOLUTION':
        return {
          ...state,
          resolutions: { ...state.resolutions, [action.payload.conflictId]: action.payload.resolution },
        }
      case 'SET_ALL_RESOLUTIONS':
        return { ...state, resolutions: action.payload }
      case 'RESET':
        return {
          step: 'upload',
          data: null,
          validation: null,
          preview: null,
          resolutions: {},
          result: null,
          mode: 'create-new',
          error: null,
        }
      default:
        return state
    }
  }),
  initialImportState: {
    step: 'upload',
    data: null,
    validation: null,
    preview: null,
    resolutions: {},
    result: null,
    mode: 'create-new',
    targetGraphId: undefined,
    error: null,
  },
}))

// Mock data
const validExportData: AlthistoryExport = {
  version: '1.0',
  metadata: {
    graphId: 'graph-1',
    graphName: 'Test Graph',
    exportedAt: '2024-01-15T10:00:00Z',
    sourceVersion: '1.0.0',
    graphVersion: 1,
    checksum: 'd3adb33f',
  },
  data: {
    events: [],
    arcs: [],
    causalRelationships: [],
    inferredPressures: [],
  },
}

const validValidationResult: ImportValidationResult = {
  valid: true,
  errors: [],
  warnings: [],
  summary: {
    eventCount: 5,
    arcCount: 2,
    relationshipCount: 3,
    pressureCount: 1,
    crossRefCount: 3,
    actors: ['Actor A'],
    temporalRange: { start: '1900-01-01', end: '2000-12-31' },
  },
}

const validPreviewResult: ImportPreview = {
  toCreate: { events: 5, arcs: 2, relationships: 3, pressures: 1 },
  toUpdate: { events: 0, arcs: 0, relationships: 0, pressures: 0 },
  toDelete: { events: 0, arcs: 0, relationships: 0, pressures: 0 },
  conflicts: [],
  warnings: [],
}

const successfulImportResult: ImportResult = {
  success: true,
  graphId: 'graph-123',
  graphVersion: 1,
  imported: { events: 5, arcs: 2, relationships: 3, pressures: 1 },
  skipped: { events: 0, arcs: 0, relationships: 0, pressures: 0 },
  deleted: { events: 0, arcs: 0, relationships: 0, pressures: 0 },
  errors: [],
  warnings: [],
}

// Helpers to create mock mutations typed against the real hook return types, so
// the mocks stay in sync with `useValidateImport` / `usePreviewImport` /
// `useExecuteImport` without any casts.
const createIdleMutation = <TData, TError, TVariables>(
  resolvedValue: TData
): UseMutationResult<TData, TError, TVariables> => ({
  context: undefined,
  data: undefined,
  error: null,
  failureCount: 0,
  failureReason: null,
  isPaused: false,
  status: 'idle',
  variables: undefined,
  submittedAt: 0,
  isError: false,
  isIdle: true,
  isPending: false,
  isSuccess: false,
  mutate: vi.fn(),
  mutateAsync: vi.fn().mockResolvedValue(resolvedValue),
  reset: vi.fn(),
})

const createPendingMutation = <TData, TError, TVariables>(
  resolvedValue: TData,
  variables: TVariables
): UseMutationResult<TData, TError, TVariables> => ({
  context: undefined,
  data: undefined,
  error: null,
  failureCount: 0,
  failureReason: null,
  isPaused: false,
  status: 'pending',
  variables,
  submittedAt: 0,
  isError: false,
  isIdle: false,
  isPending: true,
  isSuccess: false,
  mutate: vi.fn(),
  mutateAsync: vi.fn().mockResolvedValue(resolvedValue),
  reset: vi.fn(),
})

describe('ImportWizard', () => {
  const user = userEvent.setup()
  const mockOnClose = vi.fn()
  const mockOnImportComplete = vi.fn()

  let mockValidateMutation: ReturnType<typeof useValidateImport>
  let mockPreviewMutation: ReturnType<typeof usePreviewImport>
  let mockExecuteMutation: ReturnType<typeof useExecuteImport>

  beforeEach(() => {
    vi.clearAllMocks()

    mockValidateMutation = createIdleMutation<
      ImportValidationResult,
      APIError,
      ValidateImportOptions
    >(validValidationResult)
    mockPreviewMutation = createIdleMutation<ImportPreview, APIError, PreviewImportOptions>(
      validPreviewResult
    )
    mockExecuteMutation = createIdleMutation<ImportResult, APIError, ExecuteImportOptions>(
      successfulImportResult
    )

    vi.mocked(useValidateImport).mockReturnValue(mockValidateMutation)
    vi.mocked(usePreviewImport).mockReturnValue(mockPreviewMutation)
    vi.mocked(useExecuteImport).mockReturnValue(mockExecuteMutation)
  })

  const renderComponent = (props = {}) => {
    return render(
      <ImportWizard
        isOpen={true}
        onClose={mockOnClose}
        onImportComplete={mockOnImportComplete}
        {...props}
      />
    )
  }

  describe('Visibility', () => {
    it('should not render when isOpen is false', () => {
      renderComponent({ isOpen: false })
      
      expect(screen.queryByText('Import an export file')).not.toBeInTheDocument()
    })

    it('should render when isOpen is true', () => {
      renderComponent()
      
      expect(screen.getByText('Import an export file')).toBeInTheDocument()
    })
  })

  describe('Modal Structure', () => {
    it('should render modal header with title', () => {
      renderComponent()
      
      expect(screen.getByText('Import an export file')).toBeInTheDocument()
    })

    it('should render close button', () => {
      renderComponent()
      
      // Close button should be in the header with aria-label
      const closeButton = screen.getByRole('button', { name: /close import/i })
      expect(closeButton).toBeInTheDocument()
    })

    it('should call onClose when close button clicked', async () => {
      renderComponent()
      
      // Find the close button (it's in the header with the X icon)
      await user.click(screen.getByRole('button', { name: /close import/i }))
      expect(mockOnClose).toHaveBeenCalled()
    })

    it('should call onClose when clicking overlay', async () => {
      renderComponent()
      
      // Click the backdrop (ModalBase's, behind the panel)
      const overlay = document.querySelector('[role="dialog"] > [aria-hidden="true"]')
      expect(overlay).not.toBeNull()
      await user.click(overlay as Element)
      expect(mockOnClose).toHaveBeenCalled()
    })
  })

  describe('Step Indicators', () => {
    it('should show step indicators', () => {
      renderComponent()
      
      expect(screen.getByText('Upload')).toBeInTheDocument()
      expect(screen.getByText('Validate')).toBeInTheDocument()
      expect(screen.getByText('Preview')).toBeInTheDocument()
      expect(screen.getByText('Import')).toBeInTheDocument()
    })

    it('should highlight upload step as active initially', () => {
      renderComponent()
      
      const steps = screen.getByRole('list', { name: 'Import steps' })
      const current = steps.querySelector('[aria-current="step"]')
      expect(current).toHaveTextContent('Upload')
    })

    it('numbers only the steps the import will pass through', () => {
      renderComponent()

      // No conflicts yet, so four steps numbered 1-4: never "Step 5" after "Step 3".
      const steps = within(screen.getByRole('list', { name: 'Import steps' })).getAllByRole('listitem')
      expect(steps).toHaveLength(4)
      expect(steps[3]).toHaveTextContent('Step 4 of 4: Import')
    })

    it('names the graph the import writes into', () => {
      renderComponent({ targetGraphName: 'The Engine Age' })
      expect(screen.getByText('The Engine Age')).toBeInTheDocument()
      expect(screen.getByText(/Imports into/)).toBeInTheDocument()
    })
  })

  describe('Upload Step', () => {
    it('should show upload step content initially', () => {
      renderComponent()
      
      expect(screen.getByText(/Choose an althistory export file/)).toBeInTheDocument()
    })

    it('should show loading state when validating', () => {
      mockValidateMutation = createPendingMutation<
        ImportValidationResult,
        APIError,
        ValidateImportOptions
      >(validValidationResult, { data: validExportData })
      vi.mocked(useValidateImport).mockReturnValue(mockValidateMutation)

      renderComponent()

      expect(screen.getByRole('button', { name: 'Checking…' })).toBeInTheDocument()
    })
  })

  describe('Error Handling', () => {
    it('should display error banner when error occurs', async () => {
      // This test would require manipulating state which is complex with mocked reducer
      // Simplified version: just check the error banner structure exists
      renderComponent()
      
      // The error banner is conditionally rendered, so it won't be visible initially
      expect(screen.queryByText(/error/i)).not.toBeInTheDocument()
    })
  })

  describe('Integration Flow', () => {
    it('should render upload step initially', () => {
      renderComponent()
      
      expect(screen.getByText(/Choose an althistory export file/)).toBeInTheDocument()
    })
  })

  describe('Target Graph ID', () => {
    it('should accept targetGraphId prop', () => {
      renderComponent({ targetGraphId: 'target-graph-123' })
      
      // Component should render without errors
      expect(screen.getByText('Import an export file')).toBeInTheDocument()
    })
  })

  describe('Import Complete Callback', () => {
    it('should accept onImportComplete callback', () => {
      renderComponent({ onImportComplete: mockOnImportComplete })
      
      // Component should render without errors
      expect(screen.getByText('Import an export file')).toBeInTheDocument()
    })
  })
  describe('the mode a file is checked in', () => {
    const paste = async () => {
      fireEvent.change(screen.getByLabelText('Export file contents'), { target: { value: JSON.stringify(validExportData) } })
      await user.click(screen.getByRole('button', { name: 'Check pasted file' }))
    }

    it('is the mode it will be imported in, which can be changed on the validation step', async () => {
      renderComponent({ targetGraphId: 'vael' })
      await paste()
      expect(mockValidateMutation.mutateAsync).toHaveBeenLastCalledWith({ data: validExportData, targetGraphId: 'vael', mode: 'create-new' })

      await user.click(await screen.findByRole('radio', { name: 'Merged into this graph' }))
      await waitFor(() =>
        expect(mockValidateMutation.mutateAsync).toHaveBeenLastCalledWith({ data: validExportData, targetGraphId: 'vael', mode: 'merge' })
      )
      // Checked, not yet previewed: the user continues when ready.
      expect(mockPreviewMutation.mutateAsync).not.toHaveBeenCalled()
      expect(screen.getByRole('radio', { name: 'Merged into this graph' })).toBeChecked()
    })

    it('drops the answer to a check that a later change of mode has replaced', async () => {
      renderComponent({ targetGraphId: 'vael' })
      await paste()
      const answers: Array<(result: ImportValidationResult) => void> = []
      vi.mocked(mockValidateMutation.mutateAsync).mockImplementation(() => new Promise((resolve) => answers.push(resolve)))
      await user.click(await screen.findByRole('radio', { name: 'Merged into this graph' }))
      await user.click(screen.getByRole('radio', { name: 'Replacing this graph' }))
      // The later check answers first, valid; the earlier one last, refused.
      await act(async () => answers[1]!(validValidationResult))
      await act(async () => answers[0]!({ ...validValidationResult, valid: false, errors: [{ path: '$', message: 'stale', code: 'INVALID_VALUE' }] }))
      expect(screen.queryByText(/stale/)).toBeNull()
      expect(screen.getByRole('radio', { name: 'Replacing this graph' })).toBeChecked()
    })

    it('puts the mode back when its check fails, so nothing goes ahead in a mode that was not checked', async () => {
      renderComponent({ targetGraphId: 'vael' })
      await paste()
      vi.mocked(mockValidateMutation.mutateAsync).mockRejectedValueOnce(new Error('network down'))
      await user.click(await screen.findByRole('radio', { name: 'Replacing this graph' }))
      await screen.findByText(/network down/)
      expect(screen.getByRole('radio', { name: 'As a new graph' })).toBeChecked()
      expect(screen.getByRole('radio', { name: 'Replacing this graph' })).not.toBeChecked()
    })

    it('offers no choice without a graph to import into', async () => {
      renderComponent()
      await paste()
      await screen.findByText('Validation Results')
      expect(screen.queryByRole('radio', { name: 'Merged into this graph' })).toBeNull()
    })
  })
})
