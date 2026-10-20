import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { renderHook, waitFor, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useApiKeyDashboard } from './useApiKeyDashboard'
import type { ApiKey, ApiKeyStats, CreateApiKeyRequest, CreateApiKeyResponse } from '@/types'

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

const sampleKey: ApiKey = {
  id: 'key-1',
  name: 'Production Key',
  keyPrefix: 'alth_abc123',
  permissions: ['read:events', 'write:events'],
  rateLimit,
  allowedGraphs: '*',
  createdAt: '2024-01-01T00:00:00.000Z',
  isActive: true,
}

const sampleStats: ApiKeyStats = {
  total: 2,
  active: 1,
  inactive: 1,
  expired: 0,
}

const createdKey: CreateApiKeyResponse = {
  id: 'key-2',
  key: 'alth_secret_value',
  keyPrefix: 'alth_secret',
  name: 'New Key',
  permissions: ['read:events'],
  rateLimit,
  createdAt: '2024-02-01T00:00:00.000Z',
}

const createRequest: CreateApiKeyRequest = {
  name: 'New Key',
  permissions: ['read:events'],
}

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  })

  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  }
}

describe('useApiKeyDashboard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetAll.mockResolvedValue({ keys: [sampleKey], total: 1 })
    mockGetStats.mockResolvedValue(sampleStats)
    mockCreate.mockResolvedValue(createdKey)
    mockRevoke.mockResolvedValue(undefined)
    mockDelete.mockResolvedValue(undefined)
  })

  it('exposes the loaded keys and the usage stats', async () => {
    const { result } = renderHook(() => useApiKeyDashboard(), { wrapper: createWrapper() })

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })

    expect(result.current.keys).toEqual([sampleKey])
    expect(result.current.stats).toEqual(sampleStats)
    expect(result.current.error).toBeNull()
  })

  it('reports an empty key list while the query is still loading', () => {
    mockGetAll.mockReturnValue(new Promise(() => {}))

    const { result } = renderHook(() => useApiKeyDashboard(), { wrapper: createWrapper() })

    expect(result.current.isLoading).toBe(true)
    expect(result.current.keys).toEqual([])
  })

  it('surfaces the error of a failed key query', async () => {
    mockGetAll.mockRejectedValue(new Error('boom'))

    const { result } = renderHook(() => useApiKeyDashboard(), { wrapper: createWrapper() })

    await waitFor(() => {
      expect(result.current.error).toBeInstanceOf(Error)
    })
    expect(result.current.error?.message).toBe('boom')
  })

  it('creates a key and refreshes the key list through invalidation', async () => {
    const { result } = renderHook(() => useApiKeyDashboard(), { wrapper: createWrapper() })

    await waitFor(() => {
      expect(result.current.keys).toHaveLength(1)
    })
    const callsBeforeCreate = mockGetAll.mock.calls.length

    let response: CreateApiKeyResponse | null = null
    await act(async () => {
      response = await result.current.createKey(createRequest)
    })

    expect(mockCreate).toHaveBeenCalledWith(createRequest)
    expect(response).toEqual(createdKey)
    await waitFor(() => {
      expect(mockGetAll.mock.calls.length).toBeGreaterThan(callsBeforeCreate)
    })
  })

  it('returns null and logs when the create request fails', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockCreate.mockRejectedValue(new Error('nope'))

    const { result } = renderHook(() => useApiKeyDashboard(), { wrapper: createWrapper() })

    let response: CreateApiKeyResponse | null = createdKey
    await act(async () => {
      response = await result.current.createKey(createRequest)
    })

    expect(response).toBeNull()
    expect(errorSpy).toHaveBeenCalledWith('Failed to create API key:', expect.any(Error))
    errorSpy.mockRestore()
  })

  it('revokes a key', async () => {
    const { result } = renderHook(() => useApiKeyDashboard(), { wrapper: createWrapper() })

    await act(async () => {
      await result.current.revokeKey('key-1')
    })

    expect(mockRevoke).toHaveBeenCalledWith('key-1')
  })

  it('deletes a key', async () => {
    const { result } = renderHook(() => useApiKeyDashboard(), { wrapper: createWrapper() })

    await act(async () => {
      await result.current.deleteKey('key-1')
    })

    expect(mockDelete).toHaveBeenCalledWith('key-1')
  })

  it('logs and swallows revoke and delete failures', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockRevoke.mockRejectedValue(new Error('revoke failed'))
    mockDelete.mockRejectedValue(new Error('delete failed'))

    const { result } = renderHook(() => useApiKeyDashboard(), { wrapper: createWrapper() })

    await act(async () => {
      await expect(result.current.revokeKey('key-1')).resolves.toBeUndefined()
    })
    await act(async () => {
      await expect(result.current.deleteKey('key-1')).resolves.toBeUndefined()
    })

    expect(errorSpy).toHaveBeenCalledWith('Failed to revoke API key:', expect.any(Error))
    expect(errorSpy).toHaveBeenCalledWith('Failed to delete API key:', expect.any(Error))
    errorSpy.mockRestore()
  })
})
