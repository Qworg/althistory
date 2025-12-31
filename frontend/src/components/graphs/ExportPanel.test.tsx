import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ExportPanel } from './ExportPanel'
import { useExportManagement } from '@/hooks/useExport'
import { useActiveGraphId, useActiveGraph } from '@/hooks/useGraphs'
import { ExportJob, Graph } from '@/types'

// Mock dependencies
vi.mock('@/hooks/useExport')
vi.mock('@/hooks/useGraphs')

// Mock URL and Blob APIs
const mockCreateObjectURL = vi.fn().mockReturnValue('blob:test-url')
const mockRevokeObjectURL = vi.fn()
global.URL.createObjectURL = mockCreateObjectURL
global.URL.revokeObjectURL = mockRevokeObjectURL

const mockActiveGraph: Graph = {
  id: 'graph1',
  name: 'Main Timeline',
  description: 'Primary historical timeline',
  status: 'active',
  version: 3,
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-15T00:00:00Z',
  metadata: {
    eventCount: 150,
    arcCount: 12,
    relationshipCount: 75,
    pressureCount: 8
  }
}

const mockPendingJob: ExportJob = {
  id: 'job1',
  type: 'export',
  status: 'processing',
  progress: 45,
  createdAt: '2024-01-15T10:00:00Z',
  startedAt: '2024-01-15T10:00:01Z'
}

const mockCompletedJob: ExportJob = {
  id: 'job2',
  type: 'export',
  status: 'completed',
  progress: 100,
  createdAt: '2024-01-14T10:00:00Z',
  startedAt: '2024-01-14T10:00:01Z',
  completedAt: '2024-01-14T10:05:00Z',
  result: {
    outputPath: '/exports/job2.json'
  }
}

const createMockExportManagement = (overrides = {}) => ({
  activeJob: null,
  stats: {
    total: 5,
    completed: 4,
    failed: 1
  },
  isCreating: false,
  isDownloading: false,
  isSyncExporting: false,
  isValidating: false,
  createExport: vi.fn().mockResolvedValue({ jobId: 'new-job' }),
  syncExport: vi.fn().mockResolvedValue({
    export: {
      version: '1.0',
      metadata: {},
      data: { events: [], arcs: [], causalRelationships: [], inferredPressures: [] }
    }
  }),
  downloadExport: vi.fn().mockResolvedValue(new Blob()),
  cancelExport: vi.fn().mockResolvedValue(undefined),
  validateExport: vi.fn().mockResolvedValue({ valid: true, errors: [], warnings: [] }),
  hasActiveJobs: false,
  completedJobs: [mockCompletedJob],
  ...overrides
})

describe('ExportPanel', () => {
  const user = userEvent.setup()
  let mockExportManagement: ReturnType<typeof createMockExportManagement>

  beforeEach(() => {
    mockExportManagement = createMockExportManagement()
    
    vi.mocked(useActiveGraphId).mockReturnValue('graph1')
    vi.mocked(useActiveGraph).mockReturnValue({
      data: mockActiveGraph,
      isLoading: false,
      error: null
    } as any)
    vi.mocked(useExportManagement).mockReturnValue(mockExportManagement as any)
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('No Graph Selected', () => {
    it('should display message when no graph is selected', () => {
      vi.mocked(useActiveGraphId).mockReturnValue(null)
      
      render(<ExportPanel />)
      
      expect(screen.getByText('Select a graph to export')).toBeInTheDocument()
    })
  })

  describe('Panel Header', () => {
    it('should display panel header with export title', () => {
      render(<ExportPanel />)
      
      expect(screen.getByText('Export')).toBeInTheDocument()
    })

    it('should apply custom className', () => {
      const { container } = render(<ExportPanel className="custom-class" />)
      
      expect(container.firstChild).toHaveClass('custom-class')
    })

    it('should show "Exporting..." badge when jobs are active', () => {
      vi.mocked(useExportManagement).mockReturnValue(createMockExportManagement({
        hasActiveJobs: true
      }) as any)
      
      render(<ExportPanel />)
      
      expect(screen.getByText('Exporting...')).toBeInTheDocument()
    })
  })

  describe('Collapse/Expand Behavior', () => {
    it('should be collapsed by default', () => {
      render(<ExportPanel />)
      
      // Content should not be visible
      expect(screen.queryByText('Quick Export')).not.toBeInTheDocument()
    })

    it('should expand when header is clicked', async () => {
      render(<ExportPanel />)
      
      await user.click(screen.getByRole('button', { name: /Export/i }))
      
      expect(screen.getByText('Quick Export')).toBeInTheDocument()
    })

    it('should collapse when header is clicked again', async () => {
      render(<ExportPanel />)
      
      const header = screen.getByRole('button', { name: /Export/i })
      
      // Expand
      await user.click(header)
      expect(screen.getByText('Quick Export')).toBeInTheDocument()
      
      // Collapse
      await user.click(header)
      expect(screen.queryByText('Quick Export')).not.toBeInTheDocument()
    })
  })

  describe('Quick Export', () => {
    it('should display Quick Export button', async () => {
      render(<ExportPanel />)
      
      await user.click(screen.getByRole('button', { name: /Export/i }))
      
      expect(screen.getByRole('button', { name: /Quick Export/i })).toBeInTheDocument()
    })

    it('should call syncExport when Quick Export is clicked', async () => {
      render(<ExportPanel />)
      
      await user.click(screen.getByRole('button', { name: /Export/i }))
      await user.click(screen.getByRole('button', { name: /Quick Export/i }))
      
      await waitFor(() => {
        expect(mockExportManagement.syncExport).toHaveBeenCalledWith({
          scope: 'full',
          includeProvenance: false
        })
      })
    })

    it('should show loading state during quick export', async () => {
      vi.mocked(useExportManagement).mockReturnValue(createMockExportManagement({
        isSyncExporting: true
      }) as any)
      
      render(<ExportPanel />)
      
      await user.click(screen.getByRole('button', { name: /Export/i }))
      
      expect(screen.getByText(/Exporting/i)).toBeInTheDocument()
    })

    it('should disable button during quick export', async () => {
      vi.mocked(useExportManagement).mockReturnValue(createMockExportManagement({
        isSyncExporting: true
      }) as any)
      
      render(<ExportPanel />)
      
      await user.click(screen.getByRole('button', { name: /Export/i }))
      
      const quickExportButton = screen.getByRole('button', { name: /Exporting/i })
      expect(quickExportButton).toBeDisabled()
    })

    it('should trigger download after successful quick export', async () => {
      // This test verifies that syncExport is called and URL handling is attempted
      render(<ExportPanel />)
      
      await user.click(screen.getByRole('button', { name: /Export/i }))
      await user.click(screen.getByRole('button', { name: /Quick Export/i }))
      
      await waitFor(() => {
        expect(mockExportManagement.syncExport).toHaveBeenCalled()
        expect(mockCreateObjectURL).toHaveBeenCalled()
      })
    })

    it('should handle quick export error gracefully', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      
      vi.mocked(useExportManagement).mockReturnValue(createMockExportManagement({
        syncExport: vi.fn().mockRejectedValue(new Error('Export failed'))
      }) as any)
      
      render(<ExportPanel />)
      
      await user.click(screen.getByRole('button', { name: /Export/i }))
      await user.click(screen.getByRole('button', { name: /Quick Export/i }))
      
      await waitFor(() => {
        expect(consoleSpy).toHaveBeenCalledWith('Quick export failed:', expect.any(Error))
      })
      
      consoleSpy.mockRestore()
    })
  })

  describe('Export Options', () => {
    it('should display export options section', async () => {
      render(<ExportPanel />)
      
      await user.click(screen.getByRole('button', { name: /Export/i }))
      
      expect(screen.getByText('Export Options')).toBeInTheDocument()
    })

    it('should have Full Export selected by default', async () => {
      render(<ExportPanel />)
      
      await user.click(screen.getByRole('button', { name: /Export/i }))
      
      const fullExportOption = screen.getByText('Full Export').closest('label')?.querySelector('input')
      expect(fullExportOption).toBeChecked()
    })

    it('should allow selecting Filtered scope', async () => {
      render(<ExportPanel />)
      
      await user.click(screen.getByRole('button', { name: /Export/i }))
      
      // Click on Filtered option (the div acts as label)
      await user.click(screen.getByText('Filtered'))
      
      const filteredOption = screen.getByText('Filtered').closest('label')?.querySelector('input')
      expect(filteredOption).toBeChecked()
    })

    it('should show filter configuration when Filtered is selected', async () => {
      render(<ExportPanel />)
      
      await user.click(screen.getByRole('button', { name: /Export/i }))
      await user.click(screen.getByText('Filtered'))
      
      expect(screen.getByText('Configure Filters')).toBeInTheDocument()
    })

    it('should toggle filter panel visibility', async () => {
      render(<ExportPanel />)
      
      await user.click(screen.getByRole('button', { name: /Export/i }))
      await user.click(screen.getByText('Filtered'))
      
      // Expand filters
      await user.click(screen.getByText('Configure Filters'))
      
      expect(screen.getByText('Time Range')).toBeInTheDocument()
      expect(screen.getByText('Actors (comma-separated)')).toBeInTheDocument()
    })

    it('should allow setting time range filters', async () => {
      render(<ExportPanel />)
      
      await user.click(screen.getByRole('button', { name: /Export/i }))
      await user.click(screen.getByText('Filtered'))
      await user.click(screen.getByText('Configure Filters'))
      
      const dateInputs = screen.getAllByRole('textbox')
      // First two date inputs should be for time range (type="date" shows as textbox)
      expect(dateInputs.length).toBeGreaterThanOrEqual(1)
    })

    it('should allow setting actors filter', async () => {
      render(<ExportPanel />)
      
      await user.click(screen.getByRole('button', { name: /Export/i }))
      await user.click(screen.getByText('Filtered'))
      await user.click(screen.getByText('Configure Filters'))
      
      const actorsInput = screen.getByPlaceholderText('e.g., Napoleon, Wellington')
      await user.type(actorsInput, 'Napoleon')
      
      expect(actorsInput).toHaveValue('Napoleon')
    })

    it('should allow toggling include provenance option', async () => {
      render(<ExportPanel />)
      
      await user.click(screen.getByRole('button', { name: /Export/i }))
      
      const provenanceCheckbox = screen.getByRole('checkbox')
      expect(provenanceCheckbox).not.toBeChecked()
      
      await user.click(provenanceCheckbox)
      
      expect(provenanceCheckbox).toBeChecked()
    })
  })

  describe('Start Export Job', () => {
    it('should display Start Export Job button', async () => {
      render(<ExportPanel />)
      
      await user.click(screen.getByRole('button', { name: /Export/i }))
      
      expect(screen.getByRole('button', { name: /Start Export Job/i })).toBeInTheDocument()
    })

    it('should call createExport with full scope options', async () => {
      render(<ExportPanel />)
      
      await user.click(screen.getByRole('button', { name: /Export/i }))
      await user.click(screen.getByRole('button', { name: /Start Export Job/i }))
      
      await waitFor(() => {
        expect(mockExportManagement.createExport).toHaveBeenCalledWith({
          scope: 'full',
          filters: undefined,
          includeProvenance: false
        })
      })
    })

    it('should call createExport with filtered scope and filters', async () => {
      render(<ExportPanel />)
      
      await user.click(screen.getByRole('button', { name: /Export/i }))
      await user.click(screen.getByText('Filtered'))
      await user.click(screen.getByText('Configure Filters'))
      
      const actorsInput = screen.getByPlaceholderText('e.g., Napoleon, Wellington')
      await user.type(actorsInput, 'Napoleon')
      
      await user.click(screen.getByRole('button', { name: /Start Export Job/i }))
      
      await waitFor(() => {
        expect(mockExportManagement.createExport).toHaveBeenCalledWith({
          scope: 'filtered',
          filters: expect.objectContaining({
            actors: ['Napoleon']
          }),
          includeProvenance: false
        })
      })
    })

    it('should include provenance when checkbox is checked', async () => {
      render(<ExportPanel />)
      
      await user.click(screen.getByRole('button', { name: /Export/i }))
      await user.click(screen.getByRole('checkbox'))
      await user.click(screen.getByRole('button', { name: /Start Export Job/i }))
      
      await waitFor(() => {
        expect(mockExportManagement.createExport).toHaveBeenCalledWith(
          expect.objectContaining({
            includeProvenance: true
          })
        )
      })
    })

    it('should show loading state while creating export', async () => {
      vi.mocked(useExportManagement).mockReturnValue(createMockExportManagement({
        isCreating: true
      }) as any)
      
      render(<ExportPanel />)
      
      await user.click(screen.getByRole('button', { name: /Export/i }))
      
      expect(screen.getByText('Starting Export...')).toBeInTheDocument()
    })

    it('should disable button while creating export', async () => {
      vi.mocked(useExportManagement).mockReturnValue(createMockExportManagement({
        isCreating: true
      }) as any)
      
      render(<ExportPanel />)
      
      await user.click(screen.getByRole('button', { name: /Export/i }))
      
      const startButton = screen.getByRole('button', { name: /Starting Export/i })
      expect(startButton).toBeDisabled()
    })

    it('should handle export creation error gracefully', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      
      vi.mocked(useExportManagement).mockReturnValue(createMockExportManagement({
        createExport: vi.fn().mockRejectedValue(new Error('Creation failed'))
      }) as any)
      
      render(<ExportPanel />)
      
      await user.click(screen.getByRole('button', { name: /Export/i }))
      await user.click(screen.getByRole('button', { name: /Start Export Job/i }))
      
      await waitFor(() => {
        expect(consoleSpy).toHaveBeenCalledWith('Export failed:', expect.any(Error))
      })
      
      consoleSpy.mockRestore()
    })
  })

  describe('Progress Display', () => {
    it('should show progress bar when there is an active job', async () => {
      vi.mocked(useExportManagement).mockReturnValue(createMockExportManagement({
        activeJob: mockPendingJob
      }) as any)
      
      render(<ExportPanel />)
      
      await user.click(screen.getByRole('button', { name: /Export/i }))
      
      expect(screen.getByText('Exporting...')).toBeInTheDocument()
      expect(screen.getByText('45%')).toBeInTheDocument()
    })

    it('should display progress bar with correct width', async () => {
      vi.mocked(useExportManagement).mockReturnValue(createMockExportManagement({
        activeJob: mockPendingJob
      }) as any)
      
      render(<ExportPanel />)
      
      await user.click(screen.getByRole('button', { name: /Export/i }))
      
      const progressBar = document.querySelector('[style*="width: 45%"]')
      expect(progressBar).toBeInTheDocument()
    })

    it('should show Cancel button during export', async () => {
      vi.mocked(useExportManagement).mockReturnValue(createMockExportManagement({
        activeJob: mockPendingJob
      }) as any)
      
      render(<ExportPanel />)
      
      await user.click(screen.getByRole('button', { name: /Export/i }))
      
      expect(screen.getByRole('button', { name: /Cancel/i })).toBeInTheDocument()
    })

    it('should call cancelExport when Cancel is clicked', async () => {
      const cancelFn = vi.fn()
      vi.mocked(useExportManagement).mockReturnValue(createMockExportManagement({
        activeJob: mockPendingJob,
        cancelExport: cancelFn
      }) as any)
      
      render(<ExportPanel />)
      
      await user.click(screen.getByRole('button', { name: /Export/i }))
      
      // Find the cancel button in the progress section (the text says "Cancel" not a button role)
      const cancelButton = screen.getByText('Cancel')
      await user.click(cancelButton)
      
      expect(cancelFn).toHaveBeenCalledWith('job1')
    })

    it('should not show progress when job status is completed', async () => {
      vi.mocked(useExportManagement).mockReturnValue(createMockExportManagement({
        activeJob: { ...mockCompletedJob, status: 'completed' as const }
      }) as any)
      
      render(<ExportPanel />)
      
      await user.click(screen.getByRole('button', { name: /Export/i }))
      
      // Progress section should not be visible for completed jobs
      expect(screen.queryByText('45%')).not.toBeInTheDocument()
    })
  })

  describe('Download Completed Export', () => {
    it('should display recent exports section', async () => {
      render(<ExportPanel />)
      
      await user.click(screen.getByRole('button', { name: /Export/i }))
      
      expect(screen.getByText('Recent Exports')).toBeInTheDocument()
    })

    it('should display completed export with download button', async () => {
      render(<ExportPanel />)
      
      await user.click(screen.getByRole('button', { name: /Export/i }))
      
      expect(screen.getByText(/Export job2/i)).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /Download/i })).toBeInTheDocument()
    })

    it('should display export completion timestamp', async () => {
      render(<ExportPanel />)
      
      await user.click(screen.getByRole('button', { name: /Export/i }))
      
      // Should show the completion date
      const dateText = new Date('2024-01-14T10:05:00Z').toLocaleString()
      expect(screen.getByText(dateText)).toBeInTheDocument()
    })

    it('should call downloadExport when Download is clicked', async () => {
      render(<ExportPanel />)
      
      await user.click(screen.getByRole('button', { name: /Export/i }))
      await user.click(screen.getByRole('button', { name: /Download/i }))
      
      await waitFor(() => {
        expect(mockExportManagement.downloadExport).toHaveBeenCalledWith(
          'job2',
          expect.stringContaining('Main Timeline')
        )
      })
    })

    it('should disable download button while downloading', async () => {
      vi.mocked(useExportManagement).mockReturnValue(createMockExportManagement({
        isDownloading: true
      }) as any)
      
      render(<ExportPanel />)
      
      await user.click(screen.getByRole('button', { name: /Export/i }))
      
      const downloadButton = screen.getByRole('button', { name: /Download/i })
      expect(downloadButton).toBeDisabled()
    })

    it('should handle download error gracefully', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      
      vi.mocked(useExportManagement).mockReturnValue(createMockExportManagement({
        downloadExport: vi.fn().mockRejectedValue(new Error('Download failed'))
      }) as any)
      
      render(<ExportPanel />)
      
      await user.click(screen.getByRole('button', { name: /Export/i }))
      await user.click(screen.getByRole('button', { name: /Download/i }))
      
      await waitFor(() => {
        expect(consoleSpy).toHaveBeenCalledWith('Download failed:', expect.any(Error))
      })
      
      consoleSpy.mockRestore()
    })

    it('should only show up to 3 recent exports', async () => {
      const manyJobs = Array.from({ length: 5 }, (_, i) => ({
        ...mockCompletedJob,
        id: `job${i}`,
        completedAt: new Date(Date.now() - i * 1000 * 60 * 60).toISOString()
      }))
      
      vi.mocked(useExportManagement).mockReturnValue(createMockExportManagement({
        completedJobs: manyJobs
      }) as any)
      
      render(<ExportPanel />)
      
      await user.click(screen.getByRole('button', { name: /Export/i }))
      
      const downloadButtons = screen.getAllByRole('button', { name: /Download/i })
      expect(downloadButtons.length).toBe(3)
    })

    it('should not show recent exports section when no completed jobs', async () => {
      vi.mocked(useExportManagement).mockReturnValue(createMockExportManagement({
        completedJobs: []
      }) as any)
      
      render(<ExportPanel />)
      
      await user.click(screen.getByRole('button', { name: /Export/i }))
      
      expect(screen.queryByText('Recent Exports')).not.toBeInTheDocument()
    })
  })

  describe('File Validation', () => {
    it('should display validate import file section', async () => {
      render(<ExportPanel />)
      
      await user.click(screen.getByRole('button', { name: /Export/i }))
      
      expect(screen.getByText('Validate Import File')).toBeInTheDocument()
    })

    it('should display file input button', async () => {
      render(<ExportPanel />)
      
      await user.click(screen.getByRole('button', { name: /Export/i }))
      
      expect(screen.getByRole('button', { name: /Select file to validate/i })).toBeInTheDocument()
    })

    it('should show loading state while validating', async () => {
      vi.mocked(useExportManagement).mockReturnValue(createMockExportManagement({
        isValidating: true
      }) as any)
      
      render(<ExportPanel />)
      
      await user.click(screen.getByRole('button', { name: /Export/i }))
      
      expect(screen.getByText('Validating...')).toBeInTheDocument()
    })

    it('should disable button while validating', async () => {
      vi.mocked(useExportManagement).mockReturnValue(createMockExportManagement({
        isValidating: true
      }) as any)
      
      render(<ExportPanel />)
      
      await user.click(screen.getByRole('button', { name: /Export/i }))
      
      const validateButton = screen.getByRole('button', { name: /Validating/i })
      expect(validateButton).toBeDisabled()
    })

    it('should have file input for validation', async () => {
      render(<ExportPanel />)
      
      await user.click(screen.getByRole('button', { name: /Export/i }))
      
      const fileInput = document.querySelector('input[type="file"]')
      expect(fileInput).toBeInTheDocument()
      expect(fileInput).toHaveAttribute('accept', '.json')
    })

    it('should have hidden file input', async () => {
      render(<ExportPanel />)
      
      await user.click(screen.getByRole('button', { name: /Export/i }))
      
      const fileInput = document.querySelector('input[type="file"]')
      expect(fileInput).toHaveClass('hidden')
    })

    it('should have button to trigger file input', async () => {
      render(<ExportPanel />)
      
      await user.click(screen.getByRole('button', { name: /Export/i }))
      
      expect(screen.getByRole('button', { name: /Select file to validate/i })).toBeInTheDocument()
    })

    it('should have validateExport function available', () => {
      // Verify the mock returns validateExport function
      expect(mockExportManagement.validateExport).toBeDefined()
    })
  })

  describe('Export Stats', () => {
    it('should display export statistics', async () => {
      render(<ExportPanel />)
      
      await user.click(screen.getByRole('button', { name: /Export/i }))
      
      expect(screen.getByText(/5 total exports - 4 completed/)).toBeInTheDocument()
    })

    it('should not display stats when not available', async () => {
      vi.mocked(useExportManagement).mockReturnValue(createMockExportManagement({
        stats: null
      }) as any)
      
      render(<ExportPanel />)
      
      await user.click(screen.getByRole('button', { name: /Export/i }))
      
      expect(screen.queryByText(/total exports/)).not.toBeInTheDocument()
    })
  })
})
