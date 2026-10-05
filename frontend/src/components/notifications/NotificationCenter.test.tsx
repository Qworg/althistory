import { render, screen, fireEvent, act } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
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
})
