import { describe, it, expect } from 'vitest'
import {
  validateEventForm,
  isEventFormValid,
  createEmptyEventFormData,
  initializeEventFormData,
  isValidTimestamp,
  isValidConfidence,
  formatDatetimeLocalToISO,
  formatISOForDatetimeLocal,
  getModalTitle,
  EventFormData,
  EventValidationErrors
} from './eventDetailModalUtils'
import { Event } from '@/types'

describe('Event Detail Modal Utilities', () => {
  describe('validateEventForm', () => {
    const validFormData: EventFormData = {
      description: 'Test description',
      actor: 'Test actor',
      target: 'Test target',
      timestamp: '2023-01-15T12:00:00Z',
      event_type: 'political',
      confidence: 0.8,
      evidence: 'Test evidence'
    }

    it('returns empty errors for valid form', () => {
      const errors = validateEventForm(validFormData)
      expect(Object.keys(errors)).toHaveLength(0)
    })

    it('returns error for missing description', () => {
      const formData = { ...validFormData, description: '' }
      const errors = validateEventForm(formData)
      expect(errors.description).toBe('Description is required')
    })

    it('returns error for whitespace-only description', () => {
      const formData = { ...validFormData, description: '   ' }
      const errors = validateEventForm(formData)
      expect(errors.description).toBe('Description is required')
    })

    it('returns error for missing actor', () => {
      const formData = { ...validFormData, actor: '' }
      const errors = validateEventForm(formData)
      expect(errors.actor).toBe('Actor is required')
    })

    it('returns error for whitespace-only actor', () => {
      const formData = { ...validFormData, actor: '   ' }
      const errors = validateEventForm(formData)
      expect(errors.actor).toBe('Actor is required')
    })

    it('returns error for missing timestamp', () => {
      const formData = { ...validFormData, timestamp: '' }
      const errors = validateEventForm(formData)
      expect(errors.timestamp).toBe('Timestamp is required')
    })

    it('returns error for invalid timestamp format', () => {
      const formData = { ...validFormData, timestamp: 'invalid-timestamp' }
      const errors = validateEventForm(formData)
      expect(errors.timestamp).toBe('Invalid timestamp format (use ISO 8601)')
    })

    it('returns error for partial timestamp', () => {
      const formData = { ...validFormData, timestamp: '2023-01-15' }
      const errors = validateEventForm(formData)
      expect(errors.timestamp).toBe('Invalid timestamp format (use ISO 8601)')
    })

    it('accepts timestamp without Z suffix', () => {
      const formData = { ...validFormData, timestamp: '2023-01-15T12:00:00' }
      const errors = validateEventForm(formData)
      expect(errors.timestamp).toBeUndefined()
    })

    it('accepts timestamp with milliseconds', () => {
      const formData = { ...validFormData, timestamp: '2023-01-15T12:00:00.123Z' }
      const errors = validateEventForm(formData)
      expect(errors.timestamp).toBeUndefined()
    })

    it('returns error for confidence below 0', () => {
      const formData = { ...validFormData, confidence: -0.1 }
      const errors = validateEventForm(formData)
      expect(errors.confidence).toBe('Confidence must be between 0 and 1')
    })

    it('returns error for confidence above 1', () => {
      const formData = { ...validFormData, confidence: 1.1 }
      const errors = validateEventForm(formData)
      expect(errors.confidence).toBe('Confidence must be between 0 and 1')
    })

    it('accepts confidence at boundaries', () => {
      expect(validateEventForm({ ...validFormData, confidence: 0 }).confidence).toBeUndefined()
      expect(validateEventForm({ ...validFormData, confidence: 1 }).confidence).toBeUndefined()
    })

    it('returns multiple errors for multiple invalid fields', () => {
      const formData: EventFormData = {
        description: '',
        actor: '',
        target: '',
        timestamp: '',
        event_type: '',
        confidence: 2,
        evidence: ''
      }
      const errors = validateEventForm(formData)
      expect(errors.description).toBeDefined()
      expect(errors.actor).toBeDefined()
      expect(errors.timestamp).toBeDefined()
      expect(errors.confidence).toBeDefined()
    })
  })

  describe('isEventFormValid', () => {
    it('returns true for empty errors object', () => {
      expect(isEventFormValid({})).toBe(true)
    })

    it('returns false for errors object with any error', () => {
      expect(isEventFormValid({ description: 'error' })).toBe(false)
    })

    it('returns false for errors object with multiple errors', () => {
      const errors: EventValidationErrors = {
        description: 'error',
        actor: 'error',
        timestamp: 'error'
      }
      expect(isEventFormValid(errors)).toBe(false)
    })
  })

  describe('createEmptyEventFormData', () => {
    it('returns empty form data with defaults', () => {
      const formData = createEmptyEventFormData()
      expect(formData.description).toBe('')
      expect(formData.actor).toBe('')
      expect(formData.target).toBe('')
      expect(formData.timestamp).toBe('')
      expect(formData.event_type).toBe('')
      expect(formData.confidence).toBe(1.0)
      expect(formData.evidence).toBe('')
    })
  })

  describe('initializeEventFormData', () => {
    it('returns event data when event is provided', () => {
      const event: Event = {
        id: '1',
        description: 'Test description',
        actor: 'Test actor',
        target: 'Test target',
        timestamp: '2023-01-15T12:00:00Z',
        created_at: '2023-01-01T00:00:00Z',
        updated_at: '2023-01-01T00:00:00Z'
      }
      const formData = initializeEventFormData(event)
      expect(formData.description).toBe('Test description')
      expect(formData.actor).toBe('Test actor')
      expect(formData.target).toBe('Test target')
      expect(formData.timestamp).toBe('2023-01-15T12:00:00Z')
      // Fields not in Event type should have defaults
      expect(formData.event_type).toBe('')
      expect(formData.confidence).toBe(1.0)
      expect(formData.evidence).toBe('')
    })

    it('returns empty form data when event is null', () => {
      const formData = initializeEventFormData(null)
      expect(formData.description).toBe('')
      expect(formData.actor).toBe('')
      expect(formData.target).toBe('')
      expect(formData.timestamp).toBe('')
    })

    it('handles event with empty string fields', () => {
      const event: Event = {
        id: '1',
        description: '',
        actor: '',
        target: '',
        timestamp: '',
        created_at: '',
        updated_at: ''
      }
      const formData = initializeEventFormData(event)
      expect(formData.description).toBe('')
      expect(formData.actor).toBe('')
    })
  })

  describe('isValidTimestamp', () => {
    it('returns true for valid ISO 8601 timestamp with Z', () => {
      expect(isValidTimestamp('2023-01-15T12:00:00Z')).toBe(true)
    })

    it('returns true for valid ISO 8601 timestamp without Z', () => {
      expect(isValidTimestamp('2023-01-15T12:00:00')).toBe(true)
    })

    it('returns true for timestamp with milliseconds', () => {
      expect(isValidTimestamp('2023-01-15T12:00:00.123Z')).toBe(true)
    })

    it('returns false for empty string', () => {
      expect(isValidTimestamp('')).toBe(false)
    })

    it('returns false for whitespace-only string', () => {
      expect(isValidTimestamp('   ')).toBe(false)
    })

    it('returns false for date-only format', () => {
      expect(isValidTimestamp('2023-01-15')).toBe(false)
    })

    it('returns false for invalid format', () => {
      expect(isValidTimestamp('not-a-timestamp')).toBe(false)
    })
  })

  describe('isValidConfidence', () => {
    it('returns true for confidence of 0', () => {
      expect(isValidConfidence(0)).toBe(true)
    })

    it('returns true for confidence of 1', () => {
      expect(isValidConfidence(1)).toBe(true)
    })

    it('returns true for confidence of 0.5', () => {
      expect(isValidConfidence(0.5)).toBe(true)
    })

    it('returns false for negative confidence', () => {
      expect(isValidConfidence(-0.1)).toBe(false)
    })

    it('returns false for confidence above 1', () => {
      expect(isValidConfidence(1.1)).toBe(false)
    })
  })

  describe('formatDatetimeLocalToISO', () => {
    it('converts datetime-local value to ISO string', () => {
      expect(formatDatetimeLocalToISO('2023-01-15T12:30')).toBe('2023-01-15T12:30:00Z')
    })

    it('returns empty string for empty input', () => {
      expect(formatDatetimeLocalToISO('')).toBe('')
    })
  })

  describe('formatISOForDatetimeLocal', () => {
    it('converts ISO string to datetime-local format', () => {
      expect(formatISOForDatetimeLocal('2023-01-15T12:30:00Z')).toBe('2023-01-15T12:30')
    })

    it('returns empty string for empty input', () => {
      expect(formatISOForDatetimeLocal('')).toBe('')
    })

    it('truncates milliseconds', () => {
      expect(formatISOForDatetimeLocal('2023-01-15T12:30:00.123Z')).toBe('2023-01-15T12:30')
    })
  })

  describe('getModalTitle', () => {
    it('returns "Edit Event" when event is provided', () => {
      const event: Event = {
        id: '1',
        description: '',
        actor: '',
        target: '',
        timestamp: '',
        created_at: '',
        updated_at: ''
      }
      expect(getModalTitle(event)).toBe('Edit Event')
    })

    it('returns "Create Event" when event is null', () => {
      expect(getModalTitle(null)).toBe('Create Event')
    })
  })
})
