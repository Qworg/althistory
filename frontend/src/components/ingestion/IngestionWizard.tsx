/**
 * IngestionWizard
 *
 * Modal for extracting entities from an external source and reviewing them
 * before import (Req 19). Step 1 picks a source tab (Wikipedia, Wikidata or
 * Text); step 2 shows the extraction in editable tables with per-row
 * checkboxes; approving sends the checked ids and the reviewer's edits to
 * `POST /api/ingest/jobs/:id/approve`, which applies the edits and imports only
 * the selection.
 *
 * The approve request deliberately carries both the checked id arrays and the
 * edited fields: the backend applies `edits` to the stored extraction and then
 * filters by the approved ids, so an unticked row is neither imported nor able
 * to smuggle in an edit.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { ModalBase } from '@/components/modals/ModalBase'
import { EntityReviewTable } from './EntityReviewTable'
import { WikipediaIngestTab } from './WikipediaIngestTab'
import { WikidataIngestTab } from './WikidataIngestTab'
import { TextIngestTab } from './TextIngestTab'
import {
  useApproveIngestion,
  useDeleteIngestionJob,
  useIngestText,
  useIngestWikidata,
  useIngestWikipedia,
} from '@/hooks/useIngestion'
import type {
  ApproveIngestionRequest,
  ExtractedEdit,
  ExtractionResult,
  ImportResult,
  IngestResponse,
  IngestionValidationIssue,
  TextIngestRequest,
  WikidataIngestRequest,
  WikipediaIngestRequest,
} from '@/types'

type SourceTab = 'wikipedia' | 'wikidata' | 'text'
type WizardStep = 'source' | 'review' | 'complete'
type CollectionKey = 'events' | 'arcs' | 'relationships'

const SOURCE_TABS: Array<{ id: SourceTab; label: string }> = [
  { id: 'wikipedia', label: 'Wikipedia' },
  { id: 'wikidata', label: 'Wikidata' },
  { id: 'text', label: 'Text' },
]

export interface IngestionWizardProps {
  isOpen: boolean
  onClose: () => void
  onIngestComplete?: (result: ImportResult) => void
  targetGraphId?: string
}

export function IngestionWizard({
  isOpen,
  onClose,
  onIngestComplete,
  targetGraphId,
}: IngestionWizardProps) {
  const [step, setStep] = useState<WizardStep>('source')
  const [activeTab, setActiveTab] = useState<SourceTab>('wikipedia')
  const [jobId, setJobId] = useState<string | null>(null)
  const [extraction, setExtraction] = useState<ExtractionResult | null>(null)
  const [issues, setIssues] = useState<IngestionValidationIssue[]>([])
  const [edits, setEdits] = useState<Record<string, ExtractedEdit>>({})
  const [result, setResult] = useState<ImportResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  const ingestWikipedia = useIngestWikipedia()
  const ingestWikidata = useIngestWikidata()
  const ingestText = useIngestText()
  const approveIngestion = useApproveIngestion()
  const deleteIngestionJob = useDeleteIngestionJob()

  const isSubmitting =
    ingestWikipedia.isPending || ingestWikidata.isPending || ingestText.isPending

  const resetState = useCallback(() => {
    setStep('source')
    setActiveTab('wikipedia')
    setJobId(null)
    setExtraction(null)
    setIssues([])
    setEdits({})
    setResult(null)
    setError(null)
  }, [])

  // A closed modal should not keep the previous review (or its pasted text) in
  // memory, so reset whenever it is dismissed.
  useEffect(() => {
    if (!isOpen) resetState()
  }, [isOpen, resetState])

  const startReview = useCallback((response: IngestResponse) => {
    setJobId(response.jobId)
    setExtraction(response.extraction)
    setIssues(response.validationIssues)
    setEdits({})
    setError(null)
    setStep('review')
  }, [])

  const runExtraction = useCallback(
    async (run: () => Promise<IngestResponse>, fallbackMessage: string) => {
      setError(null)
      try {
        startReview(await run())
      } catch (err) {
        setError(err instanceof Error ? err.message : fallbackMessage)
      }
    },
    [startReview]
  )

  const handleWikipediaSubmit = useCallback(
    (request: WikipediaIngestRequest) => {
      void runExtraction(() => ingestWikipedia.mutateAsync(request), 'Wikipedia extraction failed')
    },
    [ingestWikipedia, runExtraction]
  )

  const handleWikidataSubmit = useCallback(
    (request: WikidataIngestRequest) => {
      void runExtraction(() => ingestWikidata.mutateAsync(request), 'Wikidata extraction failed')
    },
    [ingestWikidata, runExtraction]
  )

  const handleTextSubmit = useCallback(
    (request: TextIngestRequest) => {
      void runExtraction(() => ingestText.mutateAsync(request), 'Text extraction failed')
    },
    [ingestText, runExtraction]
  )

  const handleToggleSelection = useCallback((collection: CollectionKey, tempId: string) => {
    setExtraction((previous) => {
      if (!previous) return previous
      if (collection === 'events') {
        return {
          ...previous,
          events: previous.events.map((event) =>
            event.tempId === tempId ? { ...event, selected: !event.selected } : event
          ),
        }
      }
      if (collection === 'arcs') {
        return {
          ...previous,
          arcs: previous.arcs.map((arc) =>
            arc.tempId === tempId ? { ...arc, selected: !arc.selected } : arc
          ),
        }
      }
      return {
        ...previous,
        relationships: previous.relationships.map((relationship) =>
          relationship.tempId === tempId
            ? { ...relationship, selected: !relationship.selected }
            : relationship
        ),
      }
    })
  }, [])

  const handleSetAllSelected = useCallback((collection: CollectionKey, selected: boolean) => {
    setExtraction((previous) => {
      if (!previous) return previous
      if (collection === 'events') {
        return { ...previous, events: previous.events.map((event) => ({ ...event, selected })) }
      }
      if (collection === 'arcs') {
        return { ...previous, arcs: previous.arcs.map((arc) => ({ ...arc, selected })) }
      }
      return {
        ...previous,
        relationships: previous.relationships.map((relationship) => ({ ...relationship, selected })),
      }
    })
  }, [])

  const handleEdit = useCallback((tempId: string, updates: ExtractedEdit) => {
    setEdits((previous) => ({ ...previous, [tempId]: { ...previous[tempId], ...updates } }))
    setExtraction((previous) => {
      if (!previous) return previous
      return {
        ...previous,
        events: previous.events.map((event) =>
          event.tempId === tempId ? { ...event, ...updates, edited: true } : event
        ),
        arcs: previous.arcs.map((arc) =>
          arc.tempId === tempId ? { ...arc, ...updates, edited: true } : arc
        ),
      }
    })
  }, [])

  const selectedEventIds = useMemo(
    () => (extraction ? extraction.events.filter((event) => event.selected).map((event) => event.tempId) : []),
    [extraction]
  )
  const selectedArcIds = useMemo(
    () => (extraction ? extraction.arcs.filter((arc) => arc.selected).map((arc) => arc.tempId) : []),
    [extraction]
  )
  const selectedRelationshipIds = useMemo(
    () =>
      extraction
        ? extraction.relationships.filter((relationship) => relationship.selected).map((relationship) => relationship.tempId)
        : [],
    [extraction]
  )
  const selectedCount =
    selectedEventIds.length + selectedArcIds.length + selectedRelationshipIds.length

  const handleApprove = useCallback(async () => {
    if (!jobId || !extraction) return
    if (selectedCount === 0) {
      setError('Select at least one entity to import')
      return
    }

    const selectedEdits: Record<string, ExtractedEdit> = {}
    // Carry the reviewer's field edits, and state each event/arc's selection
    // explicitly. `parseApproveRequest` maps an empty approved-id array to
    // `undefined`, after which the orchestrator falls back to the entity's
    // stored `selected` flag; without these flags, importing an arc while every
    // event is unticked would still import the events.
    for (const event of extraction.events) {
      selectedEdits[event.tempId] = { ...edits[event.tempId], selected: event.selected }
    }
    for (const arc of extraction.arcs) {
      selectedEdits[arc.tempId] = { ...edits[arc.tempId], selected: arc.selected }
    }

    const request: ApproveIngestionRequest = {
      approvedEventIds: selectedEventIds,
      approvedArcIds: selectedArcIds,
      approvedRelationshipIds: selectedRelationshipIds,
      edits: selectedEdits,
      targetGraphId,
      mode: 'merge',
      conflictResolution: 'skip',
    }

    setError(null)
    try {
      const importResult = await approveIngestion.mutateAsync({ jobId, request })
      setResult(importResult)
      setStep('complete')
      onIngestComplete?.(importResult)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed')
    }
  }, [
    jobId,
    extraction,
    selectedCount,
    selectedEventIds,
    selectedArcIds,
    selectedRelationshipIds,
    edits,
    targetGraphId,
    approveIngestion,
    onIngestComplete,
  ])

  const handleClose = useCallback(() => {
    resetState()
    onClose()
  }, [onClose, resetState])

  const handleDiscard = useCallback(async () => {
    if (jobId) {
      try {
        await deleteIngestionJob.mutateAsync(jobId)
      } catch {
        // Discarding the review is the user's intent; a failed cleanup of the
        // server-side job must not trap them in the wizard.
      }
    }
    handleClose()
  }, [jobId, deleteIngestionJob, handleClose])

  const footer =
    step === 'review' ? (
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => setStep('source')}
          className="rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
        >
          Back
        </button>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleDiscard}
            className="rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
          >
            Discard
          </button>
          <button
            type="button"
            onClick={handleApprove}
            disabled={approveIngestion.isPending || selectedCount === 0}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:bg-gray-300"
          >
            {approveIngestion.isPending ? 'Importing...' : `Import Selected (${selectedCount})`}
          </button>
        </div>
      </div>
    ) : step === 'complete' ? (
      <div className="flex justify-end">
        <button
          type="button"
          onClick={handleClose}
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
        >
          Close
        </button>
      </div>
    ) : (
      <div className="flex justify-end">
        <button
          type="button"
          onClick={handleClose}
          className="rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
        >
          Cancel
        </button>
      </div>
    )

  return (
    <ModalBase
      isOpen={isOpen}
      onClose={handleClose}
      title="Ingest from Web"
      size="4xl"
      footer={footer}
    >
      {step === 'source' && (
        <div>
          <p className="mb-4 text-sm text-gray-600">
            Extract entities from Wikipedia, Wikidata or pasted text, review them, then import
            only the rows you select.
          </p>

          <div
            role="tablist"
            aria-label="Ingestion sources"
            className="flex gap-1 border-b border-gray-200"
          >
            {SOURCE_TABS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                role="tab"
                id={`ingest-tab-${tab.id}`}
                aria-selected={activeTab === tab.id}
                aria-controls={`ingest-panel-${tab.id}`}
                tabIndex={activeTab === tab.id ? 0 : -1}
                onClick={() => setActiveTab(tab.id)}
                className={`rounded-t-md px-4 py-2 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                  activeTab === tab.id
                    ? 'border-b-2 border-blue-600 text-blue-700'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="mt-4">
            <div
              role="tabpanel"
              id="ingest-panel-wikipedia"
              aria-labelledby="ingest-tab-wikipedia"
              hidden={activeTab !== 'wikipedia'}
            >
              <WikipediaIngestTab onSubmit={handleWikipediaSubmit} isSubmitting={isSubmitting} />
            </div>
            <div
              role="tabpanel"
              id="ingest-panel-wikidata"
              aria-labelledby="ingest-tab-wikidata"
              hidden={activeTab !== 'wikidata'}
            >
              <WikidataIngestTab onSubmit={handleWikidataSubmit} isSubmitting={isSubmitting} />
            </div>
            <div
              role="tabpanel"
              id="ingest-panel-text"
              aria-labelledby="ingest-tab-text"
              hidden={activeTab !== 'text'}
            >
              <TextIngestTab onSubmit={handleTextSubmit} isSubmitting={isSubmitting} />
            </div>
          </div>
        </div>
      )}

      {step === 'review' && extraction && (
        <div>
          {issues.length > 0 && (
            <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 p-3" role="status">
              <h3 className="text-sm font-medium text-amber-800">
                {issues.length} validation issue{issues.length === 1 ? '' : 's'}
              </h3>
              <ul className="mt-1 list-disc pl-5 text-xs text-amber-700">
                {issues.map((issue, index) => (
                  <li key={`${issue.entityType}:${issue.entityTempId}:${index}`}>
                    {issue.entityType} {issue.entityTempId}: {issue.message}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {extraction.events.length > 0 && (
            <section className="mb-6">
              <h3 className="mb-2 text-sm font-semibold text-gray-900">
                Events ({selectedEventIds.length}/{extraction.events.length} selected)
              </h3>
              <EntityReviewTable
                entityType="event"
                entities={extraction.events}
                issues={issues}
                onToggleSelection={(tempId) => handleToggleSelection('events', tempId)}
                onEdit={handleEdit}
                onSelectAll={() => handleSetAllSelected('events', true)}
                onDeselectAll={() => handleSetAllSelected('events', false)}
              />
            </section>
          )}

          {extraction.arcs.length > 0 && (
            <section className="mb-6">
              <h3 className="mb-2 text-sm font-semibold text-gray-900">
                Arcs ({selectedArcIds.length}/{extraction.arcs.length} selected)
              </h3>
              <EntityReviewTable
                entityType="arc"
                entities={extraction.arcs}
                issues={issues}
                onToggleSelection={(tempId) => handleToggleSelection('arcs', tempId)}
                onEdit={handleEdit}
                onSelectAll={() => handleSetAllSelected('arcs', true)}
                onDeselectAll={() => handleSetAllSelected('arcs', false)}
              />
            </section>
          )}

          {extraction.relationships.length > 0 && (
            <section className="mb-6">
              <h3 className="mb-2 text-sm font-semibold text-gray-900">
                Relationships ({selectedRelationshipIds.length}/{extraction.relationships.length}{' '}
                selected)
              </h3>
              <EntityReviewTable
                entityType="relationship"
                entities={extraction.relationships}
                issues={issues}
                onToggleSelection={(tempId) => handleToggleSelection('relationships', tempId)}
                onEdit={handleEdit}
                onSelectAll={() => handleSetAllSelected('relationships', true)}
                onDeselectAll={() => handleSetAllSelected('relationships', false)}
              />
            </section>
          )}
        </div>
      )}

      {step === 'complete' && result && (
        <div className="space-y-3" role="status">
          <h3 className="text-lg font-medium text-gray-900">Import complete</h3>
          <p className="text-sm text-gray-600">
            Imported {result.imported.events} events, {result.imported.arcs} arcs and{' '}
            {result.imported.relationships} relationships.
          </p>
          {result.errors.length > 0 && (
            <ul className="list-disc pl-5 text-xs text-red-600">
              {result.errors.map((importError) => (
                <li key={`${importError.path}:${importError.code}`}>
                  {importError.path}: {importError.message}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {error && (
        <div role="alert" className="mt-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}
    </ModalBase>
  )
}

export default IngestionWizard
