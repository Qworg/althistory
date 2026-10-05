import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ImportUploadStep } from './ImportUploadStep'
import { AlthistoryExport } from '@/types'

/**
 * Test FileReader.
 *
 * The component drives a real `new FileReader()` and reads the file through the
 * `load` event (`event.target.result`). The stub therefore subclasses the DOM
 * FileReader so it *is* a FileReader for every consumer, and finishes a read the
 * way a browser does: by dispatching a `load` ProgressEvent on itself, with
 * `result` set. Tests call `complete()` to supply the file contents.
 */
class FileReaderStub extends FileReader {
  /** Every instance the component constructed, oldest first. */
  static instances: FileReaderStub[] = []

  constructor() {
    super()
    FileReaderStub.instances.push(this)
  }

  /** Contents come from `complete()` in the test, not from the Blob. */
  override readAsText(): void {}

  /** Complete the pending read as a browser would. */
  complete(content: string): void {
    Object.defineProperty(this, 'result', { value: content, configurable: true })
    this.dispatchEvent(new ProgressEvent('load'))
  }
}

/** Installs the stub for the current test; restored by `vi.unstubAllGlobals()`. */
const stubFileReader = (): void => {
  vi.stubGlobal('FileReader', FileReaderStub)
}

/** The FileReader the component built for the file it was just given. */
const lastFileReader = (): FileReaderStub => {
  const reader = FileReaderStub.instances[FileReaderStub.instances.length - 1]
  if (!reader) {
    throw new Error('ImportUploadStep did not construct a FileReader')
  }
  return reader
}

// Valid export data for testing. The metadata mirrors the format the export
// service actually produces (see ExportService.ExportMetadata): graphId,
// graphName, exportedAt, sourceVersion, graphVersion and checksum.
const validExportData: AlthistoryExport = {
  version: '1.0',
  metadata: {
    graphId: 'graph-1',
    graphName: 'Test Graph',
    description: 'Export fixture for ImportUploadStep tests',
    exportedAt: '2024-01-15T10:00:00Z',
    sourceVersion: '1.0.0',
    graphVersion: 1,
    checksum: '',
  },
  data: {
    events: [],
    arcs: [],
    causalRelationships: [],
    inferredPressures: [],
  },
}

describe('ImportUploadStep', () => {
  const user = userEvent.setup()
  const mockOnUpload = vi.fn()
  const mockOnError = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    FileReaderStub.instances = []
  })

  afterEach(() => {
    // Undo vi.stubGlobal('FileReader', ...) even if a test threw mid-way.
    vi.unstubAllGlobals()
  })

  const renderComponent = (props = {}) => {
    return render(
      <ImportUploadStep
        onUpload={mockOnUpload}
        onError={mockOnError}
        {...props}
      />
    )
  }

  describe('Initial Render', () => {
    it('should render upload instructions', () => {
      renderComponent()
      
      expect(screen.getByText('Upload Import File')).toBeInTheDocument()
      expect(screen.getByText(/Upload an Althistory export file/)).toBeInTheDocument()
    })

    it('should render file drop zone', () => {
      renderComponent()
      
      expect(screen.getByText('Click to browse')).toBeInTheDocument()
      expect(screen.getByText(/or drag and drop/)).toBeInTheDocument()
      expect(screen.getByText('JSON files only')).toBeInTheDocument()
    })

    it('should render JSON textarea', () => {
      renderComponent()
      
      expect(screen.getByLabelText('JSON Content')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Parse JSON' })).toBeInTheDocument()
    })

    it('should disable Parse JSON button when textarea is empty', () => {
      renderComponent()
      
      const parseButton = screen.getByRole('button', { name: 'Parse JSON' })
      expect(parseButton).toBeDisabled()
    })
  })

  describe('JSON Paste Input', () => {
    it('should enable Parse JSON button when textarea has content', async () => {
      renderComponent()
      
      const textarea = screen.getByLabelText('JSON Content')
      // Use fireEvent for faster and more reliable input
      fireEvent.change(textarea, { target: { value: '{"test": true}' } })
      
      const parseButton = screen.getByRole('button', { name: 'Parse JSON' })
      expect(parseButton).not.toBeDisabled()
    })

    it('should call onUpload with valid JSON', async () => {
      renderComponent()
      
      const textarea = screen.getByLabelText('JSON Content')
      fireEvent.change(textarea, { target: { value: JSON.stringify(validExportData) } })
      
      const parseButton = screen.getByRole('button', { name: 'Parse JSON' })
      await user.click(parseButton)
      
      expect(mockOnUpload).toHaveBeenCalledWith(validExportData)
      expect(mockOnError).not.toHaveBeenCalled()
    })

    it('should call onError with invalid JSON syntax', async () => {
      renderComponent()
      
      const textarea = screen.getByLabelText('JSON Content')
      fireEvent.change(textarea, { target: { value: '{invalid json' } })
      
      const parseButton = screen.getByRole('button', { name: 'Parse JSON' })
      await user.click(parseButton)
      
      expect(mockOnError).toHaveBeenCalled()
      expect(mockOnUpload).not.toHaveBeenCalled()
    })

    it('should call onError when JSON is not an object', async () => {
      renderComponent()
      
      const textarea = screen.getByLabelText('JSON Content')
      fireEvent.change(textarea, { target: { value: '"just a string"' } })
      
      const parseButton = screen.getByRole('button', { name: 'Parse JSON' })
      await user.click(parseButton)
      
      expect(mockOnError).toHaveBeenCalledWith('Invalid JSON: must be an object')
    })

    it('should call onError when version is incorrect', async () => {
      renderComponent()
      
      const invalidData = { ...validExportData, version: '2.0' }
      const textarea = screen.getByLabelText('JSON Content')
      fireEvent.change(textarea, { target: { value: JSON.stringify(invalidData) } })
      
      const parseButton = screen.getByRole('button', { name: 'Parse JSON' })
      await user.click(parseButton)
      
      expect(mockOnError).toHaveBeenCalledWith("Unsupported version: 2.0. Expected '1.0'")
    })

    it('should call onError when metadata is missing', async () => {
      renderComponent()
      
      const invalidData = { version: '1.0', data: {} }
      const textarea = screen.getByLabelText('JSON Content')
      fireEvent.change(textarea, { target: { value: JSON.stringify(invalidData) } })
      
      const parseButton = screen.getByRole('button', { name: 'Parse JSON' })
      await user.click(parseButton)
      
      expect(mockOnError).toHaveBeenCalledWith('Invalid format: missing metadata or data section')
    })

    it('should call onError when data is missing', async () => {
      renderComponent()
      
      const invalidData = { version: '1.0', metadata: {} }
      const textarea = screen.getByLabelText('JSON Content')
      fireEvent.change(textarea, { target: { value: JSON.stringify(invalidData) } })
      
      const parseButton = screen.getByRole('button', { name: 'Parse JSON' })
      await user.click(parseButton)
      
      expect(mockOnError).toHaveBeenCalledWith('Invalid format: missing metadata or data section')
    })

    it('should disable button when input is only whitespace', () => {
      renderComponent()
      
      const textarea = screen.getByLabelText('JSON Content')
      fireEvent.change(textarea, { target: { value: '   ' } }) // whitespace only
      
      const parseButton = screen.getByRole('button', { name: 'Parse JSON' })
      // Button should be disabled because trimmed value is empty
      expect(parseButton).toBeDisabled()
    })
  })

  describe('File Upload', () => {
    it('should handle file input change with valid file', async () => {
      renderComponent()
      
      const fileContent = JSON.stringify(validExportData)
      const file = new File([fileContent], 'test.json', { type: 'application/json' })
      
      const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement
      expect(fileInput).toBeTruthy()
      
      // Mock FileReader
      stubFileReader()

      fireEvent.change(fileInput, { target: { files: [file] } })
      
      // Complete the read
      lastFileReader().complete(fileContent)
      
      await waitFor(() => {
        expect(mockOnUpload).toHaveBeenCalledWith(validExportData)
      })
    })

    it('should show selected file name after upload', async () => {
      renderComponent()
      
      const fileContent = JSON.stringify(validExportData)
      const file = new File([fileContent], 'my-export.json', { type: 'application/json' })
      
      const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement
      
      // Mock FileReader
      stubFileReader()
      
      fireEvent.change(fileInput, { target: { files: [file] } })
      
      await waitFor(() => {
        expect(screen.getByText(/Selected:/)).toBeInTheDocument()
        expect(screen.getByText('my-export.json')).toBeInTheDocument()
      })
    })
  })

  describe('Drag and Drop', () => {
    it('should highlight drop zone on drag enter', () => {
      renderComponent()
      
      const dropZone = screen.getByText('Click to browse').closest('div')?.parentElement
      expect(dropZone).toBeTruthy()
      
      fireEvent.dragEnter(dropZone!)
      
      expect(dropZone).toHaveClass('border-blue-500')
      expect(dropZone).toHaveClass('bg-blue-50')
    })

    it('should remove highlight on drag leave', () => {
      renderComponent()
      
      const dropZone = screen.getByText('Click to browse').closest('div')?.parentElement
      expect(dropZone).toBeTruthy()
      
      fireEvent.dragEnter(dropZone!)
      fireEvent.dragLeave(dropZone!)
      
      expect(dropZone).toHaveClass('border-gray-300')
    })

    it('should reject non-JSON files on drop', async () => {
      renderComponent()
      
      const dropZone = screen.getByText('Click to browse').closest('div')?.parentElement
      expect(dropZone).toBeTruthy()
      
      const file = new File(['test content'], 'test.txt', { type: 'text/plain' })
      
      fireEvent.drop(dropZone!, {
        dataTransfer: { files: [file] },
      })
      
      expect(mockOnError).toHaveBeenCalledWith('Please upload a JSON file')
    })

    it('should process JSON file on drop', async () => {
      renderComponent()
      
      const dropZone = screen.getByText('Click to browse').closest('div')?.parentElement
      expect(dropZone).toBeTruthy()
      
      const fileContent = JSON.stringify(validExportData)
      const file = new File([fileContent], 'test.json', { type: 'application/json' })
      
      // Mock FileReader
      stubFileReader()
      
      fireEvent.drop(dropZone!, {
        dataTransfer: { files: [file] },
      })
      
      // Complete the read
      lastFileReader().complete(fileContent)
      
      await waitFor(() => {
        expect(mockOnUpload).toHaveBeenCalledWith(validExportData)
      })
    })
  })

  describe('Loading State', () => {
    it('should disable all inputs when loading', () => {
      renderComponent({ isLoading: true })
      
      const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement
      const textarea = screen.getByLabelText('JSON Content')
      const browseButton = screen.getByText('Click to browse')
      
      expect(fileInput).toBeDisabled()
      expect(textarea).toBeDisabled()
      expect(browseButton).toBeDisabled()
    })

    it('should show processing text on button when loading', () => {
      renderComponent({ isLoading: true })
      
      expect(screen.getByRole('button', { name: 'Processing...' })).toBeInTheDocument()
    })

    it('should apply opacity to drop zone when loading', () => {
      renderComponent({ isLoading: true })
      
      // The drop zone carries the loading state as an opacity class
      const container = document.querySelector('.opacity-50')
      expect(container).toBeTruthy()
    })
  })

  describe('Browse Button', () => {
    it('should trigger file input click when browse button is clicked', async () => {
      renderComponent()
      
      const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement
      const clickSpy = vi.spyOn(fileInput, 'click')
      
      const browseButton = screen.getByText('Click to browse')
      await user.click(browseButton)
      
      expect(clickSpy).toHaveBeenCalled()
    })
  })
})
