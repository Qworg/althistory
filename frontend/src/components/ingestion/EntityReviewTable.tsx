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
 */

import { useState, useMemo } from 'react'
import type {
  ExtractedArc,
  ExtractedEvent,
  ExtractedEdit,
  ExtractedRelationship,
  IngestionValidationIssue,
} from '@/types'

export type ReviewEntity = ExtractedEvent | ExtractedArc | ExtractedRelationship
export type ReviewEntityType = 'event' | 'arc' | 'relationship'

interface ReviewColumn {
  key: string
  label: string
  editable: boolean
  inputType?: 'text' | 'number'
  value: (entity: ReviewEntity) => string | number
  edit?: (raw: string) => ExtractedEdit
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
    value: (entity) => ('description' in entity ? entity.description : ''),
    edit: (raw) => ({ description: raw }),
  },
  {
    key: 'actor',
    label: 'Actor',
    editable: true,
    value: (entity) => ('actor' in entity ? entity.actor : ''),
    edit: (raw) => ({ actor: raw }),
  },
  {
    key: 'target',
    label: 'Target',
    editable: true,
    value: (entity) => ('target' in entity ? entity.target : ''),
    edit: (raw) => ({ target: raw }),
  },
  {
    key: 'timestamp',
    label: 'Timestamp',
    editable: true,
    value: (entity) => ('timestamp' in entity ? entity.timestamp : ''),
    edit: (raw) => ({ timestamp: raw }),
  },
  { key: 'source', label: 'Source', editable: false, value: (entity) => entity.source.type },
  { key: 'confidence', label: 'Confidence', editable: false, value: (entity) => entity.confidence },
]

const arcColumns: ReviewColumn[] = [
  {
    key: 'name',
    label: 'Name',
    editable: true,
    value: (entity) => ('name' in entity ? entity.name : ''),
    edit: (raw) => ({ name: raw }),
  },
  {
    key: 'description',
    label: 'Description',
    editable: true,
    value: (entity) => ('description' in entity ? entity.description : ''),
    edit: (raw) => ({ description: raw }),
  },
  {
    key: 'start_time',
    label: 'Start',
    editable: true,
    value: (entity) => ('start_time' in entity ? entity.start_time : ''),
    edit: (raw) => ({ start_time: raw }),
  },
  {
    key: 'end_time',
    label: 'End',
    editable: true,
    value: (entity) => ('end_time' in entity ? entity.end_time : ''),
    edit: (raw) => ({ end_time: raw }),
  },
  {
    key: 'level',
    label: 'Level',
    editable: true,
    inputType: 'number',
    value: (entity) => ('level' in entity ? entity.level : 0),
    edit: (raw) => ({ level: toNumber(raw) }),
  },
  { key: 'source', label: 'Source', editable: false, value: (entity) => entity.source.type },
  { key: 'confidence', label: 'Confidence', editable: false, value: (entity) => entity.confidence },
]

const relationshipColumns: ReviewColumn[] = [
  {
    key: 'cause',
    label: 'Cause event',
    editable: false,
    value: (entity) => ('causeEventTempId' in entity ? entity.causeEventTempId : ''),
  },
  {
    key: 'effect',
    label: 'Effect event',
    editable: false,
    value: (entity) => ('effectEventTempId' in entity ? entity.effectEventTempId : ''),
  },
  {
    key: 'weight',
    label: 'Weight',
    editable: false,
    value: (entity) => ('weight' in entity ? entity.weight : 0),
  },
  {
    key: 'reasoning',
    label: 'Reasoning',
    editable: false,
    value: (entity) => ('reasoning' in entity ? entity.reasoning : ''),
  },
  { key: 'confidence', label: 'Confidence', editable: false, value: (entity) => entity.confidence },
]

const COLUMNS: Record<ReviewEntityType, ReviewColumn[]> = {
  event: eventColumns,
  arc: arcColumns,
  relationship: relationshipColumns,
}

export interface EntityReviewTableProps {
  entityType: ReviewEntityType
  entities: ReviewEntity[]
  onToggleSelection: (tempId: string) => void
  onEdit: (tempId: string, updates: ExtractedEdit) => void
  onSelectAll: () => void
  onDeselectAll: () => void
  /** Validation issues rendered under the row they belong to. */
  issues?: IngestionValidationIssue[]
}

function confidenceBadgeClass(confidence: number): string {
  if (confidence >= 0.8) {
    return 'bg-emerald-100 text-emerald-800 border-emerald-200'
  }
  if (confidence >= 0.5) {
    return 'bg-amber-100 text-amber-800 border-amber-200'
  }
  return 'bg-rose-100 text-rose-800 border-rose-200'
}

export function EntityReviewTable({
  entityType,
  entities,
  onToggleSelection,
  onEdit,
  onSelectAll,
  onDeselectAll,
  issues = [],
}: EntityReviewTableProps) {
  const columns = COLUMNS[entityType]
  const [sortKey, setSortKey] = useState<string | null>(null)
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')

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

  const allSelected = entities.length > 0 && entities.every((entity) => entity.selected)
  const selectedCount = entities.filter((entity) => entity.selected).length
  const label = `${entityType}s`

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-gray-200 text-sm">
        <caption className="sr-only">
          Extracted {label}: {selectedCount} of {entities.length} selected
        </caption>
        <thead className="bg-gray-50">
          <tr>
            <th scope="col" className="px-2 py-2 text-left">
              <input
                type="checkbox"
                aria-label={`Select all ${entityType} entities`}
                checked={allSelected}
                onChange={() => (allSelected ? onDeselectAll() : onSelectAll())}
                className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
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
                className="px-3 py-2 text-left font-medium text-gray-600"
              >
                <button
                  type="button"
                  onClick={() => handleSort(column.key)}
                  className="inline-flex items-center gap-1 hover:text-gray-900 focus:outline-none"
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
        <tbody className="divide-y divide-gray-100 bg-white">
          {sortedEntities.map((entity) => {
            const error = issues.find(
              (issue) => issue.entityTempId === entity.tempId && issue.severity === 'error'
            )
            return (
              <tr key={entity.tempId} className={entity.selected ? '' : 'opacity-60'}>
                <td className="px-2 py-2 align-top">
                  <input
                    type="checkbox"
                    aria-label={`Select ${entityType} ${entity.tempId}`}
                    checked={entity.selected}
                    onChange={() => onToggleSelection(entity.tempId)}
                    className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                </td>
                {columns.map((column) => {
                  const edit = column.editable ? column.edit : undefined
                  const rawValue = column.value(entity)
                  return (
                    <td key={column.key} className="px-3 py-2 align-top">
                      {edit ? (
                        <input
                          type={column.inputType ?? 'text'}
                          aria-label={`${column.label} for ${entityType} ${entity.tempId}`}
                          value={String(rawValue)}
                          onChange={(event) => onEdit(entity.tempId, edit(event.target.value))}
                          className="w-full min-w-32 rounded border border-gray-300 px-2 py-1 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                        />
                      ) : column.key === 'confidence' && typeof rawValue === 'number' ? (
                        <span
                          className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${confidenceBadgeClass(rawValue)}`}
                        >
                          {String(rawValue)}
                        </span>
                      ) : (
                        <span className="text-gray-700">{String(rawValue)}</span>
                      )}
                      {column.key === 'description' && error && (
                        <p className="mt-1 text-xs text-red-600">{error.message}</p>
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
  )
}

export default EntityReviewTable
