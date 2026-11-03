import { describe, it, expect, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from '../../test/utils'
import { UserProfileMenu } from './UserProfileMenu'
import { useHelpStore } from '@/components/help/helpStore'

// The dashboard itself is unit-tested separately; the api-key hooks are mocked
// so this test can assert the menu -> dashboard mount wiring without a network.
vi.mock('@/hooks/useApiKeys', () => ({
  useApiKeys: () => ({ data: { keys: [], total: 0 }, isLoading: false, error: null }),
  useApiKeyStats: () => ({ data: { active: 0, total: 0 } }),
  useCreateApiKey: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useRevokeApiKey: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteApiKey: () => ({ mutateAsync: vi.fn(), isPending: false }),
}))

describe('UserProfileMenu API key entry point', () => {
  it('opens the API key dashboard from the account menu (Req 20.1)', async () => {
    const user = userEvent.setup()
    renderWithProviders(<UserProfileMenu />)

    await user.click(screen.getByRole('button', { name: /user menu/i }))

    const apiKeysItem = await screen.findByRole('menuitem', { name: 'API Keys' })
    await user.click(apiKeysItem)

    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument()
    })
    expect(screen.getByText('API Key Management')).toBeInTheDocument()
  })
})

describe('UserProfileMenu help entry point', () => {
  it('opens the help and reference dialog and closes the menu', async () => {
    useHelpStore.setState({ isOpen: false, tab: 'shortcuts' })
    const user = userEvent.setup()
    renderWithProviders(<UserProfileMenu />)

    await user.click(screen.getByRole('button', { name: /user menu/i }))
    await user.click(await screen.findByRole('menuitem', { name: /Help & keyboard shortcuts/ }))

    expect(useHelpStore.getState().isOpen).toBe(true)
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })
})
