import { describe, it, expect } from 'vitest'
import {
  validateArcForm,
  isFormValid,
  getTabCounts,
  getDeleteConfirmationMessage,
  initializeFormData,
  datetimeLocalToISO,
  isoToDatetimeLocal,
  ArcFormData,
  ValidationErrors
} from './arcDetailPanelUtils'
import { Event, Arc } from '@/types'

describe('Arc Detail Panel Utilities', () => {
  describe('validateArcForm', () => {
    it('returns error for missing name', () => {
      const formData: ArcFormData = {
        description: 'test',
        start_time: '2023-01-01T00:00:00Z',
        end_time: '2023-01-02T00:00:00Z'
      }
      const errors = validateArcForm(formData)
      expect(errors.name).toBe('Name is required')
    })

    it('returns error for empty name', () => {
      const formData: ArcFormData = {
        name: '   ',
        description: 'test',
        start_time: '2023-01-01T00:00:00Z',
        end_time: '2023-01-02T00:00:00Z'
      }
      const errors = validateArcForm(formData)
      expect(errors.name).toBe('Name is required')
    })

    it('returns error for missing description', () => {
      const formData: ArcFormData = {
        name: 'test',
        start_time: '2023-01-01T00:00:00Z',
        end_time: '2023-01-02T00:00:00Z'
      }
      const errors = validateArcForm(formData)
      expect(errors.description).toBe('Description is required')
    })

    it('returns error for empty description', () => {
      const formData: ArcFormData = {
        name: 'test',
        description: '   ',
        start_time: '2023-01-01T00:00:00Z',
        end_time: '2023-01-02T00:00:00Z'
      }
      const errors = validateArcForm(formData)
      expect(errors.description).toBe('Description is required')
    })

    it('returns error for missing start time', () => {
      const formData: ArcFormData = {
        name: 'test',
        description: 'test',
        end_time: '2023-01-02T00:00:00Z'
      }
      const errors = validateArcForm(formData)
      expect(errors.start_time).toBe('Start time is required')
    })

    it('returns error for missing end time', () => {
      const formData: ArcFormData = {
        name: 'test',
        description: 'test',
        start_time: '2023-01-01T00:00:00Z'
      }
      const errors = validateArcForm(formData)
      expect(errors.end_time).toBe('End time is required')
    })

    it('returns error when end time is before start time', () => {
      const formData: ArcFormData = {
        name: 'test',
        description: 'test',
        start_time: '2023-01-02T00:00:00Z',
        end_time: '2023-01-01T00:00:00Z'
      }
      const errors = validateArcForm(formData)
      expect(errors.end_time).toBe('End time must be after start time')
    })

    it('returns error when end time equals start time', () => {
      const formData: ArcFormData = {
        name: 'test',
        description: 'test',
        start_time: '2023-01-01T12:00:00Z',
        end_time: '2023-01-01T12:00:00Z'
      }
      const errors = validateArcForm(formData)
      expect(errors.end_time).toBe('End time must be after start time')
    })

    it('warns about events outside new time range', () => {
      const containedEvents: Event[] = [
        {
          id: '1',
          timestamp: '2023-01-15T00:00:00Z',
          description: 'Test event',
          actor: 'Actor',
          target: 'Target',
          created_at: '2023-01-01T00:00:00Z',
          updated_at: '2023-01-01T00:00:00Z'
        }
      ]
      const formData: ArcFormData = {
        name: 'test',
        description: 'test',
        start_time: '2023-01-20T00:00:00Z',
        end_time: '2023-01-25T00:00:00Z'
      }
      const errors = validateArcForm(formData, containedEvents)
      expect(errors.time_range).toContain('1 contained events')
    })

    it('warns about multiple events outside time range', () => {
      const containedEvents: Event[] = [
        {
          id: '1',
          timestamp: '2023-01-10T00:00:00Z',
          description: 'Event 1',
          actor: 'Actor',
          target: 'Target',
          created_at: '2023-01-01T00:00:00Z',
          updated_at: '2023-01-01T00:00:00Z'
        },
        {
          id: '2',
          timestamp: '2023-01-30T00:00:00Z',
          description: 'Event 2',
          actor: 'Actor',
          target: 'Target',
          created_at: '2023-01-01T00:00:00Z',
          updated_at: '2023-01-01T00:00:00Z'
        }
      ]
      const formData: ArcFormData = {
        name: 'test',
        description: 'test',
        start_time: '2023-01-20T00:00:00Z',
        end_time: '2023-01-25T00:00:00Z'
      }
      const errors = validateArcForm(formData, containedEvents)
      expect(errors.time_range).toContain('2 contained events')
    })

    it('does not warn when all events are within time range', () => {
      const containedEvents: Event[] = [
        {
          id: '1',
          timestamp: '2023-01-15T00:00:00Z',
          description: 'Event 1',
          actor: 'Actor',
          target: 'Target',
          created_at: '2023-01-01T00:00:00Z',
          updated_at: '2023-01-01T00:00:00Z'
        }
      ]
      const formData: ArcFormData = {
        name: 'test',
        description: 'test',
        start_time: '2023-01-01T00:00:00Z',
        end_time: '2023-01-31T00:00:00Z'
      }
      const errors = validateArcForm(formData, containedEvents)
      expect(errors.time_range).toBeUndefined()
    })

    it('returns empty object for valid form', () => {
      const formData: ArcFormData = {
        name: 'test',
        description: 'test',
        start_time: '2023-01-01T00:00:00Z',
        end_time: '2023-01-02T00:00:00Z'
      }
      const errors = validateArcForm(formData)
      expect(Object.keys(errors)).toHaveLength(0)
    })

    it('returns multiple errors for multiple invalid fields', () => {
      const formData: ArcFormData = {}
      const errors = validateArcForm(formData)
      expect(errors.name).toBe('Name is required')
      expect(errors.description).toBe('Description is required')
      expect(errors.start_time).toBe('Start time is required')
      expect(errors.end_time).toBe('End time is required')
    })
  })

  describe('isFormValid', () => {
    it('returns true for empty errors object', () => {
      expect(isFormValid({})).toBe(true)
    })

    it('returns false for errors object with name error', () => {
      expect(isFormValid({ name: 'Name is required' })).toBe(false)
    })

    it('returns false for errors object with multiple errors', () => {
      const errors: ValidationErrors = {
        name: 'Name is required',
        description: 'Description is required'
      }
      expect(isFormValid(errors)).toBe(false)
    })
  })

  describe('getTabCounts', () => {
    it('returns correct counts with data', () => {
      const events: Event[] = [
        { id: '1', description: '', actor: '', target: '', timestamp: '', created_at: '', updated_at: '' },
        { id: '2', description: '', actor: '', target: '', timestamp: '', created_at: '', updated_at: '' }
      ]
      const arcs: Arc[] = [
        { id: '1', name: '', description: '', start_time: '', end_time: '', level: 0, parent_arc_id: null, created_at: '', updated_at: '' }
      ]
      const pressures = [{ id: '1' }, { id: '2' }, { id: '3' }]

      const counts = getTabCounts(events, arcs, pressures)
      expect(counts).toEqual({ events: 2, arcs: 1, pressures: 3 })
    })

    it('returns zeros for empty arrays', () => {
      const counts = getTabCounts([], [])
      expect(counts).toEqual({ events: 0, arcs: 0, pressures: 0 })
    })

    it('handles missing pressures parameter', () => {
      const events: Event[] = [
        { id: '1', description: '', actor: '', target: '', timestamp: '', created_at: '', updated_at: '' }
      ]
      const arcs: Arc[] = []
      const counts = getTabCounts(events, arcs)
      expect(counts).toEqual({ events: 1, arcs: 0, pressures: 0 })
    })
  })

  describe('getDeleteConfirmationMessage', () => {
    it('returns child arc warning message when child arcs exist', () => {
      const childArcs: Arc[] = [
        { id: '1', name: 'Child', description: '', start_time: '', end_time: '', level: 1, parent_arc_id: 'parent', created_at: '', updated_at: '' },
        { id: '2', name: 'Child 2', description: '', start_time: '', end_time: '', level: 1, parent_arc_id: 'parent', created_at: '', updated_at: '' }
      ]
      const message = getDeleteConfirmationMessage(childArcs)
      expect(message).toContain('2 child arcs')
      expect(message).toContain('delete all child arcs')
    })

    it('returns simple confirmation when no child arcs', () => {
      const message = getDeleteConfirmationMessage([])
      expect(message).toBe('Are you sure you want to delete this arc?')
    })
  })

  describe('initializeFormData', () => {
    it('returns arc data when arc is provided', () => {
      const arc: Arc = {
        id: '1',
        name: 'Test Arc',
        description: 'Test Description',
        start_time: '2023-01-01T00:00:00Z',
        end_time: '2023-01-31T00:00:00Z',
        level: 1,
        parent_arc_id: 'parent-1',
        created_at: '2023-01-01T00:00:00Z',
        updated_at: '2023-01-01T00:00:00Z'
      }
      const formData = initializeFormData(arc)
      expect(formData.name).toBe('Test Arc')
      expect(formData.description).toBe('Test Description')
      expect(formData.start_time).toBe('2023-01-01T00:00:00Z')
      expect(formData.end_time).toBe('2023-01-31T00:00:00Z')
      expect(formData.parent_arc_id).toBe('parent-1')
    })

    it('returns empty form data when arc is null', () => {
      const formData = initializeFormData(null)
      expect(formData.name).toBe('')
      expect(formData.description).toBe('')
      expect(formData.start_time).toBe('')
      expect(formData.end_time).toBe('')
      expect(formData.parent_arc_id).toBeNull()
    })
  })

  describe('datetimeLocalToISO', () => {
    it('converts datetime-local value to ISO string', () => {
      const result = datetimeLocalToISO('2023-01-15T12:30')
      expect(result).toMatch(/2023-01-15T\d{2}:30:00\.000Z/)
    })

    it('returns empty string for empty input', () => {
      expect(datetimeLocalToISO('')).toBe('')
    })
  })

  describe('isoToDatetimeLocal', () => {
    it('converts ISO string to datetime-local format', () => {
      const result = isoToDatetimeLocal('2023-01-15T12:30:00Z')
      expect(result).toBe('2023-01-15T12:30')
    })

    it('returns empty string for undefined input', () => {
      expect(isoToDatetimeLocal(undefined)).toBe('')
    })

    it('returns empty string for empty string input', () => {
      expect(isoToDatetimeLocal('')).toBe('')
    })
  })
})
