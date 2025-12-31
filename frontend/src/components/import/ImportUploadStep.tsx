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
}

export function ImportUploadStep({ onUpload, onError, isLoading = false }: ImportUploadStepProps) {
  const [jsonInput, setJsonInput] = useState('')
  const [dragActive, setDragActive] = useState(false)
  const [fileName, setFileName] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const parseAndValidate = useCallback(
    (content: string, source: string) => {
      try {
        const parsed = JSON.parse(content)
        
        // Basic structure check
        if (!parsed || typeof parsed !== 'object') {
          onError('Invalid JSON: must be an object')
          return
        }

        if (parsed.version !== '1.0') {
          onError(`Unsupported version: ${parsed.version}. Expected '1.0'`)
          return
        }

        if (!parsed.metadata || !parsed.data) {
          onError('Invalid format: missing metadata or data section')
          return
        }

        onUpload(parsed as AlthistoryExport)
      } catch (err) {
        onError(`Failed to parse ${source}: ${err instanceof Error ? err.message : 'Invalid JSON'}`)
      }
    },
    [onUpload, onError]
  )

  const handleFileChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0]
      if (!file) return

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
    [parseAndValidate, onError]
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
        onError('Please upload a JSON file')
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
    [parseAndValidate, onError]
  )

  const handlePaste = useCallback(() => {
    if (!jsonInput.trim()) {
      onError('Please enter JSON data')
      return
    }
    parseAndValidate(jsonInput, 'pasted JSON')
  }, [jsonInput, parseAndValidate, onError])

  const handleBrowseClick = useCallback(() => {
    fileInputRef.current?.click()
  }, [])

  return (
    <div className="space-y-6">
      <div className="text-center">
        <h3 className="text-lg font-medium text-gray-900">Upload Import File</h3>
        <p className="mt-1 text-sm text-gray-500">
          Upload an Althistory export file (.json) or paste the JSON content below
        </p>
      </div>

      {/* File Drop Zone */}
      <div
        className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${
          dragActive
            ? 'border-blue-500 bg-blue-50'
            : 'border-gray-300 hover:border-gray-400'
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
          className="mx-auto h-12 w-12 text-gray-400"
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
            <p className="text-sm text-gray-600">
              Selected: <span className="font-medium">{fileName}</span>
            </p>
          ) : (
            <>
              <p className="text-sm text-gray-600">
                <button
                  type="button"
                  onClick={handleBrowseClick}
                  className="text-blue-600 hover:text-blue-500 font-medium"
                  disabled={isLoading}
                >
                  Click to browse
                </button>
                {' or drag and drop'}
              </p>
              <p className="text-xs text-gray-500 mt-1">JSON files only</p>
            </>
          )}
        </div>
      </div>

      {/* Divider */}
      <div className="relative">
        <div className="absolute inset-0 flex items-center">
          <div className="w-full border-t border-gray-300" />
        </div>
        <div className="relative flex justify-center text-sm">
          <span className="px-2 bg-white text-gray-500">Or paste JSON</span>
        </div>
      </div>

      {/* JSON Text Area */}
      <div>
        <label htmlFor="json-input" className="block text-sm font-medium text-gray-700">
          JSON Content
        </label>
        <textarea
          id="json-input"
          rows={10}
          value={jsonInput}
          onChange={(e) => setJsonInput(e.target.value)}
          className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 font-mono text-sm"
          placeholder='{"version": "1.0", "metadata": {...}, "data": {...}}'
          disabled={isLoading}
        />
        <div className="mt-2 flex justify-end">
          <button
            type="button"
            onClick={handlePaste}
            disabled={!jsonInput.trim() || isLoading}
            className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isLoading ? 'Processing...' : 'Parse JSON'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default ImportUploadStep
