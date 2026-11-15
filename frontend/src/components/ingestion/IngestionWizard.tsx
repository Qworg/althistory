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

import { useCallback, useEffect, useId, useMemo, useState } from 'react'
import { ModalBase } from '@/components/modals/ModalBase'
import { EntityReviewTable } from './EntityReviewTable'
import { describeIngestError, type IngestErrorView, type IngestSource } from './ingestErrors'
import { applyReviewDefaults, historySpan } from './reviewDefaults'
import { SkippedSentences } from './SkippedSentences'
import { buildEventLookup, entityLabel, reviewRowId } from './reviewLabels'
import { knownNames } from './reviewMatching'
import { useEvents } from '@/hooks/useEvents'
import { useActiveGraph } from '@/hooks/useGraphs'
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

/** The visible progress of an ingestion, one entry per stage. */
const PROGRESS_STEPS = ['Source', 'Extract', 'Review', 'Commit'] as const

const ENTITY_TYPE_LABELS: Record<IngestionValidationIssue['entityType'], string> = {
  event: 'Event',
  arc: 'Arc',
  relationship: 'Relationship',
}

/** Scrolls a review row into view and focuses its first field. */
function focusReviewRow(entityType: IngestionValidationIssue['entityType'], tempId: string): void {
  const row = document.getElementById(reviewRowId(entityType, tempId))
  if (!row) return
  if (typeof row.scrollIntoView === 'function') {
    row.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }
  // The first editable field in document order (the description is a
  // textarea), else the row's checkbox.
  const target =
    row.querySelector<HTMLElement>('textarea, input[type="text"], input[type="number"]') ??
    row.querySelector<HTMLInputElement>('input')
  target?.focus({ preventScroll: true })
}

const SOURCE_TABS: Array<{ id: SourceTab; label: string }> = [
  { id: 'wikipedia', label: 'Wikipedia' },
  { id: 'wikidata', label: 'Wikidata' },
  { id: 'text', label: 'Text' },
]

/** The id of each source tab's form, which the footer's "Extract events" submits. */
const sourceFormId = (tab: SourceTab) => `ingest-form-${tab}`

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`
}

/**
 * What a discard throws away: "12 extracted events and your edits", "12
 * extracted events, 2 arcs and your edits".
 */
function describeDiscard(extraction: ExtractionResult, hasEdits: boolean): string {
  const counts: Array<[number, string, string]> = [
    [extraction.events.length, 'event', 'events'],
    [extraction.arcs.length, 'arc', 'arcs'],
    [extraction.relationships.length, 'link', 'links'],
  ]
  const items = counts.filter(([count]) => count > 0).map(([count, one, many]) => plural(count, one, many))
  if (items[0]) items[0] = items[0].replace(/^(\d+) /, '$1 extracted ')
  if (hasEdits) items.push('your edits')
  if (items.length === 0) return 'this review'
  return items.length === 1 ? items[0]! : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`
}

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

  // The graph the extraction will enter, for the review table to match names
  // and events against. The wizard imports into the active graph, which is
  // the one these unscoped requests read.
  const { data: graphEvents } = useEvents({ limit: 1000 })
  // Named on the commit button, so where the events go is never a guess.
  const { data: activeGraph } = useActiveGraph()
  const graphContext = useMemo(
    () => (graphEvents && graphEvents.length > 0 ? { names: knownNames(graphEvents), events: graphEvents } : undefined),
    [graphEvents]
  )
  // The span of the history the rows would join: rows dated well outside it
  // start unticked and say so (see reviewDefaults).
  const span = useMemo(() => historySpan(graphEvents), [graphEvents])
  // The last text extraction, so skipped sentences can be dated and the
  // passage extracted again (see SkippedSentences).
  const [lastTextRequest, setLastTextRequest] = useState<TextIngestRequest | null>(null)
  const [activeTab, setActiveTab] = useState<SourceTab>('wikipedia')
  const [jobId, setJobId] = useState<string | null>(null)
  const [extraction, setExtraction] = useState<ExtractionResult | null>(null)
  const [issues, setIssues] = useState<IngestionValidationIssue[]>([])
  const [edits, setEdits] = useState<Record<string, ExtractedEdit>>({})
  const [result, setResult] = useState<ImportResult | null>(null)
  const [error, setError] = useState<IngestErrorView | null>(null)
  const [confirmingDiscard, setConfirmingDiscard] = useState(false)
  const [canSubmitSource, setCanSubmitSource] = useState<Record<SourceTab, boolean>>({
    wikipedia: false,
    wikidata: true,
    text: false,
  })
  const discardMessageId = useId()

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
    setConfirmingDiscard(false)
  }, [])

  // A closed modal should not keep the previous review (or its pasted text) in
  // memory, so reset whenever it is dismissed.
  useEffect(() => {
    if (!isOpen) resetState()
  }, [isOpen, resetState])

  const startReview = useCallback((response: IngestResponse) => {
    setJobId(response.jobId)
    // Extractors mark every row selected; the review starts from what
    // deserves to be ticked instead (see reviewDefaults).
    setExtraction(applyReviewDefaults(response.extraction, span))
    setIssues(response.validationIssues)
    setEdits({})
    setError(null)
    setStep('review')
  }, [span])

  const runExtraction = useCallback(
    async (run: () => Promise<IngestResponse>, source: IngestSource) => {
      setError(null)
      try {
        startReview(await run())
      } catch (err) {
        setError(describeIngestError(err, source))
      }
    },
    [startReview]
  )

  const handleWikipediaSubmit = useCallback(
    (request: WikipediaIngestRequest) => {
      void runExtraction(() => ingestWikipedia.mutateAsync(request), 'wikipedia')
    },
    [ingestWikipedia, runExtraction]
  )

  const handleWikidataSubmit = useCallback(
    (request: WikidataIngestRequest) => {
      void runExtraction(() => ingestWikidata.mutateAsync(request), 'wikidata')
    },
    [ingestWikidata, runExtraction]
  )

  // The text is read for the graph it will enter, so a world's calendar
  // dates it: the one named, or the active graph the approval falls back to.
  const textGraphId = targetGraphId ?? activeGraph?.id
  const handleTextSubmit = useCallback(
    (request: TextIngestRequest) => {
      setLastTextRequest(request)
      const scoped = textGraphId ? { ...request, targetGraphId: textGraphId } : request
      void runExtraction(() => ingestText.mutateAsync(scoped), 'text')
    },
    [ingestText, runExtraction, textGraphId]
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

  const handleSelectByConfidence = useCallback((collection: CollectionKey, threshold: number) => {
    setExtraction((previous) => {
      if (!previous) return previous
      if (collection === 'events') {
        return {
          ...previous,
          events: previous.events.map((event) => ({ ...event, selected: event.confidence >= threshold })),
        }
      }
      if (collection === 'arcs') {
        return {
          ...previous,
          arcs: previous.arcs.map((arc) => ({ ...arc, selected: arc.confidence >= threshold })),
        }
      }
      return {
        ...previous,
        relationships: previous.relationships.map((relationship) => ({
          ...relationship,
          selected: relationship.confidence >= threshold,
        })),
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

  const eventLookup = useMemo(
    () => buildEventLookup(extraction ? extraction.events : []),
    [extraction]
  )

  const progressIndex =
    step === 'source'
      ? isSubmitting
        ? 1
        : 0
      : step === 'review'
        ? approveIngestion.isPending
          ? 3
          : 2
        : 3

  const handleApprove = useCallback(async () => {
    if (!jobId || !extraction) return
    if (selectedCount === 0) {
      setError({ message: 'Select at least one row to import.', offerText: false })
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
      setError(describeIngestError(err, 'import'))
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

  // A review holds work: the extracted rows and the reviewer's edits. Closing
  // it (Escape, the backdrop, the close button) used to throw that away
  // without a word, so it asks first.
  const hasReviewWork =
    step === 'review' &&
    !!extraction &&
    (extraction.events.length + extraction.arcs.length + extraction.relationships.length > 0 ||
      Object.keys(edits).length > 0)
  const hasEdits = Object.keys(edits).length > 0

  const requestClose = useCallback(() => {
    if (hasReviewWork) {
      setConfirmingDiscard(true)
      return
    }
    handleClose()
  }, [hasReviewWork, handleClose])

  const reportCanSubmit = useCallback((tab: SourceTab, canSubmit: boolean) => {
    setCanSubmitSource((previous) => (previous[tab] === canSubmit ? previous : { ...previous, [tab]: canSubmit }))
  }, [])
  const reportWikipedia = useCallback((can: boolean) => reportCanSubmit('wikipedia', can), [reportCanSubmit])
  const reportWikidata = useCallback((can: boolean) => reportCanSubmit('wikidata', can), [reportCanSubmit])
  const reportText = useCallback((can: boolean) => reportCanSubmit('text', can), [reportCanSubmit])

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
          className="rounded-md border border-line px-3 py-2 text-sm font-medium text-ink hover:bg-subtle focus:outline-none focus:ring-2 focus:ring-selected focus:ring-offset-2"
        >
          Back
        </button>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleDiscard}
            className="rounded-md border border-line px-3 py-2 text-sm font-medium text-ink hover:bg-subtle focus:outline-none focus:ring-2 focus:ring-selected focus:ring-offset-2"
          >
            Discard
          </button>
          <button
            type="button"
            onClick={handleApprove}
            disabled={approveIngestion.isPending || selectedCount === 0}
            className="rounded-md bg-baseline px-4 py-2 text-sm font-medium text-on-accent hover:bg-baseline/90 focus:outline-none focus:ring-2 focus:ring-selected focus:ring-offset-2 disabled:cursor-not-allowed disabled:bg-line"
          >
            {approveIngestion.isPending
              ? 'Adding…'
              : activeGraph?.name
                ? `Add ${selectedCount} to ${activeGraph.name}`
                : `Import selected (${selectedCount})`}
          </button>
        </div>
      </div>
    ) : step === 'complete' ? (
      <div className="flex justify-end">
        <button
          type="button"
          onClick={handleClose}
          className="rounded-md bg-baseline px-4 py-2 text-sm font-medium text-on-accent hover:bg-baseline/90 focus:outline-none focus:ring-2 focus:ring-selected focus:ring-offset-2"
        >
          Close
        </button>
      </div>
    ) : (
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={requestClose}
          className="rounded-md border border-line px-3 py-2 text-sm font-medium text-ink hover:bg-subtle focus:outline-none focus:ring-2 focus:ring-selected focus:ring-offset-2"
        >
          Cancel
        </button>
        <button
          type="submit"
          form={sourceFormId(activeTab)}
          disabled={isSubmitting || !canSubmitSource[activeTab]}
          className="rounded-md bg-baseline px-4 py-2 text-sm font-medium text-on-accent hover:bg-baseline/90 focus:outline-none focus:ring-2 focus:ring-selected focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isSubmitting ? 'Extracting…' : 'Extract events'}
        </button>
      </div>
    )

  // One title whatever the tab: the selected tab already names the source, and
  // a dialog that renamed itself on every tab click read as a new dialog.
  const activeTitle = 'Bring in history'

  return (
    <>
    <ModalBase
      isOpen={isOpen}
      onClose={requestClose}
      title={activeTitle}
      size="4xl"
      footer={footer}
    >
      <ol aria-label="Ingestion progress" className="mb-4 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
        {PROGRESS_STEPS.map((label, index) => {
          const isCurrent = index === progressIndex
          const isDone = index < progressIndex || (step === 'complete' && index === progressIndex)
          return (
            <li key={label} className="flex items-center gap-2" aria-current={isCurrent ? 'step' : undefined}>
              {index > 0 && (
                <span aria-hidden="true" className="h-px w-4 bg-line sm:w-6" />
              )}
              <span
                className={`inline-flex items-center gap-1.5 font-medium ${
                  isCurrent ? 'text-ink' : isDone ? 'text-ink-secondary' : 'text-ink-muted'
                }`}
              >
                <span
                  aria-hidden="true"
                  className={`font-mono-code inline-flex h-5 w-5 items-center justify-center rounded-full border text-xs ${
                    isCurrent
                      ? 'border-baseline bg-baseline text-on-accent'
                      : isDone
                        ? 'border-baseline text-baseline'
                        : 'border-line text-ink-muted'
                  }`}
                >
                  {isDone && !isCurrent ? (
                    <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  ) : (
                    index + 1
                  )}
                </span>
                {label}
                {isDone && <span className="sr-only"> (done)</span>}
              </span>
            </li>
          )
        })}
      </ol>

      {step === 'source' && (
        <div>
          <p className="mb-4 text-sm text-ink-secondary">
            Extract events from Wikipedia, Wikidata or pasted text, review them, then import
            only the rows you select.
          </p>

          <div
            role="tablist"
            aria-label="Ingestion sources"
            className="flex gap-1 border-b border-line"
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
                className={`rounded-t-md px-4 py-2 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-selected ${
                  activeTab === tab.id
                    ? 'border-b-2 border-baseline text-blue-700'
                    : 'text-ink-secondary hover:text-ink'
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
              <WikipediaIngestTab
                onSubmit={handleWikipediaSubmit}
                isSubmitting={isSubmitting}
                formId={sourceFormId('wikipedia')}
                onCanSubmitChange={reportWikipedia}
              />
            </div>
            <div
              role="tabpanel"
              id="ingest-panel-wikidata"
              aria-labelledby="ingest-tab-wikidata"
              hidden={activeTab !== 'wikidata'}
            >
              <WikidataIngestTab
                onSubmit={handleWikidataSubmit}
                isSubmitting={isSubmitting}
                formId={sourceFormId('wikidata')}
                onCanSubmitChange={reportWikidata}
              />
            </div>
            <div
              role="tabpanel"
              id="ingest-panel-text"
              aria-labelledby="ingest-tab-text"
              hidden={activeTab !== 'text'}
            >
              <TextIngestTab
                onSubmit={handleTextSubmit}
                isSubmitting={isSubmitting}
                formId={sourceFormId('text')}
                onCanSubmitChange={reportText}
              />
            </div>
          </div>
        </div>
      )}

      {step === 'review' && extraction && (
        <div>
          {(extraction.skippedSentences ?? 0) > 0 && (
            <SkippedSentences
              count={extraction.skippedSentences ?? 0}
              sentences={extraction.skippedSentenceTexts ?? []}
              hasEdits={hasEdits}
              canReextract={Boolean(lastTextRequest)}
              isExtracting={ingestText.isPending}
              onReextract={(text) => {
                if (!lastTextRequest) return
                handleTextSubmit({ ...lastTextRequest, text: text(lastTextRequest.text) })
              }}
            />
          )}
          {issues.length > 0 && (
            <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 p-3 dark:border-amber-900 dark:bg-amber-950/40" role="status">
              <h3 className="text-sm font-medium text-amber-800 dark:text-amber-200">
                {issues.length} validation issue{issues.length === 1 ? '' : 's'}
              </h3>
              <ul className="mt-1 space-y-0.5 text-xs text-amber-800 dark:text-amber-200">
                {issues.map((issue, index) => (
                  <li key={`${issue.entityType}:${issue.entityTempId}:${index}`}>
                    <button
                      type="button"
                      onClick={() => focusReviewRow(issue.entityType, issue.entityTempId)}
                      className="text-left underline decoration-amber-400 underline-offset-2 hover:decoration-amber-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-selected"
                    >
                      <span className="font-medium">
                        {issue.severity === 'error' ? 'Error' : 'Warning'} ·{' '}
                        {ENTITY_TYPE_LABELS[issue.entityType]} “
                        {entityLabel(extraction, issue.entityType, issue.entityTempId, eventLookup)}”:
                      </span>{' '}
                      {issue.message}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {extraction.events.length > 0 && (
            <section className="mb-6">
              <h3 className="mb-2 text-sm font-semibold text-ink">
                Events ({selectedEventIds.length}/{extraction.events.length} selected)
              </h3>
              <EntityReviewTable
                entityType="event"
                entities={extraction.events}
                issues={issues}
                graphContext={graphContext}
                historySpan={span}
                onToggleSelection={(tempId) => handleToggleSelection('events', tempId)}
                onEdit={handleEdit}
                onSelectAll={() => handleSetAllSelected('events', true)}
                onDeselectAll={() => handleSetAllSelected('events', false)}
                onSelectByConfidence={(threshold) => handleSelectByConfidence('events', threshold)}
              />
            </section>
          )}

          {extraction.arcs.length > 0 && (
            <section className="mb-6">
              <h3 className="mb-2 text-sm font-semibold text-ink">
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
                onSelectByConfidence={(threshold) => handleSelectByConfidence('arcs', threshold)}
              />
            </section>
          )}

          {extraction.relationships.length > 0 && (
            <section className="mb-6">
              <h3 className="mb-2 text-sm font-semibold text-ink">
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
                onSelectByConfidence={(threshold) => handleSelectByConfidence('relationships', threshold)}
                eventLookup={eventLookup}
              />
            </section>
          )}
        </div>
      )}

      {step === 'complete' && result && (
        <div className="space-y-3" role="status">
          <h3 className="text-lg font-medium text-ink">Import complete</h3>
          <p className="text-sm text-ink-secondary">
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
        <div role="alert" className="mt-4 rounded-md border border-danger/30 bg-danger/10 p-3 text-sm text-ink">
          <p>{error.message}</p>
          {(error.offerText || error.detail) && (
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5">
              {error.offerText && step === 'source' && activeTab !== 'text' && (
                <button
                  type="button"
                  onClick={() => {
                    setActiveTab('text')
                    setError(null)
                  }}
                  className="rounded-md border border-line bg-card px-2.5 py-1 text-xs font-medium text-ink hover:bg-subtle focus:outline-none focus-visible:ring-2 focus-visible:ring-selected"
                >
                  Switch to Text
                </button>
              )}
              {error.detail && (
                <details className="text-xs text-ink-secondary">
                  <summary className="cursor-pointer select-none rounded-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-selected">
                    Details
                  </summary>
                  <p className="mt-1 font-mono-code break-words">{error.detail}</p>
                </details>
              )}
            </div>
          )}
        </div>
      )}
    </ModalBase>

    {/* Stacked on the wizard: Escape here closes only this question. */}
    {isOpen && confirmingDiscard && extraction && (
      <ModalBase
        isOpen
        onClose={() => setConfirmingDiscard(false)}
        title="Discard this review?"
        size="md"
        showCloseButton={false}
        footer={
          <div className="flex flex-wrap justify-end gap-2">
            <button
              type="button"
              onClick={() => setConfirmingDiscard(false)}
              aria-describedby={discardMessageId}
              className="rounded-md border border-line bg-card px-3 py-2 text-sm font-medium text-ink hover:bg-subtle focus:outline-none focus:ring-2 focus:ring-selected focus:ring-offset-2"
            >
              Keep reviewing
            </button>
            <button
              type="button"
              onClick={() => void handleDiscard()}
              className="rounded-md bg-danger px-3 py-2 text-sm font-medium text-on-accent hover:bg-danger/90 focus:outline-none focus:ring-2 focus:ring-danger focus:ring-offset-2"
            >
              {/* Not a second bare "Discard": the footer's shows behind this question. */}
              Discard review
            </button>
          </div>
        }
      >
        <p id={discardMessageId} className="text-sm text-ink">
          Discard {describeDiscard(extraction, hasEdits)}? Nothing has been imported yet, so
          closing now throws this review away.
        </p>
      </ModalBase>
    )}
    </>
  )
}

export default IngestionWizard
