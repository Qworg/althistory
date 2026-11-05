import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SkippedSentences } from './SkippedSentences'

describe('SkippedSentences', () => {
  it('shows what was left out and extracts again with the dates given', async () => {
    const user = userEvent.setup()
    const onReextract = vi.fn()
    const sentence = 'Parliament repealed the Engine Licensing Act.'
    render(
      <SkippedSentences count={1} sentences={[sentence]} hasEdits={false} canReextract isExtracting={false} onReextract={onReextract} />
    )
    expect(screen.getByText(sentence)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Extract again/ })).toBeDisabled()

    await user.type(screen.getByLabelText(`Date for: ${sentence}`), '1862')
    await user.click(screen.getByRole('button', { name: 'Extract again with 1 date' }))
    const rewrite = onReextract.mock.calls[0]![0] as (original: string) => string
    expect(rewrite(`The clerks struck in 1859. ${sentence}`)).toBe(`The clerks struck in 1859. In 1862, ${sentence}`)
  })
})
