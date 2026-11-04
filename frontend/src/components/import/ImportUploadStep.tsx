/**
 * ImportUploadStep Component
 * 
 * First step of the import wizard - allows users to upload a file or paste JSON.
 */

import React, { useState, useCallback, useRef } from 'react'
import { AlthistoryExport } from '@/types'

export interface ImportUploadStepProps {
  onUpload: (data: AlthistoryExport) => void
  onError: (message: string) => void
  isLoading?: boolean
  /** Maximum file size in bytes (default: 10MB) */
  maxFileSize?: number
}

/**
 * Default max file size (10MB) 
 * FIX #14: This MUST match MAX_IMPORT_SIZE_BYTES in timeline/src/services/ImportService.ts
 * and validateContentLength() in timeline/src/api/routes/import.ts
 */
export const MAX_IMPORT_FILE_SIZE = 10 * 1024 * 1024;

export function ImportUploadStep({ 
  onUpload, 
  onError, 
  isLoading = false,
  maxFileSize = MAX_IMPORT_FILE_SIZE,
}: ImportUploadStepProps) {
  const [jsonInput, setJsonInput] = useState('')
  const [dragActive, setDragActive] = useState(false)
  const [fileName, setFileName] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // FIX #4: Validate file size before reading
  const validateFileSize = useCallback(
    (file: File): boolean => {
      if (file.size > maxFileSize) {
        const maxSizeMB = Math.round(maxFileSize / 1024 / 1024)
        const fileSizeMB = (file.size / 1024 / 1024).toFixed(2)
        onError(`File too large (${fileSizeMB}MB). Maximum size is ${maxSizeMB}MB.`)
        return false
      }
      return true
    },
    [maxFileSize, onError]
  )

  const parseAndValidate = useCallback(
    (content: string, source: string) => {
      try {
        const parsed = JSON.parse(content)
        
        // Basic structure check
        if (!parsed || typeof parsed !== 'object') {
          onError('This isn’t an althistory export: the file holds no JSON object.')
          return
        }

        if (parsed.version === undefined) {
          onError('This isn’t an althistory export: it has no "version" field. Export a graph from althistory (Graph › Export) and import that file.')
          return
        }

        if (parsed.version !== '1.0') {
          onError(`This export is format version ${parsed.version}; this version of althistory reads version 1.0.`)
          return
        }

        if (!parsed.metadata || !parsed.data) {
          onError('This export is incomplete: it has no "metadata" or no "data" section.')
          return
        }

        onUpload(parsed as AlthistoryExport)
      } catch (err) {
        onError(`${source} isn’t valid JSON (${err instanceof Error ? err.message : 'it could not be read'}). Check that the whole file was pasted.`)
      }
    },
    [onUpload, onError]
  )

  const handleFileChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0]
      if (!file) return

      // FIX #4: Validate file size before reading
      if (!validateFileSize(file)) {
        // Reset the input so user can try again
        if (fileInputRef.current) {
          fileInputRef.current.value = ''
        }
        return
      }

      setFileName(file.name)
      const reader = new FileReader()
      reader.onload = (e) => {
        const content = e.target?.result as string
        parseAndValidate(content, file.name)
      }
      reader.onerror = () => {
        onError(`Failed to read file: ${file.name}`)
      }
      reader.readAsText(file)
    },
    [parseAndValidate, onError, validateFileSize]
  )

  const handleDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true)
    } else if (e.type === 'dragleave') {
      setDragActive(false)
    }
  }, [])

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      setDragActive(false)

      const file = e.dataTransfer.files?.[0]
      if (!file) return

      if (!file.name.endsWith('.json')) {
        onError('Only .json files can be imported. Choose an althistory export file.')
        return
      }

      // FIX #4: Validate file size before reading
      if (!validateFileSize(file)) {
        return
      }

      setFileName(file.name)
      const reader = new FileReader()
      reader.onload = (ev) => {
        const content = ev.target?.result as string
        parseAndValidate(content, file.name)
      }
      reader.onerror = () => {
        onError(`Failed to read file: ${file.name}`)
      }
      reader.readAsText(file)
    },
    [parseAndValidate, onError, validateFileSize]
  )

  const handlePaste = useCallback(() => {
    if (!jsonInput.trim()) {
      onError('Please enter JSON data')
      return
    }
    parseAndValidate(jsonInput, 'The pasted text')
  }, [jsonInput, parseAndValidate, onError])

  const handleBrowseClick = useCallback(() => {
    fileInputRef.current?.click()
  }, [])

  return (
    <div className="space-y-6">
      {/* The dialog's title already names the task; one line on what to bring. */}
      <p className="text-sm text-ink-secondary">
        Choose an althistory export file (.json), or paste its contents below.
      </p>

      {/* File Drop Zone */}
      <div
        className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${
          dragActive
            ? 'border-baseline bg-blue-50'
            : 'border-line hover:border-ink-muted'
        } ${isLoading ? 'opacity-50 pointer-events-none' : ''}`}
        onDragEnter={handleDrag}
        onDragLeave={handleDrag}
        onDragOver={handleDrag}
        onDrop={handleDrop}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept=".json"
          onChange={handleFileChange}
          className="hidden"
          disabled={isLoading}
        />
        
        <svg
          className="mx-auto h-12 w-12 text-ink-muted"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
          />
        </svg>
        
        <div className="mt-4">
          {fileName ? (
            <p className="text-sm text-ink-secondary">
              Selected: <span className="font-medium">{fileName}</span>
            </p>
          ) : (
            <>
              <p className="text-sm text-ink-secondary">
                <button
                  type="button"
                  onClick={handleBrowseClick}
                  className="text-baseline hover:underline font-medium"
                  disabled={isLoading}
                >
                  Click to browse
                </button>
                {' or drag and drop'}
              </p>
              <p className="text-xs text-ink-muted mt-1">JSON files only</p>
            </>
          )}
        </div>
      </div>

      {/* Divider */}
      <div className="relative">
        <div className="absolute inset-0 flex items-center">
          <div className="w-full border-t border-line" />
        </div>
        <div className="relative flex justify-center text-sm">
          <span className="px-2 bg-card text-ink-muted">or paste it</span>
        </div>
      </div>

      {/* JSON Text Area */}
      <div>
        <label htmlFor="json-input" className="block text-sm font-medium text-ink-secondary">
          Export file contents
        </label>
        <textarea
          id="json-input"
          rows={6}
          value={jsonInput}
          onChange={(e) => setJsonInput(e.target.value)}
          className="mt-1 block w-full rounded-md border border-line bg-card px-3 py-2 text-ink placeholder:text-ink-placeholder font-mono-code text-sm"
          placeholder='{"version": "1.0", "metadata": {...}, "data": {...}}'
          disabled={isLoading}
        />
        <div className="mt-2 flex justify-end">
          <button
            type="button"
            onClick={handlePaste}
            disabled={!jsonInput.trim() || isLoading}
            className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-on-accent bg-baseline hover:bg-baseline/90 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-selected disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isLoading ? 'Checking…' : 'Check pasted file'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default ImportUploadStep
