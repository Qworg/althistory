import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { KeyListItem } from './KeyListItem'
import type { ApiKey } from '@/types'

const rateLimit = {
  requestsPerMinute: 60,
  requestsPerHour: 1000,
  requestsPerDay: 10000,
  batchSizeLimit: 100,
  concurrentStreams: 5,
}

function makeKey(overrides: Partial<ApiKey> = {}): ApiKey {
  return {
    id: 'key-1',
    name: 'Production Key',
    keyPrefix: 'alth_abc123',
    permissions: ['read:events', 'write:events'],
    rateLimit,
    allowedGraphs: '*',
    createdAt: '2024-01-01T00:00:00.000Z',
    isActive: true,
    ...overrides,
  }
}

function renderItem(props: Partial<React.ComponentProps<typeof KeyListItem>> = {}) {
  const onRevoke = vi.fn()
  const onDelete = vi.fn()
  const utils = render(
    <KeyListItem
      apiKey={makeKey()}
      onRevoke={onRevoke}
      onDelete={onDelete}
      isRevoking={false}
      isDeleting={false}
      {...props}
    />
  )
  return { ...utils, onRevoke, onDelete }
}

describe('KeyListItem', () => {
  it('shows the name, the prefix and the active status', () => {
    renderItem()

    expect(screen.getByText('Production Key')).toBeInTheDocument()
    expect(screen.getByText('alth_abc123...')).toBeInTheDocument()
    expect(screen.getByText('Active')).toBeInTheDocument()
  })

  it('labels an inactive key as revoked and hides the revoke action', () => {
    renderItem({ apiKey: makeKey({ isActive: false }) })

    expect(screen.getByText('Revoked')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Revoke' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument()
  })

  it('labels an expired key as expired and hides the revoke action', () => {
    renderItem({ apiKey: makeKey({ expiresAt: '2000-01-01T00:00:00.000Z' }) })

    expect(screen.getByText('Expired')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Revoke' })).not.toBeInTheDocument()
  })

  it('asks to revoke the key', async () => {
    const user = userEvent.setup()
    const { onRevoke } = renderItem()

    await user.click(screen.getByRole('button', { name: 'Revoke' }))

    expect(onRevoke).toHaveBeenCalledWith('key-1')
  })

  it('asks to delete the key', async () => {
    const user = userEvent.setup()
    const { onDelete } = renderItem()

    await user.click(screen.getByRole('button', { name: 'Delete' }))

    expect(onDelete).toHaveBeenCalledWith('key-1')
  })

  it('disables the actions while the mutations are in flight', () => {
    renderItem({ isRevoking: true, isDeleting: true })

    expect(screen.getByRole('button', { name: 'Revoke' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Delete' })).toBeDisabled()
  })

  it('shows the permission labels', () => {
    renderItem({ apiKey: makeKey({ permissions: ['read:events', 'admin'] }) })

    expect(screen.getByText('Read Events')).toBeInTheDocument()
    expect(screen.getByText('Admin')).toBeInTheDocument()
  })

  it('summarises the permissions beyond the fifth one', () => {
    renderItem({
      apiKey: makeKey({
        permissions: [
          'read:events',
          'write:events',
          'read:arcs',
          'write:arcs',
          'read:relationships',
          'write:relationships',
        ],
      }),
    })

    expect(screen.getByText('+1 more')).toBeInTheDocument()
  })

  it('shows the creation date and the last usage', () => {
    renderItem({
      apiKey: makeKey({ lastUsedAt: '2024-03-01T00:00:00.000Z' }),
    })

    expect(screen.getByText(/^Created:/)).toBeInTheDocument()
    expect(screen.getByText(/^Last used:/)).toBeInTheDocument()
  })
})
