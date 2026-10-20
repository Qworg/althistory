import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from '@/test/utils'
import { ApiKeyDashboard } from './ApiKeyDashboard'
import type { ApiKey } from '@/types'

const { mockGetAll, mockGetStats, mockCreate, mockRevoke, mockDelete } = vi.hoisted(() => ({
  mockGetAll: vi.fn(),
  mockGetStats: vi.fn(),
  mockCreate: vi.fn(),
  mockRevoke: vi.fn(),
  mockDelete: vi.fn(),
}))

vi.mock('@/services/api', () => ({
  apiClient: {
    keys: {
      getAll: mockGetAll,
      getStats: mockGetStats,
      create: mockCreate,
      revoke: mockRevoke,
      delete: mockDelete,
    },
  },
}))

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
    permissions: ['read:events'],
    rateLimit,
    allowedGraphs: '*',
    createdAt: '2024-01-01T00:00:00.000Z',
    isActive: true,
    ...overrides,
  }
}

describe('ApiKeyDashboard', () => {
  const onClose = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    mockGetAll.mockResolvedValue({ keys: [makeKey()], total: 1 })
    mockGetStats.mockResolvedValue({ total: 2, active: 1, inactive: 1, expired: 0 })
    mockCreate.mockResolvedValue({
      id: 'key-2',
      key: 'alth_secret_value',
      keyPrefix: 'alth_secret',
      name: 'New Key',
      permissions: ['read:events'],
      rateLimit,
      createdAt: '2024-02-01T00:00:00.000Z',
    })
    mockRevoke.mockResolvedValue(undefined)
    mockDelete.mockResolvedValue(undefined)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  function renderDashboard() {
    return renderWithProviders(<ApiKeyDashboard isOpen onClose={onClose} />)
  }

  it('shows the key list and the usage stats', async () => {
    renderDashboard()

    expect(screen.getByText('API Key Management')).toBeInTheDocument()
    expect(await screen.findByText('Production Key')).toBeInTheDocument()
    expect(screen.getByText('1 active / 2 total keys')).toBeInTheDocument()
  })

  it('shows the empty state when there is no key', async () => {
    mockGetAll.mockResolvedValue({ keys: [], total: 0 })

    renderDashboard()

    expect(await screen.findByText('No API keys yet')).toBeInTheDocument()
  })

  it('shows the error state when the keys cannot be loaded', async () => {
    mockGetAll.mockRejectedValue(new Error('boom'))

    renderDashboard()

    expect(await screen.findByText('Failed to load API keys')).toBeInTheDocument()
    expect(screen.getByText('boom')).toBeInTheDocument()
  })

  it('creates a key and shows the secret only once', async () => {
    const user = userEvent.setup()
    renderDashboard()

    await user.click(await screen.findByRole('button', { name: 'Create New Key' }))
    await user.type(screen.getByPlaceholderText('e.g., Production API Key'), 'New Key')
    await user.click(screen.getByRole('button', { name: 'Create API Key' }))

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'New Key' })
    )
    expect(await screen.findByText('API Key Created')).toBeInTheDocument()
    expect(
      screen.getByText("This is the only time you'll see the full API key. Copy it and store it securely.")
    ).toBeInTheDocument()
    expect(screen.getByDisplayValue('alth_secret_value')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Done' }))

    expect(screen.queryByDisplayValue('alth_secret_value')).not.toBeInTheDocument()
    expect(screen.getByText('API Key Management')).toBeInTheDocument()
  })

  it('copies the new key to the clipboard', async () => {
    const user = userEvent.setup()
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    })

    renderDashboard()

    await user.click(await screen.findByRole('button', { name: 'Create New Key' }))
    await user.type(screen.getByPlaceholderText('e.g., Production API Key'), 'New Key')
    await user.click(screen.getByRole('button', { name: 'Create API Key' }))

    await user.click(await screen.findByRole('button', { name: 'Copy' }))

    expect(writeText).toHaveBeenCalledWith('alth_secret_value')
    expect(await screen.findByRole('button', { name: 'Copied!' })).toBeInTheDocument()
  })

  it('revokes a key once the user confirmed', async () => {
    const user = userEvent.setup()
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)

    renderDashboard()

    await user.click(await screen.findByRole('button', { name: 'Revoke' }))

    expect(confirmSpy).toHaveBeenCalled()
    expect(mockRevoke).toHaveBeenCalledWith('key-1')
  })

  it('does not revoke a key when the user declines', async () => {
    const user = userEvent.setup()
    vi.spyOn(window, 'confirm').mockReturnValue(false)

    renderDashboard()

    await user.click(await screen.findByRole('button', { name: 'Revoke' }))

    expect(mockRevoke).not.toHaveBeenCalled()
  })

  it('deletes a key once the user confirmed', async () => {
    const user = userEvent.setup()
    vi.spyOn(window, 'confirm').mockReturnValue(true)

    renderDashboard()

    await user.click(await screen.findByRole('button', { name: 'Delete' }))

    expect(mockDelete).toHaveBeenCalledWith('key-1')
  })

  it('cancels the create view without creating a key', async () => {
    const user = userEvent.setup()
    renderDashboard()

    await user.click(await screen.findByRole('button', { name: 'Create New Key' }))
    expect(screen.getByRole('button', { name: 'Create API Key' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Create API Key' })).not.toBeInTheDocument()
    })
    expect(mockCreate).not.toHaveBeenCalled()
  })
})
