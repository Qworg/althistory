import { ReactElement } from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ErrorBoundary } from './ErrorBoundary'

let shouldThrow = true

function Boom(): ReactElement {
  if (shouldThrow) {
    throw new Error('kaboom')
  }
  return <div>Recovered content</div>
}

describe('ErrorBoundary', () => {
  const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

  beforeEach(() => {
    shouldThrow = true
    consoleError.mockClear()
  })

  afterEach(() => {
    shouldThrow = false
  })

  afterAll(() => {
    consoleError.mockRestore()
  })

  it('renders its children when nothing throws', () => {
    render(
      <ErrorBoundary>
        <div>All good</div>
      </ErrorBoundary>,
    )

    expect(screen.getByText('All good')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('catches a thrown render error and renders a fallback with a reload affordance', () => {
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    )

    expect(screen.getByRole('alert')).toBeInTheDocument()
    expect(screen.getByText('Something went wrong')).toBeInTheDocument()
    expect(screen.getByText('kaboom')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /reload page/i })).toBeInTheDocument()
  })

  it('invokes the reload affordance when the reload button is clicked', () => {
    const reload = vi.fn()

    render(
      <ErrorBoundary onReload={reload}>
        <Boom />
      </ErrorBoundary>,
    )

    fireEvent.click(screen.getByRole('button', { name: /reload page/i }))
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('can retry and recover once the child stops throwing', () => {
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    )

    expect(screen.getByText('Something went wrong')).toBeInTheDocument()

    shouldThrow = false
    fireEvent.click(screen.getByRole('button', { name: /try again/i }))

    expect(screen.getByText('Recovered content')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('uses a custom fallback when one is provided', () => {
    render(
      <ErrorBoundary fallback={<div>Custom failure</div>}>
        <Boom />
      </ErrorBoundary>,
    )

    expect(screen.getByText('Custom failure')).toBeInTheDocument()
    expect(screen.queryByText('Something went wrong')).not.toBeInTheDocument()
  })
})
