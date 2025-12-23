import { Event, Arc } from '@/types'

// Form data interface for arc editing
export interface ArcFormData {
  name?: string
  description?: string
  start_time?: string
  end_time?: string
  parent_arc_id?: string | null
}

// Validation error interface
export interface ValidationErrors {
  name?: string
  description?: string
  start_time?: string
  end_time?: string
  time_range?: string
  general?: string
}

/**
 * Validates arc form data
 * @param formData - The form data to validate
 * @param containedEvents - Events that are contained within this arc (optional)
 * @returns An object containing validation errors (empty if valid)
 */
export function validateArcForm(
  formData: ArcFormData,
  containedEvents: Event[] = []
): ValidationErrors {
  const errors: ValidationErrors = {}

  if (!formData.name?.trim()) {
    errors.name = 'Name is required'
  }

  if (!formData.description?.trim()) {
    errors.description = 'Description is required'
  }

  if (!formData.start_time) {
    errors.start_time = 'Start time is required'
  }

  if (!formData.end_time) {
    errors.end_time = 'End time is required'
  }

  if (formData.start_time && formData.end_time) {
    const startTime = new Date(formData.start_time)
    const endTime = new Date(formData.end_time)

    if (startTime >= endTime) {
      errors.end_time = 'End time must be after start time'
    }

    const startMs = startTime.getTime()
    const endMs = endTime.getTime()

    const eventsOutsideRange = containedEvents.filter(event => {
      const eventTime = new Date(event.timestamp).getTime()
      return eventTime < startMs || eventTime > endMs
    })

    if (eventsOutsideRange.length > 0) {
      errors.time_range = `${eventsOutsideRange.length} contained events would be outside the new time range`
    }
  }

  return errors
}

/**
 * Checks if the validation errors object indicates a valid form
 * @param errors - The validation errors object
 * @returns true if the form is valid (no errors)
 */
export function isFormValid(errors: ValidationErrors): boolean {
  return Object.keys(errors).length === 0
}

/**
 * Returns counts for tab badges
 * @param containedEvents - Events contained in the arc
 * @param childArcs - Child arcs
 * @param inferredPressures - Inferred pressures
 * @returns Object with counts for each tab
 */
export function getTabCounts(
  containedEvents: Event[],
  childArcs: Arc[],
  inferredPressures: { id: string }[] = []
): { events: number; arcs: number; pressures: number } {
  return {
    events: containedEvents.length,
    arcs: childArcs.length,
    pressures: inferredPressures.length
  }
}

/**
 * Generates delete confirmation message based on arc relationships
 * @param childArcs - Child arcs that would be affected
 * @returns Appropriate confirmation message
 */
export function getDeleteConfirmationMessage(childArcs: Arc[]): string {
  if (childArcs.length > 0) {
    return `This arc has ${childArcs.length} child arcs. Deleting it will also delete all child arcs. Are you sure?`
  }
  return 'Are you sure you want to delete this arc?'
}

/**
 * Initializes form data from an existing arc
 * @param arc - The arc to initialize from (or null for create mode)
 * @returns Initial form data
 */
export function initializeFormData(arc: Arc | null): ArcFormData {
  if (arc) {
    return {
      name: arc.name,
      description: arc.description,
      start_time: arc.start_time,
      end_time: arc.end_time,
      parent_arc_id: arc.parent_arc_id
    }
  }
  return {
    name: '',
    description: '',
    start_time: '',
    end_time: '',
    parent_arc_id: null
  }
}

/**
 * Converts a datetime-local input value to ISO string
 * @param value - The datetime-local input value
 * @returns ISO string or empty string
 */
export function datetimeLocalToISO(value: string): string {
  if (!value) return ''
  return new Date(value).toISOString()
}

/**
 * Converts an ISO string to datetime-local input value
 * @param isoString - The ISO string
 * @returns datetime-local compatible string
 */
export function isoToDatetimeLocal(isoString: string | undefined): string {
  if (!isoString) return ''
  return new Date(isoString).toISOString().slice(0, 16)
}
