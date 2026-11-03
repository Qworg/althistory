import { useState, useEffect, useContext, useMemo } from 'react'
import { QueryClientContext } from '@tanstack/react-query'
import { Arc, CausalRelationship, Event } from '@/types'
import { useEvents } from '@/hooks/useAPI'
import { formatHistoricalDateBound, parseHistoricalDate } from '@/components/filters/filterUtils'
import { formatHistoricalDate } from '@/utils/historicalTime'

/** The fields checked on save, in the order they appear (and are focused). */
const VALIDATED_FIELDS = ['description', 'actor', 'target', 'timestamp'] as const
type ValidatedField = (typeof VALIDATED_FIELDS)[number]

const PARTY_SUGGESTIONS_ID = 'event-party-suggestions'

/**
 * The actors and targets already in the graph, offered as suggestions for both
 * fields (a party that acts in one event is often acted upon in another), so
 * "Prussian General Staff" is picked rather than retyped as a near-duplicate.
 * Same query and key as the Timeline view, so it is usually cached.
 */
function PartySuggestions() {
  const { data: events } = useEvents({ limit: 1000 })
  const names = useMemo(() => {
    const set = new Set<string>()
    for (const e of events ?? []) {
      if (e.actor?.trim()) set.add(e.actor.trim())
      if (e.target?.trim()) set.add(e.target.trim())
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b))
  }, [events])
  return (
    <datalist id={PARTY_SUGGESTIONS_ID}>
      {names.map((name) => (
        <option key={name} value={name} />
      ))}
    </datalist>
  )
}

/**
 * What caused a new event: one of the graph's events, no later than the new
 * one (a cause may share its effect's moment, never follow it), and the kind
 * of link. Optional; the link is created with the event.
 */
function CausePicker({
  causeId,
  causeType,
  timestampText,
  onChange,
}: {
  causeId: string
  causeType: CausalLinkType
  timestampText: string
  onChange: (causeId: string, causeType: CausalLinkType) => void
}) {
  const { data: events } = useEvents({ limit: 1000 })
  const parsed = timestampText.trim() ? fromDateField(timestampText) : null
  const limit = parsed?.ok ? new Date(parsed.iso).getTime() : null
  const candidates = useMemo(
    () =>
      [...(events ?? [])]
        .filter((e) => limit === null || new Date(e.timestamp).getTime() <= limit)
        .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()),
    [events, limit]
  )
  // A cause the new date has overtaken is no longer offered, so drop it.
  useEffect(() => {
    if (causeId && events && !candidates.some((e) => e.id === causeId)) onChange('', causeType)
  }, [causeId, candidates, events, causeType, onChange])

  return (
    <fieldset className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-x-4 gap-y-1">
      <legend className="sr-only">Cause</legend>
      <div className="min-w-0">
        <label htmlFor="cause" className="block text-sm font-medium text-ink-secondary">
          Caused by <span className="font-normal text-ink-muted">(optional)</span>
        </label>
        <select
          id="cause"
          value={causeId}
          onChange={(e) => onChange(e.target.value, causeType)}
          className="mt-1 block w-full border border-line rounded-md shadow-sm px-3 py-2 bg-card text-ink focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
        >
          <option value="">Nothing yet</option>
          {candidates.map((e) => (
            <option key={e.id} value={e.id}>
              {formatHistoricalDate(e.timestamp)} · {e.description}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor="cause-type" className="block text-sm font-medium text-ink-secondary">
          Link
        </label>
        <select
          id="cause-type"
          value={causeType}
          disabled={!causeId}
          onChange={(e) => onChange(causeId, e.target.value as CausalLinkType)}
          className="mt-1 block w-full border border-line rounded-md shadow-sm px-3 py-2 bg-card text-ink focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:opacity-60"
        >
          <option value="direct">Direct</option>
          <option value="indirect">Indirect</option>
          <option value="contributory">Contributory</option>
        </select>
      </div>
      <p className="sm:col-span-2 text-xs text-ink-muted">
        {limit === null
          ? 'Lists every event; give the date to list only those up to it.'
          : 'Lists the events up to this date: a cause cannot come after its effect.'}
      </p>
    </fieldset>
  )
}

/**
 * The date field, as the filter panel writes dates: year first, as precise as
 * is known (`1843`, `1843-11`, `1843-11-20`), `BCE` before 1 CE, and an
 * optional UTC time after it (`1843-11-20 14:30`). A native date-time picker
 * shows the browser's locale order and cannot reach BCE at all.
 */
const TIME_SUFFIX = /^(.+?)(?:[ T](\d{1,2}):(\d{2}))$/

function toDateField(isoString: string): string {
  if (!isoString) return ''
  const date = new Date(isoString)
  if (isNaN(date.getTime())) return ''
  const day = formatHistoricalDateBound(date, 'start')
  const hours = date.getUTCHours()
  const minutes = date.getUTCMinutes()
  return hours || minutes ? `${day} ${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}` : day
}

type DateFieldParse = { ok: true; iso: string } | { ok: false; error: string }

function fromDateField(text: string): DateFieldParse {
  const trimmed = text.trim()
  const timed = TIME_SUFFIX.exec(trimmed)
  const datePart = timed ? timed[1]! : trimmed
  const parsed = parseHistoricalDate(datePart, 'start')
  if (!parsed.ok) return { ok: false, error: parsed.error }
  const date = new Date(parsed.date.getTime())
  if (timed) {
    const hours = Number(timed[2])
    const minutes = Number(timed[3])
    if (hours > 23 || minutes > 59) return { ok: false, error: 'The time must be 00:00 to 23:59, in UTC.' }
    date.setUTCHours(hours, minutes, 0, 0)
  }
  return { ok: true, iso: date.toISOString() }
}

/** The event's recorded confidence, as the field shows it ('' when none is recorded). */
function confidenceField(event: Event | null): string {
  const value = event?.metadata?.confidence
  return typeof value === 'number' && Number.isFinite(value) ? String(value) : ''
}

function metadataText(event: Event | null, key: string): string {
  const value = event?.metadata?.[key]
  return typeof value === 'string' ? value : ''
}

export type CausalLinkType = 'direct' | 'indirect' | 'contributory'

/** What the form asks for beyond the event itself: the link to its cause, when one was picked. */
export interface EventSaveExtras {
  cause?: { eventId: string; type: CausalLinkType }
}

interface EventDetailModalProps {
  event: Event | null
  isOpen: boolean
  onClose: () => void
  /** `extras.cause` is set when the user named what caused a new event. */
  onSave: (updates: Partial<Event>, extras?: EventSaveExtras) => Promise<void>
  onDelete?: () => Promise<void>
  relatedArcs?: Arc[]
  causalRelationships?: CausalRelationship[]
  /**
   * ISO timestamp used to prefill the creation form when `event` is null.
   * The timeline passes the double-clicked time so a new event starts at the
   * point the user chose rather than at an empty field.
   */
  initialTimestamp?: string
  className?: string
}

interface EventFormData {
  description: string
  actor: string
  target: string
  timestamp: string
  event_type: string
  /** '' when not stated: no claim of certainty, rather than a default of 1. */
  confidence: string
  evidence: string
  /** The event that caused this one (create only), and how. */
  causeId: string
  causeType: CausalLinkType
}

const EMPTY_FORM: EventFormData = {
  description: '',
  actor: '',
  target: '',
  timestamp: '',
  event_type: '',
  confidence: '',
  evidence: '',
  causeId: '',
  causeType: 'direct',
}

export function EventDetailModal({
  event,
  isOpen,
  onClose,
  onSave,
  onDelete,
  relatedArcs = [],
  causalRelationships = [],
  initialTimestamp,
  className = ''
}: EventDetailModalProps) {
  const [formData, setFormData] = useState<EventFormData>(EMPTY_FORM)
  const [isLoading, setIsLoading] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  // The first invalid field after a save attempt, focused once its message
  // and aria-describedby are rendered (so a screen reader reads both).
  const [pendingFocus, setPendingFocus] = useState<ValidatedField | null>(null)
  // Suggestions need the events query; a host without a query client (a
  // unit test, say) simply gets none.
  const hasQueryClient = !!useContext(QueryClientContext)

  useEffect(() => {
    if (!pendingFocus) return
    document.getElementById(pendingFocus)?.focus()
    setPendingFocus(null)
  }, [pendingFocus])

  // Update form data when event changes
  useEffect(() => {
    if (event) {
      setFormData({
        ...EMPTY_FORM,
        description: event.description || '',
        actor: event.actor || '',
        target: event.target || '',
        timestamp: toDateField(event.timestamp || ''),
        // Kept in the event's metadata, where the timeline reads confidence.
        event_type: metadataText(event, 'eventType'),
        confidence: confidenceField(event),
        evidence: metadataText(event, 'evidence'),
      })
    } else {
      setFormData({
        ...EMPTY_FORM,
        timestamp: initialTimestamp ? toDateField(initialTimestamp) : '',
      })
    }
    setErrors({})
    setShowDeleteConfirm(false)
  }, [event, isOpen, initialTimestamp])

  // Handle escape key
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose()
      }
    }

    if (isOpen) {
      document.addEventListener('keydown', handleEscape)
      document.body.style.overflow = 'hidden'
    }

    return () => {
      document.removeEventListener('keydown', handleEscape)
      document.body.style.overflow = 'unset'
    }
  }, [isOpen, onClose])

  const validateForm = (): boolean => {
    const newErrors: Record<string, string> = {}

    if (!formData.description.trim()) {
      newErrors.description = 'Describe what happened.'
    }

    if (!formData.actor.trim()) {
      newErrors.actor = 'Name who acted, e.g. a person, faction or office.'
    }

    if (!formData.target.trim()) {
      newErrors.target = 'Name who or what was acted upon.'
    }

    if (!formData.timestamp.trim()) {
      newErrors.timestamp = 'Give the date it happened, year first: 1843, 1843-11 or 1843-11-20.'
    } else {
      const parsed = fromDateField(formData.timestamp)
      if (!parsed.ok) newErrors.timestamp = parsed.error
    }

    if (formData.confidence.trim() !== '') {
      const value = Number(formData.confidence)
      if (!Number.isFinite(value) || value < 0 || value > 1) {
        newErrors.confidence = 'Give a confidence from 0 to 1, or leave it empty.'
      }
    }

    setErrors(newErrors)
    const firstInvalid = VALIDATED_FIELDS.find((field) => newErrors[field])
    if (firstInvalid) setPendingFocus(firstInvalid)
    return Object.keys(newErrors).length === 0
  }

  const handleInputChange = (field: keyof EventFormData, value: string | number) => {
    setFormData(prev => ({
      ...prev,
      [field]: value
    }))

    // Clear error for this field
    if (errors[field]) {
      setErrors(prev => ({
        ...prev,
        [field]: ''
      }))
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!validateForm()) {
      return
    }

    setIsLoading(true)
    try {
      // Only pass fields that exist on Event type
      // Convert datetime-local format to ISO string for API
      const parsedDate = fromDateField(formData.timestamp)
      // The rest of the metadata is the event's own; only the fields this form
      // edits are replaced (an empty one is removed rather than saved blank).
      const metadata: Record<string, unknown> = { ...(event?.metadata ?? {}) }
      const setOrDrop = (key: string, value: unknown) => {
        if (value === '' || value === undefined) delete metadata[key]
        else metadata[key] = value
      }
      setOrDrop('confidence', formData.confidence.trim() === '' ? undefined : Number(formData.confidence))
      setOrDrop('evidence', formData.evidence.trim())
      setOrDrop('eventType', formData.event_type.trim())
      const eventData: Partial<Event> = {
        description: formData.description,
        actor: formData.actor,
        target: formData.target,
        timestamp: parsedDate.ok ? parsedDate.iso : '',
        metadata,
      }
      const extras: EventSaveExtras | undefined =
        !event && formData.causeId ? { cause: { eventId: formData.causeId, type: formData.causeType } } : undefined
      await (extras ? onSave(eventData, extras) : onSave(eventData))
      onClose()
    } catch (error) {
      console.error('Failed to save event:', error)
      setErrors({ submit: 'The event could not be saved. Your changes are still here; try again.' })
    } finally {
      setIsLoading(false)
    }
  }

  const handleDelete = async () => {
    if (!onDelete) return
    setIsLoading(true)
    try {
      await onDelete()
      onClose()
    } catch (error) {
      console.error('Failed to delete event:', error)
      setErrors({ submit: 'The event could not be deleted. Try again.' })
    } finally {
      setIsLoading(false)
      setShowDeleteConfirm(false)
    }
  }

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose()
    }
  }

  if (!isOpen) {
    return null
  }

  return (
    <div
      className={`fixed inset-0 z-50 overflow-y-auto ${className}`}
      aria-labelledby="event-modal-title"
      role="dialog"
      aria-modal="true"
    >
      <div
        className="flex items-center justify-center min-h-screen pt-4 px-4 pb-20 text-center sm:block sm:p-0"
        onClick={handleBackdropClick}
      >
        <div className="fixed inset-0 bg-black/60 transition-opacity" aria-hidden="true" />

        <span className="hidden sm:inline-block sm:align-middle sm:h-screen" aria-hidden="true">
          &#8203;
        </span>

        <div className="relative z-10 inline-block align-bottom bg-card rounded-lg text-left overflow-hidden shadow-xl transform transition-all sm:my-8 sm:align-middle sm:max-w-2xl sm:w-full">
          {/* noValidate: the browser's own "Please fill out this field."
              bubbles are replaced by the messages under each field. */}
          <form onSubmit={handleSubmit} noValidate>
            <div className="bg-card px-4 pt-5 pb-4 sm:p-6 sm:pb-4">
              <div className="sm:flex sm:items-start">
                <div className="w-full">
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="font-display text-xl font-semibold text-ink" id="event-modal-title">
                      {event ? 'Edit Event' : 'Create Event'}
                    </h2>
                    <button
                      type="button"
                      onClick={onClose}
                      className="rounded-md text-ink-muted hover:text-ink-secondary focus:outline-none focus:ring-2 focus:ring-blue-500"
                      aria-label="Close modal"
                    >
                      <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>

                  {errors.submit && (
                    <div className="mb-4 p-3 bg-red-100 border border-red-400 text-red-700 rounded" role="alert">
                      {errors.submit}
                    </div>
                  )}

                  <div className="space-y-4">
                    {/* Description */}
                    <div>
                      <label htmlFor="description" className="block text-sm font-medium text-ink-secondary">
                        Description <span className="text-red-500">*</span>
                      </label>
                      <textarea
                        id="description"
                        rows={3}
                        value={formData.description}
                        onChange={(e) => handleInputChange('description', e.target.value)}
                        aria-required="true"
                        aria-invalid={!!errors.description}
                        aria-describedby={errors.description ? 'description-error' : undefined}
                        className={`mt-1 block w-full border rounded-md shadow-sm px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 ${
                          errors.description ? 'border-red-300' : 'border-line'
                        }`}
                        placeholder="What happened?"
                        required
                      />
                      {errors.description && (
                        <p id="description-error" className="mt-1 text-sm text-red-700 dark:text-red-300">{errors.description}</p>
                      )}
                    </div>

                    {/* Actor and Target */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label htmlFor="actor" className="block text-sm font-medium text-ink-secondary">
                          Actor <span className="text-red-500">*</span>
                        </label>
                        <input
                          type="text"
                          id="actor"
                          value={formData.actor}
                          onChange={(e) => handleInputChange('actor', e.target.value)}
                          list={hasQueryClient ? PARTY_SUGGESTIONS_ID : undefined}
                          autoComplete="off"
                          aria-required="true"
                          aria-invalid={!!errors.actor}
                          aria-describedby={errors.actor ? 'actor-error' : undefined}
                          className={`mt-1 block w-full border rounded-md shadow-sm px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 ${
                            errors.actor ? 'border-red-300' : 'border-line'
                          }`}
                          placeholder="Who acted"
                          required
                        />
                        {errors.actor && (
                          <p id="actor-error" className="mt-1 text-sm text-red-700 dark:text-red-300">{errors.actor}</p>
                        )}
                      </div>

                      <div>
                        <label htmlFor="target" className="block text-sm font-medium text-ink-secondary">
                          Target <span className="text-red-500">*</span>
                        </label>
                        <input
                          type="text"
                          id="target"
                          value={formData.target}
                          onChange={(e) => handleInputChange('target', e.target.value)}
                          list={hasQueryClient ? PARTY_SUGGESTIONS_ID : undefined}
                          autoComplete="off"
                          aria-required="true"
                          aria-invalid={!!errors.target}
                          aria-describedby={errors.target ? 'target-error' : undefined}
                          className={`mt-1 block w-full border rounded-md shadow-sm px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 ${
                            errors.target ? 'border-red-300' : 'border-line'
                          }`}
                          placeholder="Who or what was acted upon"
                          required
                        />
                        {hasQueryClient && <PartySuggestions />}
                        {errors.target && (
                          <p id="target-error" className="mt-1 text-sm text-red-700 dark:text-red-300">{errors.target}</p>
                        )}
                      </div>
                    </div>

                    {/* Timestamp and Event Type */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label htmlFor="timestamp" className="block text-sm font-medium text-ink-secondary">
                          Date <span className="font-normal text-ink-muted">(UTC)</span> <span className="text-red-500">*</span>
                        </label>
                        <input
                          type="text"
                          id="timestamp"
                          inputMode="text"
                          autoComplete="off"
                          spellCheck={false}
                          value={formData.timestamp}
                          onChange={(e) => handleInputChange('timestamp', e.target.value)}
                          aria-required="true"
                          aria-invalid={!!errors.timestamp}
                          aria-describedby={`timestamp-hint${errors.timestamp ? ' timestamp-error' : ''}`}
                          className={`mt-1 block w-full font-mono-code border rounded-md shadow-sm px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 ${
                            errors.timestamp ? 'border-red-300' : 'border-line'
                          }`}
                          required
                        />
                        <p id="timestamp-hint" className="mt-1 text-xs text-ink-muted">
                          {(() => {
                            const parsed = formData.timestamp.trim() ? fromDateField(formData.timestamp) : null
                            return parsed?.ok
                              ? `Reads as ${formatHistoricalDate(parsed.iso)}.`
                              : 'Year first, as precise as you know: 1843, 1843-11 or 1843-11-20. Add BCE before 1 CE, and a time if it matters (1843-11-20 14:30).'
                          })()}
                        </p>
                        {errors.timestamp && (
                          <p id="timestamp-error" className="mt-1 text-sm text-red-700 dark:text-red-300">{errors.timestamp}</p>
                        )}
                      </div>

                      <div>
                        <label htmlFor="event_type" className="block text-sm font-medium text-ink-secondary">
                          Event Type
                        </label>
                        <input
                          type="text"
                          id="event_type"
                          value={formData.event_type}
                          onChange={(e) => handleInputChange('event_type', e.target.value)}
                          className="mt-1 block w-full border border-line rounded-md shadow-sm px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        />
                        <p className="mt-1 text-xs text-ink-muted">Optional, e.g. treaty, battle, invention.</p>
                      </div>
                    </div>

                    {/* Confidence: optional, so a new event makes no claim it was not given */}
                    <div>
                      <label htmlFor="confidence" className="block text-sm font-medium text-ink-secondary">
                        Confidence <span className="font-normal text-ink-muted">(optional, 0 to 1)</span>
                      </label>
                      <input
                        type="number"
                        id="confidence"
                        min={0}
                        max={1}
                        step={0.05}
                        inputMode="decimal"
                        value={formData.confidence}
                        onChange={(e) => handleInputChange('confidence', e.target.value)}
                        aria-invalid={!!errors.confidence}
                        aria-describedby={`confidence-hint${errors.confidence ? ' confidence-error' : ''}`}
                        className="mt-1 block w-32 font-mono-code border border-line rounded-md shadow-sm px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      />
                      <p id="confidence-hint" className="mt-1 text-xs text-ink-muted">
                        How sure the history is that this happened. Empty means not stated. The timeline draws
                        an event below 0.75 as probable and below 0.4 as speculative.
                      </p>
                      {errors.confidence && (
                        <p id="confidence-error" role="alert" className="mt-1 text-sm text-red-700 dark:text-red-300">{errors.confidence}</p>
                      )}
                    </div>

                    {/* What caused it: a new event can be linked to its cause as it is made */}
                    {!event && hasQueryClient && (
                      <CausePicker
                        causeId={formData.causeId}
                        causeType={formData.causeType}
                        timestampText={formData.timestamp}
                        onChange={(causeId, causeType) => setFormData((prev) => ({ ...prev, causeId, causeType }))}
                      />
                    )}

                    {/* Evidence */}
                    <div>
                      <label htmlFor="evidence" className="block text-sm font-medium text-ink-secondary">
                        Evidence
                      </label>
                      <textarea
                        id="evidence"
                        rows={3}
                        value={formData.evidence}
                        onChange={(e) => handleInputChange('evidence', e.target.value)}
                        className="mt-1 block w-full border border-line rounded-md shadow-sm px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      />
                      <p className="mt-1 text-xs text-ink-muted">Optional: the source or reasoning behind it.</p>
                    </div>

                    {/* Related Information */}
                    {event && (relatedArcs.length > 0 || causalRelationships.length > 0) && (
                      <div className="border-t border-line pt-4">
                        <h3 className="text-base font-semibold text-ink mb-3">Related Information</h3>
                        
                        {relatedArcs.length > 0 && (
                          <div className="mb-3">
                            <h4 className="text-sm font-semibold text-ink-secondary mb-2">Related Arcs</h4>
                            <div className="space-y-1">
                              {relatedArcs.map((arc) => (
                                <div key={arc.id} className="text-sm text-ink-secondary bg-subtle px-2 py-1 rounded">
                                  {arc.name}
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {causalRelationships.length > 0 && (
                          <div>
                            <h4 className="text-sm font-semibold text-ink-secondary mb-2">Causal Relationships</h4>
                            <div className="space-y-1">
                              {causalRelationships.map((rel) => (
                                <div key={rel.id} className="text-sm text-ink-secondary bg-subtle px-2 py-1 rounded">
                                  {rel.relationship_type} (Weight: {rel.weight})
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>

            <div className="bg-subtle px-4 py-3 sm:px-6 sm:flex sm:flex-row-reverse">
              <button
                type="submit"
                disabled={isLoading}
                className="w-full inline-flex justify-center rounded-md border border-transparent shadow-sm px-4 py-2 bg-blue-600 text-base font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 sm:ml-3 sm:w-auto sm:text-sm disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isLoading ? 'Saving…' : 'Save'}
              </button>

              <button
                type="button"
                onClick={onClose}
                className="mt-3 w-full inline-flex justify-center rounded-md border border-line shadow-sm px-4 py-2 bg-card text-base font-medium text-ink-secondary hover:bg-subtle focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 sm:mt-0 sm:ml-3 sm:w-auto sm:text-sm"
              >
                Cancel
              </button>

              {event && (
                <button
                  type="button"
                  onClick={() => setShowDeleteConfirm(true)}
                  className="mt-3 w-full inline-flex justify-center rounded-md border border-red-300 shadow-sm px-4 py-2 bg-card text-base font-medium text-red-700 hover:bg-red-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500 sm:mt-0 sm:w-auto sm:text-sm"
                >
                  Delete
                </button>
              )}
            </div>
          </form>
        </div>
      </div>

      {/* Delete Confirmation Modal */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 z-60 overflow-y-auto">
          <div className="flex items-center justify-center min-h-screen pt-4 px-4 pb-20 text-center sm:block sm:p-0">
            <div className="fixed inset-0 bg-black/60 transition-opacity" />
            <div className="relative z-10 inline-block align-bottom bg-card rounded-lg text-left overflow-hidden shadow-xl transform transition-all sm:my-8 sm:align-middle sm:max-w-lg sm:w-full">
              <div className="bg-card px-4 pt-5 pb-4 sm:p-6 sm:pb-4">
                <div className="sm:flex sm:items-start">
                  <div className="mx-auto flex-shrink-0 flex items-center justify-center h-12 w-12 rounded-full bg-red-100 sm:mx-0 sm:h-10 sm:w-10">
                    <svg className="h-6 w-6 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z" />
                    </svg>
                  </div>
                  <div className="mt-3 text-center sm:mt-0 sm:ml-4 sm:text-left">
                    <h2 className="font-display text-xl font-semibold text-ink">
                      Delete Event
                    </h2>
                    <div className="mt-2">
                      <p className="text-sm text-ink-secondary">
                        “{event?.description}”
                        {causalRelationships.length > 0
                          ? ` and its ${causalRelationships.length} causal ${causalRelationships.length === 1 ? 'link' : 'links'} will be removed.`
                          : ' will be removed.'}{' '}
                        Version history can restore the graph to before the deletion.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
              <div className="bg-subtle px-4 py-3 sm:px-6 sm:flex sm:flex-row-reverse">
                <button
                  type="button"
                  onClick={handleDelete}
                  disabled={isLoading}
                  className="w-full inline-flex justify-center rounded-md border border-transparent shadow-sm px-4 py-2 bg-red-600 text-base font-medium text-white hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500 sm:ml-3 sm:w-auto sm:text-sm disabled:opacity-50"
                >
                  {isLoading ? 'Deleting…' : 'Delete event'}
                </button>
                <button
                  type="button"
                  onClick={() => setShowDeleteConfirm(false)}
                  className="mt-3 w-full inline-flex justify-center rounded-md border border-line shadow-sm px-4 py-2 bg-card text-base font-medium text-ink-secondary hover:bg-subtle focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 sm:mt-0 sm:ml-3 sm:w-auto sm:text-sm"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
