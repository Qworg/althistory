import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CreateKeyModal } from './CreateKeyModal'
import { PERMISSION_GROUPS } from './permissions'
import type { CreateApiKeyRequest } from '@/types'

function renderModal(props: Partial<React.ComponentProps<typeof CreateKeyModal>> = {}) {
  const onCreate = vi.fn()
  const utils = render(
    <CreateKeyModal isOpen onCreate={onCreate} isLoading={false} {...props} />
  )
  return { ...utils, onCreate }
}

describe('CreateKeyModal', () => {
  it('renders nothing while it is closed', () => {
    renderModal({ isOpen: false })

    expect(screen.queryByRole('button', { name: 'Create API Key' })).not.toBeInTheDocument()
    expect(screen.queryByPlaceholderText('e.g., Production API Key')).not.toBeInTheDocument()
  })

  it('renders the name, permission and expiration fields', () => {
    renderModal()

    expect(screen.getByPlaceholderText('e.g., Production API Key')).toBeInTheDocument()
    expect(screen.getByRole('combobox')).toBeInTheDocument()
    expect(screen.getByText('Leave empty for no expiration')).toBeInTheDocument()
  })

  it('keeps the submit button disabled until a name is entered', async () => {
    const user = userEvent.setup()
    renderModal()

    const submit = screen.getByRole('button', { name: 'Create API Key' })
    expect(submit).toBeDisabled()

    await user.type(screen.getByPlaceholderText('e.g., Production API Key'), 'Production API Key')

    expect(submit).toBeEnabled()
  })

  it('submits the read only preset by default', async () => {
    const user = userEvent.setup()
    const { onCreate } = renderModal()

    await user.type(screen.getByPlaceholderText('e.g., Production API Key'), 'Production API Key')
    await user.click(screen.getByRole('button', { name: 'Create API Key' }))

    const expected: CreateApiKeyRequest = {
      name: 'Production API Key',
      permissions: PERMISSION_GROUPS.readOnly,
      expiresAt: undefined,
    }
    expect(onCreate).toHaveBeenCalledWith(expected)
  })

  it('requires at least one permission for the custom preset', async () => {
    const user = userEvent.setup()
    renderModal()

    await user.type(screen.getByPlaceholderText('e.g., Production API Key'), 'Production API Key')
    await user.selectOptions(screen.getByRole('combobox'), 'custom')

    const submit = screen.getByRole('button', { name: 'Create API Key' })
    expect(submit).toBeDisabled()

    await user.click(screen.getByLabelText('Read Events'))

    expect(submit).toBeEnabled()
  })

  it('submits the permissions picked in the custom preset', async () => {
    const user = userEvent.setup()
    const { onCreate } = renderModal()

    await user.type(screen.getByPlaceholderText('e.g., Production API Key'), 'Production API Key')
    await user.selectOptions(screen.getByRole('combobox'), 'custom')
    await user.click(screen.getByLabelText('Read Events'))
    await user.click(screen.getByLabelText('Export'))
    await user.click(screen.getByRole('button', { name: 'Create API Key' }))

    expect(onCreate).toHaveBeenCalledWith({
      name: 'Production API Key',
      permissions: ['read:events', 'export'],
      expiresAt: undefined,
    })
  })

  it('submits the expiration date when one is given', async () => {
    const user = userEvent.setup()
    const { onCreate } = renderModal()

    await user.type(screen.getByPlaceholderText('e.g., Production API Key'), 'Production API Key')
    const expiration = document.querySelector('input[type="datetime-local"]')
    expect(expiration).not.toBeNull()
    await user.type(expiration as HTMLInputElement, '2030-01-01T00:00')
    await user.click(screen.getByRole('button', { name: 'Create API Key' }))

    expect(onCreate).toHaveBeenCalledWith({
      name: 'Production API Key',
      permissions: PERMISSION_GROUPS.readOnly,
      expiresAt: '2030-01-01T00:00',
    })
  })

  it('shows the pending state while the request is in flight', () => {
    renderModal({ isLoading: true })

    const submit = screen.getByRole('button', { name: 'Creating...' })
    expect(submit).toBeDisabled()
  })
})
