import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { ContextMenu } from './ContextMenu'

describe('the notification layering rule', () => {
  it('a context menu marks itself as an overlay so notices drop beneath it', () => {
    render(<ContextMenu isOpen position={{ x: 10, y: 10 }} items={[{ id: 'a', label: 'A', onClick: () => {} }]} onClose={() => {}} />)
    expect(document.querySelector('[role="menu"][data-overlay-open]')).not.toBeNull()
  })
})
