# Modal Component Integration Testing Plan

## Overview

**Category:** Integration Test Complexity  
**Affected Tests:** 30+ tests across 5 modal components  
**Priority:** LOW - Basic modal functionality works in practice  
**Estimated Effort:** 3-4 weeks  
**Risk Level:** Low - UI/UX improvements rather than functional fixes

## Problem Statement

Modal components involve complex user workflows that are difficult to test:
- Multi-step user interactions (tab navigation, form validation)
- Dynamic content rendering based on modal state
- Asynchronous operations (save, delete, API calls)
- Integration dependencies (global store, API service, router)

### Test Failure Patterns

```
Error: TestingLibraryElementError: Unable to find an element with the text: "Create Arc"
Error: TestingLibraryElementError: Unable to find a label with the text of: "Close panel"
```

**Affected Modal Components:**
| Component | Failed Tests | Primary Issues |
|-----------|-------------|----------------|
| ArcDetailPanel | 18 | Form rendering, tab system, validation |
| CopyHistoryPanel | 3 | Dynamic content, state management |
| EventDetailModal | 4 | Validation messages, delete confirmation |
| GraphCopyModal | 4 | Dynamic forms, dropdown content |
| PressureDetailModal | 1 | Conditional rendering |

---

## Phase 1: Component Architecture Analysis (Days 1-3)

### 1.1 Modal Component Patterns

**Current Pattern:**
```typescript
// Common modal structure
const Modal = ({ isOpen, onClose, onSave, ...props }) => {
  const [formData, setFormData] = useState({})
  const [errors, setErrors] = useState({})
  const [isLoading, setIsLoading] = useState(false)
  const [activeTab, setActiveTab] = useState('details')

  if (!isOpen) return null

  return (
    <div className="modal">
      {/* Tabs */}
      {/* Form Content (dynamic based on mode) */}
      {/* Footer Actions */}
    </div>
  )
}
```

**Issues:**
1. Conditional rendering makes elements unavailable for queries
2. State changes not reflected in DOM during tests
3. Form validation timing issues
4. Tab switching not updating content immediately

### 1.2 Test Query Analysis

**Current problematic queries:**
```typescript
// These fail because element doesn't exist when expected
screen.getByText('Create Arc')           // Mode-dependent text
screen.getByLabelText('Close panel')     // Missing aria-label
screen.getByText('Events (1)')           // Dynamic count
screen.getByText('Name is required')     // Validation message not rendered
```

**Root Causes:**
1. Elements not rendered until specific conditions are met
2. Missing or incorrect accessibility attributes
3. Async state updates not awaited properly
4. Test expectations don't match component behavior

---

## Phase 2: Testing Strategy Redesign (Days 4-8)

### 2.1 Separate Unit and Integration Tests

**Create Unit Tests for:**
- Form validation logic
- Data transformation utilities
- Tab content rendering
- State management logic

**Keep Integration Tests for:**
- Complete user workflows
- Critical path testing
- Accessibility compliance

### 2.2 Extract Testable Logic

**File: `frontend/src/components/modals/arcDetailPanelUtils.ts`**

```typescript
// Extract validation logic
export interface ArcFormData {
  name?: string
  description?: string
  start_time?: string
  end_time?: string
  parent_arc_id?: string | null
}

export interface ValidationErrors {
  name?: string
  description?: string
  start_time?: string
  end_time?: string
  time_range?: string
  general?: string
}

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

export function isFormValid(errors: ValidationErrors): boolean {
  return Object.keys(errors).length === 0
}

export function getTabCounts(
  containedEvents: Event[],
  childArcs: Arc[],
  inferredPressures: InferredPressure[]
): { events: number; arcs: number; pressures: number } {
  return {
    events: containedEvents.length,
    arcs: childArcs.length,
    pressures: inferredPressures.length
  }
}
```

**File: `frontend/src/components/modals/arcDetailPanelUtils.test.ts`**

```typescript
import { describe, it, expect } from 'vitest'
import { validateArcForm, isFormValid, getTabCounts } from './arcDetailPanelUtils'

describe('Arc Detail Panel Utilities', () => {
  describe('validateArcForm', () => {
    it('returns error for missing name', () => {
      const errors = validateArcForm({ description: 'test', start_time: '2023-01-01', end_time: '2023-01-02' })
      expect(errors.name).toBe('Name is required')
    })

    it('returns error for missing description', () => {
      const errors = validateArcForm({ name: 'test', start_time: '2023-01-01', end_time: '2023-01-02' })
      expect(errors.description).toBe('Description is required')
    })

    it('returns error when end time is before start time', () => {
      const errors = validateArcForm({
        name: 'test',
        description: 'test',
        start_time: '2023-01-02T00:00:00Z',
        end_time: '2023-01-01T00:00:00Z'
      })
      expect(errors.end_time).toBe('End time must be after start time')
    })

    it('warns about events outside new time range', () => {
      const containedEvents = [
        { id: '1', timestamp: '2023-01-15T00:00:00Z' }
      ]
      const errors = validateArcForm({
        name: 'test',
        description: 'test',
        start_time: '2023-01-20T00:00:00Z',
        end_time: '2023-01-25T00:00:00Z'
      }, containedEvents as Event[])
      expect(errors.time_range).toContain('1 contained events')
    })

    it('returns empty object for valid form', () => {
      const errors = validateArcForm({
        name: 'test',
        description: 'test',
        start_time: '2023-01-01T00:00:00Z',
        end_time: '2023-01-02T00:00:00Z'
      })
      expect(Object.keys(errors)).toHaveLength(0)
    })
  })

  describe('isFormValid', () => {
    it('returns true for empty errors object', () => {
      expect(isFormValid({})).toBe(true)
    })

    it('returns false for errors object with entries', () => {
      expect(isFormValid({ name: 'error' })).toBe(false)
    })
  })

  describe('getTabCounts', () => {
    it('returns correct counts', () => {
      const counts = getTabCounts(
        [{ id: '1' }, { id: '2' }] as Event[],
        [{ id: '1' }] as Arc[],
        [{ id: '1' }, { id: '2' }, { id: '3' }] as InferredPressure[]
      )
      expect(counts).toEqual({ events: 2, arcs: 1, pressures: 3 })
    })
  })
})
```

### 2.3 Create Test Fixtures

**File: `frontend/src/test/fixtures/modalFixtures.ts`**

```typescript
import { Arc, Event, InferredPressure, CausalRelationship } from '@/types'

export const createMockArc = (overrides: Partial<Arc> = {}): Arc => ({
  id: '1',
  name: 'Test Arc',
  description: 'Test Description',
  start_time: '2023-01-01T00:00:00Z',
  end_time: '2023-01-31T23:59:59Z',
  parent_arc_id: null,
  created_at: '2023-01-01T00:00:00Z',
  updated_at: '2023-01-01T00:00:00Z',
  ...overrides
})

export const createMockEvent = (overrides: Partial<Event> = {}): Event => ({
  id: '1',
  description: 'Test Event',
  actor: 'Test Actor',
  target: 'Test Target',
  timestamp: '2023-01-15T12:00:00Z',
  created_at: '2023-01-01T00:00:00Z',
  updated_at: '2023-01-01T00:00:00Z',
  ...overrides
})

export const createMockPressure = (overrides: Partial<InferredPressure> = {}): InferredPressure => ({
  id: '1',
  description: 'Test Pressure',
  confidence_score: 0.85,
  pressure_type: 'economic',
  created_at: '2023-01-01T00:00:00Z',
  updated_at: '2023-01-01T00:00:00Z',
  ...overrides
})

export const createMockCausalRelationship = (overrides: Partial<CausalRelationship> = {}): CausalRelationship => ({
  id: '1',
  cause_event_id: '1',
  effect_event_id: '2',
  weight: 0.8,
  evidence: 'Test evidence',
  confidence: 0.9,
  relationship_type: 'direct',
  created_at: '2023-01-01T00:00:00Z',
  updated_at: '2023-01-01T00:00:00Z',
  ...overrides
})

// Pre-built test scenarios
export const arcDetailPanelScenarios = {
  createMode: {
    arc: null,
    isOpen: true,
    containedEvents: [],
    childArcs: [],
    parentArc: null
  },
  editMode: {
    arc: createMockArc(),
    isOpen: true,
    containedEvents: [createMockEvent()],
    childArcs: [createMockArc({ id: '2', name: 'Child Arc', parent_arc_id: '1' })],
    parentArc: null
  },
  withParent: {
    arc: createMockArc({ parent_arc_id: 'parent-1' }),
    isOpen: true,
    containedEvents: [],
    childArcs: [],
    parentArc: createMockArc({ id: 'parent-1', name: 'Parent Arc' })
  }
}
```

---

## Phase 3: Component Accessibility Improvements (Days 9-12)

### 3.1 Add Missing ARIA Attributes

**ArcDetailPanel Updates:**

```typescript
// Add aria-label to close button
<button
  onClick={onClose}
  className="p-2 hover:bg-gray-100 rounded-md"
  aria-label="Close panel"  // Add this
  type="button"             // Add this
>

// Add role and aria-labelledby to panel
<div
  role="dialog"
  aria-modal="true"
  aria-labelledby="arc-panel-title"
  className={`fixed inset-y-0 right-0 w-96 ...`}
>
  <h2 id="arc-panel-title">Arc Details</h2>
```

### 3.2 Improve Form Labels

```typescript
// Ensure all inputs have proper labels
<label htmlFor="arc-name">
  Name <span className="text-red-500">*</span>
</label>
<input
  id="arc-name"
  name="name"
  type="text"
  aria-required="true"
  aria-invalid={!!errors.name}
  aria-describedby={errors.name ? 'arc-name-error' : undefined}
/>
{errors.name && (
  <span id="arc-name-error" role="alert" className="text-red-500">
    {errors.name}
  </span>
)}
```

### 3.3 Create Accessibility Test Helpers

**File: `frontend/src/test/helpers/a11yTestHelpers.ts`**

```typescript
import { screen } from '@testing-library/react'

export function getByLabelText(label: string) {
  return screen.getByLabelText(new RegExp(label, 'i'))
}

export function queryByLabelText(label: string) {
  return screen.queryByLabelText(new RegExp(label, 'i'))
}

export function getFormField(label: string) {
  const field = screen.getByLabelText(new RegExp(label, 'i'))
  return {
    element: field,
    setValue: (value: string) => fireEvent.change(field, { target: { value } }),
    getValue: () => (field as HTMLInputElement).value
  }
}

export function waitForValidationError(errorText: string) {
  return waitFor(() => {
    const error = screen.getByRole('alert')
    expect(error).toHaveTextContent(errorText)
  })
}

export function expectNoValidationErrors() {
  expect(screen.queryAllByRole('alert')).toHaveLength(0)
}
```

---

## Phase 4: Test File Refactoring (Days 13-18)

### 4.1 ArcDetailPanel.test.tsx Refactor

```typescript
// frontend/src/components/modals/ArcDetailPanel.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from '@/test/utils'
import { ArcDetailPanel } from './ArcDetailPanel'
import { 
  createMockArc, 
  createMockEvent, 
  createMockPressure,
  arcDetailPanelScenarios 
} from '@/test/fixtures/modalFixtures'
import { getFormField, waitForValidationError } from '@/test/helpers/a11yTestHelpers'

describe('ArcDetailPanel', () => {
  const defaultProps = {
    arc: null,
    isOpen: false,
    onClose: vi.fn(),
    onSave: vi.fn().mockResolvedValue(undefined),
    onDelete: vi.fn().mockResolvedValue(undefined),
    containedEvents: [],
    childArcs: [],
    parentArc: null
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    it('does not render when isOpen is false', () => {
      renderWithProviders(<ArcDetailPanel {...defaultProps} />)
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })

    it('renders panel when isOpen is true', () => {
      renderWithProviders(<ArcDetailPanel {...defaultProps} isOpen={true} />)
      expect(screen.getByRole('dialog')).toBeInTheDocument()
    })

    it('shows "Create Arc" title in create mode', () => {
      renderWithProviders(<ArcDetailPanel {...defaultProps} isOpen={true} />)
      expect(screen.getByRole('heading', { name: /create arc/i })).toBeInTheDocument()
    })

    it('shows "Arc Details" title in edit mode', () => {
      renderWithProviders(
        <ArcDetailPanel 
          {...defaultProps} 
          arc={createMockArc()} 
          isOpen={true} 
        />
      )
      expect(screen.getByRole('heading', { name: /arc details/i })).toBeInTheDocument()
    })
  })

  describe('Form Interaction', () => {
    it('populates form fields with arc data in edit mode', () => {
      const arc = createMockArc({ name: 'My Arc', description: 'My Description' })
      renderWithProviders(<ArcDetailPanel {...defaultProps} arc={arc} isOpen={true} />)
      
      expect(screen.getByDisplayValue('My Arc')).toBeInTheDocument()
      expect(screen.getByDisplayValue('My Description')).toBeInTheDocument()
    })

    it('updates form when input changes', async () => {
      const user = userEvent.setup()
      renderWithProviders(<ArcDetailPanel {...defaultProps} isOpen={true} />)
      
      const nameField = getFormField('Name')
      await user.type(nameField.element, 'New Arc Name')
      
      expect(nameField.getValue()).toBe('New Arc Name')
    })
  })

  describe('Validation', () => {
    it('shows validation errors when saving empty form', async () => {
      const user = userEvent.setup()
      renderWithProviders(<ArcDetailPanel {...defaultProps} isOpen={true} />)
      
      const saveButton = screen.getByRole('button', { name: /save/i })
      await user.click(saveButton)
      
      await waitForValidationError('Name is required')
      expect(defaultProps.onSave).not.toHaveBeenCalled()
    })

    it('validates end time is after start time', async () => {
      const user = userEvent.setup()
      renderWithProviders(<ArcDetailPanel {...defaultProps} isOpen={true} />)
      
      // Fill form with invalid date range
      await user.type(getFormField('Name').element, 'Test Arc')
      await user.type(getFormField('Description').element, 'Test Description')
      
      const startTime = screen.getByLabelText(/start time/i)
      const endTime = screen.getByLabelText(/end time/i)
      
      fireEvent.change(startTime, { target: { value: '2023-01-31T12:00' } })
      fireEvent.change(endTime, { target: { value: '2023-01-01T12:00' } })
      
      await user.click(screen.getByRole('button', { name: /save/i }))
      
      await waitForValidationError('End time must be after start time')
    })
  })

  describe('Actions', () => {
    it('calls onClose when close button is clicked', async () => {
      const user = userEvent.setup()
      renderWithProviders(<ArcDetailPanel {...defaultProps} isOpen={true} />)
      
      await user.click(screen.getByRole('button', { name: /close panel/i }))
      expect(defaultProps.onClose).toHaveBeenCalledOnce()
    })

    it('calls onSave with form data when valid', async () => {
      const user = userEvent.setup()
      const onSave = vi.fn().mockResolvedValue(undefined)
      renderWithProviders(
        <ArcDetailPanel {...defaultProps} onSave={onSave} isOpen={true} />
      )
      
      // Fill all required fields
      await user.type(getFormField('Name').element, 'New Arc')
      await user.type(getFormField('Description').element, 'New Description')
      fireEvent.change(screen.getByLabelText(/start time/i), { 
        target: { value: '2023-01-01T12:00' } 
      })
      fireEvent.change(screen.getByLabelText(/end time/i), { 
        target: { value: '2023-01-31T12:00' } 
      })
      
      await user.click(screen.getByRole('button', { name: /save/i }))
      
      await waitFor(() => {
        expect(onSave).toHaveBeenCalledWith(
          expect.objectContaining({
            name: 'New Arc',
            description: 'New Description'
          })
        )
      })
    })

    it('shows loading state during save', async () => {
      const user = userEvent.setup()
      const onSave = vi.fn(() => new Promise(resolve => setTimeout(resolve, 100)))
      const arc = createMockArc()
      
      renderWithProviders(
        <ArcDetailPanel {...defaultProps} arc={arc} onSave={onSave} isOpen={true} />
      )
      
      await user.click(screen.getByRole('button', { name: /save/i }))
      
      expect(screen.getByText(/saving/i)).toBeInTheDocument()
    })
  })

  describe('Tabs', () => {
    it('shows correct tab counts', () => {
      renderWithProviders(
        <ArcDetailPanel 
          {...defaultProps}
          containedEvents={[createMockEvent(), createMockEvent({ id: '2' })]}
          childArcs={[createMockArc({ id: '2' })]}
          isOpen={true} 
        />
      )
      
      expect(screen.getByRole('tab', { name: /events.*2/i })).toBeInTheDocument()
      expect(screen.getByRole('tab', { name: /arcs.*1/i })).toBeInTheDocument()
    })

    it('switches tab content when tab is clicked', async () => {
      const user = userEvent.setup()
      const events = [createMockEvent({ description: 'Test Event' })]
      
      renderWithProviders(
        <ArcDetailPanel 
          {...defaultProps}
          containedEvents={events}
          isOpen={true} 
        />
      )
      
      await user.click(screen.getByRole('tab', { name: /events/i }))
      
      expect(screen.getByText('Test Event')).toBeInTheDocument()
    })
  })

  describe('Accessibility', () => {
    it('has proper dialog attributes', () => {
      renderWithProviders(<ArcDetailPanel {...defaultProps} isOpen={true} />)
      
      const dialog = screen.getByRole('dialog')
      expect(dialog).toHaveAttribute('aria-modal', 'true')
    })

    it('has labeled form fields', () => {
      renderWithProviders(<ArcDetailPanel {...defaultProps} isOpen={true} />)
      
      expect(screen.getByLabelText(/name/i)).toBeInTheDocument()
      expect(screen.getByLabelText(/description/i)).toBeInTheDocument()
      expect(screen.getByLabelText(/start time/i)).toBeInTheDocument()
      expect(screen.getByLabelText(/end time/i)).toBeInTheDocument()
    })

    it('closes on Escape key', async () => {
      const user = userEvent.setup()
      renderWithProviders(<ArcDetailPanel {...defaultProps} isOpen={true} />)
      
      await user.keyboard('{Escape}')
      expect(defaultProps.onClose).toHaveBeenCalled()
    })
  })
})
```

### 4.2 EventDetailModal.test.tsx Updates

Apply similar patterns:
- Use `userEvent` for realistic interactions
- Query by roles with accessible names
- Use `waitFor` for async operations
- Create fixtures for test data

### 4.3 GraphCopyModal.test.tsx Updates

Focus on:
- Radio button interactions with userEvent
- Form mode switching
- Async copy operations

---

## Phase 5: Component Improvements (Days 19-22)

### 5.1 Add Proper Role Attributes

**Tab Component Pattern:**
```typescript
<div role="tablist">
  <button
    role="tab"
    aria-selected={activeTab === 'details'}
    aria-controls="tabpanel-details"
    id="tab-details"
  >
    Details
  </button>
</div>

<div
  role="tabpanel"
  id="tabpanel-details"
  aria-labelledby="tab-details"
  hidden={activeTab !== 'details'}
>
  {/* Content */}
</div>
```

### 5.2 Improve Loading States

```typescript
<button
  disabled={isLoading}
  aria-busy={isLoading}
  aria-disabled={isLoading}
>
  {isLoading ? (
    <>
      <span className="sr-only">Saving in progress</span>
      <Spinner aria-hidden="true" />
      Saving...
    </>
  ) : (
    'Save'
  )}
</button>
```

### 5.3 Standardize Modal Base

**File: `frontend/src/components/modals/ModalBase.tsx`**

```typescript
interface ModalBaseProps {
  isOpen: boolean
  onClose: () => void
  title: string
  children: React.ReactNode
  size?: 'sm' | 'md' | 'lg' | 'xl'
  closeOnEscape?: boolean
  closeOnBackdrop?: boolean
}

export const ModalBase: React.FC<ModalBaseProps> = ({
  isOpen,
  onClose,
  title,
  children,
  size = 'md',
  closeOnEscape = true,
  closeOnBackdrop = true
}) => {
  const titleId = useId()
  
  // Handle escape key
  useEffect(() => {
    if (!closeOnEscape) return
    
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    
    document.addEventListener('keydown', handleEscape)
    return () => document.removeEventListener('keydown', handleEscape)
  }, [closeOnEscape, onClose])

  // Prevent body scroll
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden'
    }
    return () => {
      document.body.style.overflow = ''
    }
  }, [isOpen])

  if (!isOpen) return null

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      className="fixed inset-0 z-50 flex items-center justify-center"
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black bg-opacity-50"
        onClick={closeOnBackdrop ? onClose : undefined}
        aria-hidden="true"
      />
      
      {/* Content */}
      <div className={`relative bg-white rounded-lg shadow-xl ${sizeClasses[size]}`}>
        <h2 id={titleId} className="text-lg font-semibold p-4 border-b">
          {title}
        </h2>
        <button
          onClick={onClose}
          aria-label="Close modal"
          className="absolute top-4 right-4 p-2 hover:bg-gray-100 rounded"
        >
          ✕
        </button>
        {children}
      </div>
    </div>
  )
}
```

---

## Files to Create/Modify

### New Files
1. `frontend/src/components/modals/arcDetailPanelUtils.ts`
2. `frontend/src/components/modals/arcDetailPanelUtils.test.ts`
3. `frontend/src/components/modals/eventDetailModalUtils.ts`
4. `frontend/src/components/modals/eventDetailModalUtils.test.ts`
5. `frontend/src/components/modals/ModalBase.tsx`
6. `frontend/src/test/fixtures/modalFixtures.ts`
7. `frontend/src/test/helpers/a11yTestHelpers.ts`

### Modified Files
1. `frontend/src/components/modals/ArcDetailPanel.tsx` - Add ARIA attributes
2. `frontend/src/components/modals/ArcDetailPanel.test.tsx` - Refactored tests
3. `frontend/src/components/modals/EventDetailModal.tsx` - Add ARIA attributes
4. `frontend/src/components/modals/EventDetailModal.test.tsx` - Refactored tests
5. `frontend/src/components/modals/GraphCopyModal.tsx` - Add ARIA attributes
6. `frontend/src/components/modals/GraphCopyModal.test.tsx` - Refactored tests
7. `frontend/src/components/modals/CopyHistoryPanel.tsx` - Add ARIA attributes
8. `frontend/src/components/modals/CopyHistoryPanel.test.tsx` - Refactored tests
9. `frontend/src/components/modals/PressureDetailModal.tsx` - Add ARIA attributes
10. `frontend/src/components/modals/PressureDetailModal.test.tsx` - Refactored tests

---

## Success Criteria

1. **All 30+ modal tests pass** - No TestingLibraryElementError failures
2. **Validation logic is unit tested** - 100% coverage on utility functions
3. **Accessibility compliance** - All modals pass aXe accessibility checks
4. **Consistent patterns** - All modals use shared base components
5. **Test maintainability** - Clear separation between unit and integration tests

---

## Testing Guidelines Summary

### Do:
- Use `userEvent` for realistic user interactions
- Query by accessible roles and names
- Use `waitFor` for async state updates
- Extract testable logic to utility functions
- Create fixtures for common test data
- Add proper ARIA attributes to components

### Don't:
- Query by CSS classes or test IDs
- Test implementation details
- Skip accessibility in tests
- Duplicate validation logic
- Mix unit and integration concerns

---

## Dependencies

- React Testing Library
- @testing-library/user-event
- Vitest
- axe-core (optional, for accessibility testing)
