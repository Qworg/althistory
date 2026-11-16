import { render, screen, fireEvent, act } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NotificationCenter } from './NotificationCenter'
import { useGlobalStore } from '@/stores/globalStore'

describe('NotificationCenter', () => {
  beforeEach(() => {
    useGlobalStore.setState({ errors: [], loadingOperations: new Set<string>() })
  })

  it('renders no alerts when the store is clean', () => {
    render(<NotificationCenter />)

    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('renders a store error as a visible message', () => {
    render(<NotificationCenter />)

    act(() => {
      useGlobalStore.getState().addError({ message: 'Failed to load events', type: 'network' })
    })

    expect(screen.getByRole('alert')).toBeInTheDocument()
    expect(screen.getByText('Failed to load events')).toBeInTheDocument()
    expect(screen.getByTestId('notification-network')).toBeInTheDocument()
  })

  it('dismisses a single error entry', () => {
    render(<NotificationCenter />)

    act(() => {
      useGlobalStore.getState().addError({ message: 'Invalid date range', type: 'validation' })
    })

    fireEvent.click(screen.getByRole('button', { name: /dismiss validation error/i }))

    expect(screen.queryByText('Invalid date range')).not.toBeInTheDocument()
    expect(useGlobalStore.getState().errors).toHaveLength(0)
  })

  it('clears every error at once', () => {
    render(<NotificationCenter />)

    act(() => {
      useGlobalStore.getState().addError({ message: 'First failure', type: 'network' })
      useGlobalStore.getState().addError({ message: 'Second failure', type: 'general' })
    })

    expect(screen.getAllByRole('alert')).toHaveLength(2)

    fireEvent.click(screen.getByRole('button', { name: /dismiss all/i }))

    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(useGlobalStore.getState().errors).toHaveLength(0)
  })

  it('surfaces in-flight loading operations', () => {
    render(<NotificationCenter />)

    act(() => {
      useGlobalStore.getState().addLoadingOperation('create-copy')
    })

    expect(screen.getByRole('status')).toBeInTheDocument()
    expect(screen.getByText(/create-copy/)).toBeInTheDocument()
  })

  describe('a rate-limit notice', () => {
    beforeEach(() => vi.useFakeTimers())
    afterEach(() => vi.useRealTimers())

    it('counts the wait down live, then says it can be tried again', () => {
      render(<NotificationCenter />)
      act(() => {
        useGlobalStore.getState().addError({
          type: 'general',
          message: 'Switching graphs was refused because too many requests were sent.',
          refusal: 'Switching graphs was refused because too many requests were sent.',
          retryAt: Date.now() + 5000,
        })
      })
      expect(screen.getByText('Try again in 5 seconds.')).toBeInTheDocument()
      act(() => {
        vi.advanceTimersByTime(3000)
      })
      expect(screen.getByText('Try again in 2 seconds.')).toBeInTheDocument()
      act(() => {
        vi.advanceTimersByTime(3000)
      })
      expect(screen.getByText('You can try again now.')).toBeInTheDocument()
    })

    it('follows a repeat refusal that moves retryAt', () => {
      render(<NotificationCenter />)
      act(() => {
        useGlobalStore.getState().addError({ type: 'general', message: 'X was refused.', refusal: 'X was refused.', retryAt: Date.now() + 2000 })
      })
      const id = useGlobalStore.getState().errors[0]!.id
      act(() => {
        useGlobalStore.getState().updateError(id, { retryAt: Date.now() + 58000 })
      })
      expect(screen.getByText('Try again in 58 seconds.')).toBeInTheDocument()
    })
  })
})
