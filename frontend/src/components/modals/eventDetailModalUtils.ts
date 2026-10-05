import { Event } from '@/types'

// Form data interface for event editing
export interface EventFormData {
  description: string
  actor: string
  target: string
  timestamp: string
  event_type: string
  confidence: number
  evidence: string
}

// Validation error interface
export interface EventValidationErrors {
  description?: string
  actor?: string
  timestamp?: string
  confidence?: string
  submit?: string
}

// ISO 8601 timestamp regex pattern
const TIMESTAMP_REGEX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z?$/

/**
 * Validates event form data
 * @param formData - The form data to validate
 * @returns An object containing validation errors (empty if valid)
 */
export function validateEventForm(formData: EventFormData): EventValidationErrors {
  const errors: EventValidationErrors = {}

  if (!formData.description.trim()) {
    errors.description = 'Description is required'
  }

  if (!formData.actor.trim()) {
    errors.actor = 'Actor is required'
  }

  if (!formData.timestamp.trim()) {
    errors.timestamp = 'Timestamp is required'
  } else if (!TIMESTAMP_REGEX.test(formData.timestamp)) {
    errors.timestamp = 'Invalid timestamp format (use ISO 8601)'
  }

  if (formData.confidence < 0 || formData.confidence > 1) {
    errors.confidence = 'Confidence must be between 0 and 1'
  }

  return errors
}

/**
 * Checks if the validation errors object indicates a valid form
 * @param errors - The validation errors object
 * @returns true if the form is valid (no errors)
 */
export function isEventFormValid(errors: EventValidationErrors): boolean {
  return Object.keys(errors).length === 0
}

/**
 * Creates an empty form data object for creating a new event
 * @returns Initial empty form data
 */
export function createEmptyEventFormData(): EventFormData {
  return {
    description: '',
    actor: '',
    target: '',
    timestamp: '',
    event_type: '',
    confidence: 1.0,
    evidence: ''
  }
}

/**
 * Initializes form data from an existing event
 * @param event - The event to initialize from (or null for create mode)
 * @returns Initial form data
 */
export function initializeEventFormData(event: Event | null): EventFormData {
  if (event) {
    return {
      description: event.description || '',
      actor: event.actor || '',
      target: event.target || '',
      timestamp: event.timestamp || '',
      event_type: '', // Not in Event type
      confidence: 1.0, // Not in Event type
      evidence: '' // Not in Event type
    }
  }
  return createEmptyEventFormData()
}

/**
 * Validates if a string is a valid ISO 8601 timestamp
 * @param timestamp - The timestamp string to validate
 * @returns true if valid ISO 8601 format
 */
export function isValidTimestamp(timestamp: string): boolean {
  if (!timestamp.trim()) return false
  return TIMESTAMP_REGEX.test(timestamp)
}

/**
 * Validates if confidence is within valid range
 * @param confidence - The confidence value
 * @returns true if within 0-1 range
 */
export function isValidConfidence(confidence: number): boolean {
  return confidence >= 0 && confidence <= 1
}

/**
 * Formats a datetime-local input value to ISO 8601 string
 * @param value - The datetime-local input value (YYYY-MM-DDTHH:MM or longer)
 * @returns ISO 8601 formatted string with seconds and Z suffix
 */
export function formatDatetimeLocalToISO(value: string): string {
  if (!value) return ''

  // datetime-local format is YYYY-MM-DDTHH:MM (16 chars)
  // If it already has seconds (19+ chars), don't add more
  if (value.length >= 19) {
    // Already has seconds, just ensure Z suffix
    return value.endsWith('Z') ? value : value + 'Z'
  }

  // Standard datetime-local format (16 chars): add seconds and Z
  return value + ':00Z'
}

/**
 * Formats an ISO string for datetime-local input
 * @param isoString - The ISO string
 * @returns datetime-local compatible string (without seconds)
 */
export function formatISOForDatetimeLocal(isoString: string): string {
  if (!isoString) return ''
  return isoString.slice(0, 16)
}

/**
 * Gets the modal title based on whether we're editing or creating
 * @param event - The event being edited (or null for create mode)
 * @returns The appropriate modal title
 */
export function getModalTitle(event: Event | null): string {
  return event ? 'Edit Event' : 'Create Event'
}
