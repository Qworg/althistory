import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ConflictResolutionRow } from './ConflictResolutionRow'
import { ImportConflict } from '@/types'

const errorConflict: ImportConflict = {
  id: 'conflict-1',
  type: 'duplicate-id',
  entityType: 'event',
  entityId: 'event-1',
  severity: 'error',
  message: 'Event with this ID already exists',
  existingEntity: { id: 'event-1', description: 'Existing event' },
  incomingEntity: { id: 'event-1', description: 'New event' },
  suggestedResolution: 'skip',
}

const warningConflict: ImportConflict = {
  id: 'conflict-2',
  type: 'temporal-violation',
  entityType: 'arc',
  entityId: 'arc-1',
  severity: 'warning',
  message: 'Arc dates may overlap',
  incomingEntity: { id: 'arc-1', name: 'Test Arc' },
  suggestedResolution: 'overwrite',
}

describe('ConflictResolutionRow', () => {
  const user = userEvent.setup()
  const mockOnResolve = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    it('should display error severity with correct styling', () => {
      render(
        <ConflictResolutionRow
          conflict={errorConflict}
          resolution={undefined}
          onResolve={mockOnResolve}
        />
      )

      const severityBadge = screen.getByText('error')
      expect(severityBadge).toHaveClass('bg-red-100')
      expect(severityBadge).toHaveClass('text-red-800')
    })

    it('should display warning severity with correct styling', () => {
      render(
        <ConflictResolutionRow
          conflict={warningConflict}
          resolution={undefined}
          onResolve={mockOnResolve}
        />
      )

      const severityBadge = screen.getByText('warning')
      expect(severityBadge).toHaveClass('bg-yellow-100')
      expect(severityBadge).toHaveClass('text-yellow-800')
    })

    it('should display entity type badge', () => {
      render(
        <ConflictResolutionRow
          conflict={errorConflict}
          resolution={undefined}
          onResolve={mockOnResolve}
        />
      )

      expect(screen.getByText('event')).toBeInTheDocument()
    })

    it('should display conflict type badge', () => {
      render(
        <ConflictResolutionRow
          conflict={errorConflict}
          resolution={undefined}
          onResolve={mockOnResolve}
        />
      )

      expect(screen.getByText('duplicate-id')).toBeInTheDocument()
    })

    it('should display entity ID', () => {
      render(
        <ConflictResolutionRow
          conflict={errorConflict}
          resolution={undefined}
          onResolve={mockOnResolve}
        />
      )

      expect(screen.getByText('event-1')).toBeInTheDocument()
    })

    it('should display conflict message', () => {
      render(
        <ConflictResolutionRow
          conflict={errorConflict}
          resolution={undefined}
          onResolve={mockOnResolve}
        />
      )

      expect(screen.getByText('Event with this ID already exists')).toBeInTheDocument()
    })

    it('should show entity comparison when existingEntity is present', () => {
      render(
        <ConflictResolutionRow
          conflict={errorConflict}
          resolution={undefined}
          onResolve={mockOnResolve}
        />
      )

      expect(screen.getByText('Existing')).toBeInTheDocument()
      expect(screen.getByText('Incoming')).toBeInTheDocument()
    })

    it('should not show entity comparison when existingEntity is absent', () => {
      render(
        <ConflictResolutionRow
          conflict={warningConflict}
          resolution={undefined}
          onResolve={mockOnResolve}
        />
      )

      expect(screen.queryByText('Existing')).not.toBeInTheDocument()
    })

    it('should show suggested resolution', () => {
      render(
        <ConflictResolutionRow
          conflict={errorConflict}
          resolution={undefined}
          onResolve={mockOnResolve}
        />
      )

      expect(screen.getByText('(suggested: skip)')).toBeInTheDocument()
    })
  })

  describe('Resolution Buttons', () => {
    it('should render all resolution buttons', () => {
      render(
        <ConflictResolutionRow
          conflict={errorConflict}
          resolution={undefined}
          onResolve={mockOnResolve}
        />
      )

      expect(screen.getByRole('button', { name: 'Skip' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Overwrite' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Rename' })).toBeInTheDocument()
    })

    it('should call onResolve with skip when Skip clicked', async () => {
      render(
        <ConflictResolutionRow
          conflict={errorConflict}
          resolution={undefined}
          onResolve={mockOnResolve}
        />
      )

      await user.click(screen.getByRole('button', { name: 'Skip' }))
      expect(mockOnResolve).toHaveBeenCalledWith('skip')
    })

    it('should call onResolve with overwrite when Overwrite clicked', async () => {
      render(
        <ConflictResolutionRow
          conflict={errorConflict}
          resolution={undefined}
          onResolve={mockOnResolve}
        />
      )

      await user.click(screen.getByRole('button', { name: 'Overwrite' }))
      expect(mockOnResolve).toHaveBeenCalledWith('overwrite')
    })

    it('should call onResolve with rename when Rename clicked', async () => {
      render(
        <ConflictResolutionRow
          conflict={errorConflict}
          resolution={undefined}
          onResolve={mockOnResolve}
        />
      )

      await user.click(screen.getByRole('button', { name: 'Rename' }))
      expect(mockOnResolve).toHaveBeenCalledWith('rename')
    })

    it('should highlight selected resolution button', () => {
      render(
        <ConflictResolutionRow
          conflict={errorConflict}
          resolution="skip"
          onResolve={mockOnResolve}
        />
      )

      const skipButton = screen.getByRole('button', { name: 'Skip' })
      expect(skipButton).toHaveClass('bg-blue-600')
      expect(skipButton).toHaveClass('text-white')
    })

    it('should not highlight unselected resolution buttons', () => {
      render(
        <ConflictResolutionRow
          conflict={errorConflict}
          resolution="skip"
          onResolve={mockOnResolve}
        />
      )

      const overwriteButton = screen.getByRole('button', { name: 'Overwrite' })
      expect(overwriteButton).toHaveClass('bg-gray-100')
    })
  })
})
