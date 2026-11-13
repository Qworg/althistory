/**
 * EntityReviewTable
 *
 * Editable review table for an extraction (Req 19.3-19.4). Each row has a
 * checkbox controlling whether the entity is imported, and the editable columns
 * update the extraction in place through `onEdit`.
 *
 * Editing is offered only for event and arc fields: the backend's
 * `ExtractedEdit`/`parseEdits` path accepts exactly those fields, so a
 * relationship weight cannot be changed by an import and is shown read-only.
 *
 * Relationship rows name their cause and effect through `eventLookup`, every
 * row shows its own validation issues in its first cell, and an optional
 * confidence threshold selects the rows at or above it in one step.
 */

import { useState, useMemo, useId } from 'react'
import { formatHistoricalDateAt, formatHistoricalTimestamp, type DatePrecision, formatEventDate } from '@/utils/historicalTime'
import type {
  Event,
  ExtractedArc,
  ExtractedEvent,
  ExtractedEdit,
  ExtractedRelationship,
  IngestionValidationIssue,
} from '@/types'
import {
  compactReviewDate,
  describeExtractedEvent,
  eventLabel,
  findExtractedEvent,
  readReviewDate,
  reviewRowId,
  type ReviewEventLookup,
} from './reviewLabels'
import { findDuplicateEvent, matchKnownName, type NameMatch } from './reviewMatching'
import { PRESELECT_THRESHOLD, formatSpan, isOutsideSpan, type HistorySpan } from './reviewDefaults'
import { useWorldCalendar } from '@/stores/worldCalendarStore'
import { worldBoundExamples } from '@althistory/calendar'

export type ReviewEntity = ExtractedEvent | ExtractedArc | ExtractedRelationship
export type ReviewEntityType = 'event' | 'arc' | 'relationship'

interface ReviewColumn {
  key: string
  label: string
  editable: boolean
  inputType?: 'text' | 'number'
  /**
   * How the field is edited: a wrapping multi-line box for prose, a date box
   * with the date in words under it, or a single-line input.
   */
  kind?: 'prose' | 'date' | 'name'
  /**
   * The column's share of the table. The table is laid out at the dialog's
   * width (`table-fixed`), so columns without a width share what is left.
   */
  width?: string
  value: (entity: ReviewEntity) => string | number
  edit?: (raw: string) => ExtractedEdit
  /** For a column naming an event by tempId: that tempId, rendered as a reference. */
  eventRef?: (entity: ReviewEntity) => string
}

/**
 * Confidence, with the source the row came from under it. The source used to
 * be a column of its own, which pushed Confidence out of the dialog.
 */
const CONFIDENCE_COLUMN: ReviewColumn = {
  key: 'confidence',
  label: 'Confidence',
  editable: false,
  width: 'w-24',
  value: (entity) => entity.confidence,
}

function toNumber(raw: string): number {
  const parsed = Number(raw)
  return Number.isFinite(parsed) ? parsed : 0
}

const eventColumns: ReviewColumn[] = [
  {
    key: 'description',
    label: 'Description',
    editable: true,
    kind: 'prose',
    value: (entity) => ('description' in entity ? entity.description : ''),
    edit: (raw) => ({ description: raw }),
  },
  {
    key: 'actor',
    label: 'Actor',
    editable: true,
    kind: 'name',
    width: 'w-[17%]',
    value: (entity) => ('actor' in entity ? entity.actor : ''),
    edit: (raw) => ({ actor: raw }),
  },
  {
    key: 'target',
    label: 'Target',
    editable: true,
    kind: 'name',
    width: 'w-[17%]',
    value: (entity) => ('target' in entity ? entity.target : ''),
    edit: (raw) => ({ target: raw }),
  },
  {
    key: 'timestamp',
    label: 'Date',
    editable: true,
    kind: 'date',
    width: 'w-36',
    value: (entity) => ('timestamp' in entity ? entity.timestamp : ''),
    // A date typed over the extracted one says how much it knows itself: the
    // extraction's month (and its calendar) no longer describe it.
    edit: (raw) => ({ timestamp: raw, datePrecision: undefined, dateCalendar: undefined }),
  },
  CONFIDENCE_COLUMN,
]

const arcColumns: ReviewColumn[] = [
  {
    key: 'name',
    label: 'Name',
    editable: true,
    width: 'w-[20%]',
    value: (entity) => ('name' in entity ? entity.name : ''),
    edit: (raw) => ({ name: raw }),
  },
  {
    key: 'description',
    label: 'Description',
    editable: true,
    kind: 'prose',
    value: (entity) => ('description' in entity ? entity.description : ''),
    edit: (raw) => ({ description: raw }),
  },
  {
    key: 'start_time',
    label: 'Start',
    editable: true,
    kind: 'date',
    width: 'w-36',
    value: (entity) => ('start_time' in entity ? entity.start_time : ''),
    edit: (raw) => ({ start_time: raw }),
  },
  {
    key: 'end_time',
    label: 'End',
    editable: true,
    kind: 'date',
    width: 'w-36',
    value: (entity) => ('end_time' in entity ? entity.end_time : ''),
    edit: (raw) => ({ end_time: raw }),
  },
  {
    key: 'level',
    label: 'Level',
    editable: true,
    inputType: 'number',
    width: 'w-20',
    value: (entity) => ('level' in entity ? entity.level : 0),
    edit: (raw) => ({ level: toNumber(raw) }),
  },
  CONFIDENCE_COLUMN,
]

function relationshipColumns(lookup: ReviewEventLookup | undefined): ReviewColumn[] {
  return [
    {
      key: 'cause',
      label: 'Cause event',
      editable: false,
      eventRef: (entity) => ('causeEventTempId' in entity ? entity.causeEventTempId : ''),
      value: (entity) =>
        'causeEventTempId' in entity ? eventLabel(lookup, entity.causeEventTempId) : '',
    },
    {
      key: 'effect',
      label: 'Effect event',
      editable: false,
      eventRef: (entity) => ('effectEventTempId' in entity ? entity.effectEventTempId : ''),
      value: (entity) =>
        'effectEventTempId' in entity ? eventLabel(lookup, entity.effectEventTempId) : '',
    },
    {
      key: 'weight',
      label: 'Weight',
      editable: false,
      width: 'w-20',
      value: (entity) => ('weight' in entity ? entity.weight : 0),
    },
    {
      key: 'reasoning',
      label: 'Reasoning',
      editable: false,
      value: (entity) => ('reasoning' in entity ? entity.reasoning : ''),
    },
    CONFIDENCE_COLUMN,
  ]
}

export interface EntityReviewTableProps {
  entityType: ReviewEntityType
  entities: ReviewEntity[]
  onToggleSelection: (tempId: string) => void
  onEdit: (tempId: string, updates: ExtractedEdit) => void
  onSelectAll: () => void
  onDeselectAll: () => void
  /**
   * Selects exactly the rows whose confidence is at or above the threshold
   * (and deselects the rest). The threshold control is shown only when set.
   */
  onSelectByConfidence?: (threshold: number) => void
  /** Validation issues rendered under the row they belong to. */
  issues?: IngestionValidationIssue[]
  /**
   * tempId → extracted event, so relationship rows can name their cause and
   * effect events instead of showing bare tempIds.
   */
  eventLookup?: ReviewEventLookup
  /**
   * What the target graph already holds, so event rows can say when an actor
   * or target is a variant of a name the graph uses, and when an event looks
   * like one it already has (see reviewMatching.ts).
   */
  graphContext?: { names: readonly string[]; events: readonly Event[] }
  /** The span of the history rows would join; an event far outside it is flagged. */
  historySpan?: HistorySpan | null
}

const DEFAULT_CONFIDENCE_THRESHOLD = String(PRESELECT_THRESHOLD)

function confidenceBadgeClass(confidence: number): string {
  if (confidence >= 0.8) {
    return 'bg-emerald-100 text-emerald-800 border-emerald-200'
  }
  if (confidence >= 0.5) {
    return 'bg-amber-100 text-amber-800 border-amber-200'
  }
  return 'bg-rose-100 text-rose-800 border-rose-200'
}

function parseThreshold(raw: string): number | null {
  if (raw.trim() === '') return null
  const value = Number(raw)
  return Number.isFinite(value) && value >= 0 && value <= 1 ? value : null
}

export function EntityReviewTable({
  entityType,
  entities,
  onToggleSelection,
  onEdit,
  onSelectAll,
  onDeselectAll,
  onSelectByConfidence,
  issues = [],
  eventLookup,
  graphContext,
  historySpan,
}: EntityReviewTableProps) {
  const columns = useMemo(
    () =>
      entityType === 'relationship'
        ? relationshipColumns(eventLookup)
        : entityType === 'arc'
          ? arcColumns
          : eventColumns,
    [entityType, eventLookup]
  )
  const [sortKey, setSortKey] = useState<string | null>(null)
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')
  const [thresholdInput, setThresholdInput] = useState(DEFAULT_CONFIDENCE_THRESHOLD)

  const handleSort = (key: string) => {
    if (sortKey === key) {
      setSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      setSortDir('asc')
    }
  }

  const sortedEntities = useMemo(() => {
    if (!sortKey) return entities
    const col = columns.find((c) => c.key === sortKey)
    if (!col) return entities
    return [...entities].sort((a, b) => {
      const valA = col.value(a)
      const valB = col.value(b)
      const cmp =
        typeof valA === 'number' && typeof valB === 'number'
          ? valA - valB
          : String(valA).localeCompare(String(valB))
      return sortDir === 'asc' ? cmp : -cmp
    })
  }, [entities, columns, sortKey, sortDir])

  const issuesByEntity = useMemo(() => {
    const grouped = new Map<string, IngestionValidationIssue[]>()
    for (const issue of issues) {
      if (issue.entityType !== entityType) continue
      const list = grouped.get(issue.entityTempId)
      if (list) list.push(issue)
      else grouped.set(issue.entityTempId, [issue])
    }
    return grouped
  }, [issues, entityType])

  // Per event row: a likely duplicate already in the graph, and how its
  // actor and target relate to the names the graph uses.
  const graphMatches = useMemo(() => {
    const matches = new Map<string, { duplicate: Event | null; actor: NameMatch | null; target: NameMatch | null }>()
    if (entityType !== 'event' || !graphContext) return matches
    for (const entity of entities) {
      if (!('actor' in entity)) continue
      matches.set(entity.tempId, {
        duplicate: findDuplicateEvent(entity, graphContext.events),
        actor: matchKnownName(entity.actor, graphContext.names),
        target: matchKnownName(entity.target, graphContext.names),
      })
    }
    return matches
  }, [entityType, entities, graphContext])

  const allSelected = entities.length > 0 && entities.every((entity) => entity.selected)
  const selectedCount = entities.filter((entity) => entity.selected).length
  const label = `${entityType}s`
  const threshold = parseThreshold(thresholdInput)
  const thresholdInputId = `review-${entityType}-confidence-threshold`
  const matchingCount =
    threshold === null ? 0 : entities.filter((entity) => entity.confidence >= threshold).length

  return (
    <div>
      {onSelectByConfidence && entities.length > 1 && (
        <div className="mb-2 flex flex-wrap items-center justify-end gap-2 text-xs text-ink-secondary">
          <label htmlFor={thresholdInputId}>Select rows with confidence ≥</label>
          <input
            id={thresholdInputId}
            type="number"
            min={0}
            max={1}
            step={0.05}
            inputMode="decimal"
            value={thresholdInput}
            onChange={(event) => setThresholdInput(event.target.value)}
            aria-invalid={threshold === null}
            className="font-mono-code w-16 rounded border border-line bg-card px-1.5 py-1 text-xs text-ink focus:border-selected focus:outline-none focus:ring-1 focus:ring-selected"
          />
          <button
            type="button"
            disabled={threshold === null}
            onClick={() => threshold !== null && onSelectByConfidence(threshold)}
            title="Selects these rows and deselects the rest"
            className="rounded-md border border-line bg-card px-2 py-1 font-medium text-ink hover:bg-subtle focus:outline-none focus:ring-2 focus:ring-selected disabled:cursor-not-allowed disabled:opacity-50"
          >
            Select <span className="font-mono-code">{matchingCount}</span>
            <span className="sr-only">
              {' '}
              {label} with confidence of at least{' '}
              {threshold === null ? thresholdInput : threshold.toFixed(2)}
            </span>
          </button>
        </div>
      )}
      {/* Laid out at the dialog's width, so nothing is cut off sideways; the
          scroll is only a last resort on a narrow screen. */}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[40rem] table-fixed divide-y divide-line text-sm">
          <caption className="sr-only">
            Extracted {label}: {selectedCount} of {entities.length} selected
          </caption>
          <colgroup>
            <col className="w-9" />
            {columns.map((column) => (
              <col key={column.key} className={column.width} />
            ))}
          </colgroup>
          <thead className="bg-subtle">
            <tr>
              <th scope="col" className="px-2 py-2 text-left">
                <input
                  type="checkbox"
                  aria-label={`Select all ${entityType} entities`}
                  checked={allSelected}
                  onChange={() => (allSelected ? onDeselectAll() : onSelectAll())}
                  className="h-4 w-4 rounded border-line text-baseline focus:ring-selected"
                />
              </th>
              {columns.map((column) => (
                <th
                  key={column.key}
                  scope="col"
                  aria-sort={
                    sortKey === column.key
                      ? sortDir === 'asc'
                        ? 'ascending'
                        : 'descending'
                      : 'none'
                  }
                  className="px-2 py-2 text-left font-medium text-ink-secondary"
                >
                  <button
                    type="button"
                    onClick={() => handleSort(column.key)}
                    className="inline-flex items-center gap-1 hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-selected"
                  >
                    <span>{column.label}</span>
                    {sortKey === column.key && (
                      <span aria-hidden="true">{sortDir === 'asc' ? '↑' : '↓'}</span>
                    )}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-line bg-card">
            {sortedEntities.map((entity) => {
              const rowIssues = issuesByEntity.get(entity.tempId) ?? []
              const hasError = rowIssues.some((issue) => issue.severity === 'error')
              const rowId = reviewRowId(entityType, entity.tempId)
              const issuesId = rowIssues.length > 0 ? `${rowId}-issues` : undefined
              return (
                <tr
                  key={entity.tempId}
                  id={rowId}
                  data-invalid={hasError ? 'true' : undefined}
                  className={`${entity.selected ? '' : 'opacity-60'} ${
                    hasError ? 'bg-red-50/60 dark:bg-red-950/30' : ''
                  }`}
                >
                  <td
                    className={`px-2 py-2 align-top ${
                      hasError ? 'border-l-2 border-l-red-500' : 'border-l-2 border-l-transparent'
                    }`}
                  >
                    <input
                      type="checkbox"
                      aria-label={`Select ${entityType} ${entity.tempId}`}
                      aria-describedby={issuesId}
                      checked={entity.selected}
                      onChange={() => onToggleSelection(entity.tempId)}
                      className="h-4 w-4 rounded border-line text-baseline focus:ring-selected"
                    />
                  </td>
                  {columns.map((column, columnIndex) => {
                    const edit = column.editable ? column.edit : undefined
                    const rawValue = column.value(entity)
                    const refTempId = column.eventRef?.(entity)
                    const fieldLabel = `${column.label} for ${entityType} ${entity.tempId}`
                    const fieldClass = `block w-full min-w-0 rounded border bg-card px-2 py-1.5 text-sm text-ink placeholder:text-ink-muted focus:border-selected focus:outline-none focus:ring-1 focus:ring-selected ${
                      hasError ? 'border-red-400' : 'border-line'
                    }`
                    return (
                      <td key={column.key} className="px-2 py-2 align-top">
                        {edit && column.kind === 'date' ? (
                          <ReviewDateField
                            label={fieldLabel}
                            raw={String(rawValue)}
                            describedBy={issuesId}
                            invalid={hasError}
                            precision={'datePrecision' in entity ? entity.datePrecision : undefined}
                            dateCalendar={'dateCalendar' in entity ? entity.dateCalendar : undefined}
                            className={`${fieldClass} font-mono-code`}
                            onChange={(value) => onEdit(entity.tempId, edit(value))}
                          />
                        ) : edit && column.kind === 'prose' ? (
                          <textarea
                            aria-label={fieldLabel}
                            aria-describedby={issuesId}
                            aria-invalid={hasError || undefined}
                            value={String(rawValue)}
                            rows={2}
                            onChange={(event) => onEdit(entity.tempId, edit(event.target.value))}
                            className={`${fieldClass} resize-y field-sizing-content min-h-[3.25rem]`}
                          />
                        ) : edit ? (
                          <>
                            {column.kind === 'name' ? (
                              // A name wraps rather than being cut off in a
                              // narrow column ("Prussian General S").
                              <textarea
                                aria-label={fieldLabel}
                                aria-describedby={issuesId}
                                aria-invalid={hasError || undefined}
                                value={String(rawValue)}
                                rows={1}
                                onChange={(event) => onEdit(entity.tempId, edit(event.target.value.replace(/\n/g, ' ')))}
                                onKeyDown={(event) => {
                                  // One line of meaning: Enter does not add a break.
                                  if (event.key === 'Enter') event.preventDefault()
                                }}
                                className={`${fieldClass} resize-none field-sizing-content`}
                              />
                            ) : (
                              <input
                                type={column.inputType ?? 'text'}
                                aria-label={fieldLabel}
                                aria-describedby={issuesId}
                                aria-invalid={hasError || undefined}
                                value={String(rawValue)}
                                onChange={(event) => onEdit(entity.tempId, edit(event.target.value))}
                                className={`${fieldClass} ${column.inputType === 'number' ? 'font-mono-code' : ''}`}
                              />
                            )}
                            {(column.key === 'actor' || column.key === 'target') && (
                              <NameMatchHint
                                match={graphMatches.get(entity.tempId)?.[column.key] ?? null}
                                onUse={(name) => onEdit(entity.tempId, edit(name))}
                              />
                            )}
                          </>
                        ) : refTempId !== undefined ? (
                          <EventReference
                            tempId={refTempId}
                            event={findExtractedEvent(eventLookup, refTempId)}
                          />
                        ) : column.key === 'confidence' && typeof rawValue === 'number' ? (
                          <span className="flex flex-col items-start gap-1">
                            <span
                              className={`font-mono-code inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${confidenceBadgeClass(rawValue)}`}
                            >
                              {String(rawValue)}
                            </span>
                            <span className="text-xs text-ink-muted">
                              <span className="sr-only">Source: </span>
                              {SOURCE_LABELS[entity.source.type] ?? entity.source.type}
                            </span>
                          </span>
                        ) : (
                          <span
                            className={`block break-words text-ink-secondary ${column.key === 'weight' ? 'font-mono-code' : ''}`}
                          >
                            {String(rawValue)}
                          </span>
                        )}
                        {columnIndex === 0 && 'timestamp' in entity && historySpan && isOutsideSpan(String(entity.timestamp), historySpan) && (
                          <p className="mt-1 text-xs text-warning" data-testid="outside-span">
                            <span className="font-medium">Outside this history ({formatSpan(historySpan)}).</span>{' '}
                            It starts unticked: tick it if it belongs.
                          </p>
                        )}
                        {columnIndex === 0 && graphMatches.get(entity.tempId)?.duplicate && (
                          <p className="mt-1 text-xs text-amber-800 dark:text-amber-300" data-testid="possible-duplicate">
                            <span className="font-medium">Possibly already in the graph:</span>{' '}
                            “{graphMatches.get(entity.tempId)!.duplicate!.description}”,{' '}
                            <span className="font-mono-code">
                              {formatEventDate(graphMatches.get(entity.tempId)!.duplicate!)}
                            </span>
                            . Untick the row to skip it.
                          </p>
                        )}
                        {columnIndex === 0 && rowIssues.length > 0 && (
                          <ul id={issuesId} className="mt-1 space-y-0.5 text-xs">
                            {rowIssues.map((issue, index) => (
                              <li
                                key={`${issue.severity}:${index}`}
                                className={
                                  issue.severity === 'error'
                                    ? 'text-red-700 dark:text-red-400'
                                    : 'text-amber-700 dark:text-amber-400'
                                }
                              >
                                <span className="font-medium">
                                  {issue.severity === 'error' ? 'Error' : 'Warning'}:
                                </span>{' '}
                                {issue.message}
                              </li>
                            ))}
                          </ul>
                        )}
                      </td>
                    )
                  })}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

/**
 * Under an actor or target field: whether the graph already knows the name,
 * or uses a variant of it, with one click to adopt the graph's spelling.
 */
function NameMatchHint({ match, onUse }: { match: NameMatch | null; onUse: (name: string) => void }) {
  if (!match) return null
  if (match.kind === 'known') {
    return <span className="mt-1 block text-xs text-ink-muted">Already in the graph</span>
  }
  return (
    <span className="mt-1 block text-xs text-amber-800 dark:text-amber-300">
      The graph has{' '}
      <button
        type="button"
        onClick={() => onUse(match.name)}
        className="rounded-sm font-medium text-ink underline decoration-amber-500/70 underline-offset-2 hover:decoration-amber-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-selected"
      >
        {match.name}
      </button>
      <span className="sr-only"> (use this name)</span>
    </span>
  )
}

/**
 * A relationship's cause or effect: the event's description and parties. The
 * extraction's tempId means nothing to a reviewer, so it is only in the title.
 */
function EventReference({ tempId, event }: { tempId: string; event?: ExtractedEvent }) {
  if (!event) {
    return (
      <span className="block text-ink-secondary" title={tempId}>
        An event not in this extraction
      </span>
    )
  }
  const text = describeExtractedEvent(event)
  return (
    <span className="block min-w-0" title={text}>
      <span className="block break-words text-ink">{text}</span>
    </span>
  )
}

/** The extraction source, as the source tabs name it. */
const SOURCE_LABELS: Record<string, string> = {
  text: 'Text',
  wikipedia: 'Wikipedia',
  wikidata: 'Wikidata',
}

interface ReviewDateFieldProps {
  label: string
  raw: string
  describedBy?: string
  invalid: boolean
  /** How much of the extracted date the source stated (month: "March 1871"). */
  precision?: DatePrecision
  /** The world calendar the extracted month or year was given in. */
  dateCalendar?: string
  className: string
  onChange: (value: string) => void
}

/**
 * A date to review: the editable value, compacted ("1870-02-14", not
 * "1870-02-14T00:00:00.000Z", which the column cut off), and under it the date
 * in words as the rest of the app writes it ("Feb 14, 1870"), or a note when
 * the importer could not read what was typed.
 */
function ReviewDateField({ label, raw, describedBy, invalid, precision, dateCalendar, className, onChange }: ReviewDateFieldProps) {
  const readingId = useId()
  // In a world, dates are shown and typed in its notation (the server reads
  // the reviewer's text with the graph's calendars).
  const calendar = useWorldCalendar()
  const compact = (value: string) => compactReviewDate(value, calendar, precision, dateCalendar)
  // The reviewer's own text, so compaction never rewrites what they type. It
  // follows `raw` only when the value changes from outside this field.
  const [draft, setDraft] = useState(() => compact(raw))
  const [seenRaw, setSeenRaw] = useState(raw)
  const [sent, setSent] = useState<string | null>(null)
  if (raw !== seenRaw) {
    setSeenRaw(raw)
    if (raw !== sent) setDraft(compact(raw))
  }
  const reading = readReviewDate(draft, calendar)
  const readable = reading !== null
  const describedByIds = [readingId, describedBy].filter(Boolean).join(' ')
  return (
    <>
      <input
        type="text"
        aria-label={label}
        aria-describedby={describedByIds}
        aria-invalid={invalid || !readable || undefined}
        value={draft}
        onChange={(event) => {
          const next = event.target.value
          setDraft(next)
          setSent(next)
          onChange(next)
        }}
        className={className}
      />
      <span
        id={readingId}
        className={`mt-1 block text-xs ${readable ? 'text-ink-muted' : 'text-red-700 dark:text-red-300'}`}
      >
        {!reading
          ? calendar
            ? `Not a date: write one as ${worldBoundExamples(calendar).day}`
            : 'Not a date: use YYYY-MM-DD'
          : precision && precision !== 'day' && draft === compact(raw)
            ? `${formatHistoricalDateAt(raw, precision, undefined, undefined, dateCalendar)}: the text gives no ${precision === 'month' ? 'day' : 'month or day'}`
            : reading.precision !== 'day'
              ? formatHistoricalDateAt(reading.iso, reading.precision, undefined, undefined, reading.calendar)
              : formatHistoricalTimestamp(reading.iso)}
      </span>
    </>
  )
}

export default EntityReviewTable
