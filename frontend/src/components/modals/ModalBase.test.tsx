/**
 * ModalBase / PanelBase keyboard behaviour when dialogs stack: only the
 * topmost dialog answers Escape and Tab (useStackedDialogKeys).
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { useState } from 'react'
import { ModalBase, PanelBase } from './ModalBase'

function Stack({ innerCloseOnEscape = true, onOuterClose = vi.fn(), onInnerClose = vi.fn() }) {
  const [innerOpen, setInnerOpen] = useState(true)
  return (
    <ModalBase isOpen onClose={onOuterClose} title="Outer">
      <button type="button">Outer action</button>
      <ModalBase
        isOpen={innerOpen}
        onClose={() => {
          onInnerClose()
          setInnerOpen(false)
        }}
        title="Inner"
        closeOnEscape={innerCloseOnEscape}
      >
        <button type="button">Inner first</button>
        <button type="button">Inner last</button>
      </ModalBase>
    </ModalBase>
  )
}

describe('ModalBase stacking', () => {
  it('closes only the topmost dialog on Escape, then the next one down', () => {
    const onOuterClose = vi.fn()
    const onInnerClose = vi.fn()
    render(<Stack onOuterClose={onOuterClose} onInnerClose={onInnerClose} />)

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onInnerClose).toHaveBeenCalledTimes(1)
    expect(onOuterClose).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog', { name: 'Inner' })).not.toBeInTheDocument()

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onOuterClose).toHaveBeenCalledTimes(1)
  })

  it('swallows Escape on a topmost dialog that cannot close, instead of closing the one beneath', () => {
    const onOuterClose = vi.fn()
    const onInnerClose = vi.fn()
    render(<Stack innerCloseOnEscape={false} onOuterClose={onOuterClose} onInnerClose={onInnerClose} />)

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onInnerClose).not.toHaveBeenCalled()
    expect(onOuterClose).not.toHaveBeenCalled()
  })

  it('keeps Escape away from document-level listeners (e.g. "clear selection")', () => {
    const documentListener = vi.fn()
    document.addEventListener('keydown', documentListener)
    render(<ModalBase isOpen onClose={vi.fn()} title="Only"><button type="button">x</button></ModalBase>)

    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(documentListener).not.toHaveBeenCalled()
    document.removeEventListener('keydown', documentListener)
  })

  it('lets an open popup inside the dialog take Escape first', () => {
    const onClose = vi.fn()
    render(
      <ModalBase isOpen onClose={onClose} title="With menu">
        <button type="button" aria-haspopup="menu" aria-expanded="true">Options</button>
      </ModalBase>
    )

    fireEvent.keyDown(screen.getByRole('button', { name: 'Options' }), { key: 'Escape' })
    expect(onClose).not.toHaveBeenCalled()
  })

  it('still closes from a plain expanded disclosure (no popup)', () => {
    const onClose = vi.fn()
    render(
      <ModalBase isOpen onClose={onClose} title="With disclosure">
        <button type="button" aria-expanded="true">More layouts</button>
      </ModalBase>
    )

    fireEvent.keyDown(screen.getByRole('button', { name: 'More layouts' }), { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('wraps Tab inside the topmost dialog only', () => {
    render(<Stack />)
    const innerLast = screen.getByRole('button', { name: 'Inner last' })
    innerLast.focus()

    fireEvent.keyDown(innerLast, { key: 'Tab' })

    // The inner dialog's first focusable is its close button (in the header)
    const inner = screen.getByRole('dialog', { name: 'Inner' })
    expect(inner.contains(document.activeElement)).toBe(true)
    expect(document.activeElement).not.toBe(innerLast)
  })
})

describe('PanelBase stacking', () => {
  it('a dialog opened over a panel takes Escape first', () => {
    const onPanelClose = vi.fn()
    const onDialogClose = vi.fn()
    render(
      <>
        <PanelBase isOpen onClose={onPanelClose} title="Versions">
          <button type="button">Rollback</button>
        </PanelBase>
        <ModalBase isOpen onClose={onDialogClose} title="Confirm">
          <button type="button">OK</button>
        </ModalBase>
      </>
    )

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onDialogClose).toHaveBeenCalledTimes(1)
    expect(onPanelClose).not.toHaveBeenCalled()
  })
})

describe('ModalBase layout', () => {
  const contentOf = (name: string) => {
    const dialog = screen.getByRole('dialog', { name })
    // The content box: the dialog's second child (after the backdrop).
    return dialog.children[1] as HTMLElement
  }

  it('is a full-screen sheet below lg: full height, no side margins, only the body scrolls', () => {
    render(
      <ModalBase isOpen onClose={vi.fn()} title="Sheet" footer={<button type="button">Save</button>}>
        <p>Body</p>
      </ModalBase>
    )

    const content = contentOf('Sheet')
    expect(content).toHaveClass('w-full', 'h-dvh', 'flex', 'flex-col')
    // Margins, rounding and the border only from lg up.
    expect(content.className).not.toMatch(/(^|\s)mx-4(\s|$)/)
    expect(content).toHaveClass('lg:mx-4', 'lg:rounded-lg', 'lg:h-auto')

    const [header, body, footer] = Array.from(content.children) as HTMLElement[]
    expect(header).toHaveClass('shrink-0')
    expect(body).toHaveClass('flex-1', 'min-h-0', 'overflow-y-auto')
    expect(footer).toHaveClass('shrink-0')
    expect(footer).toHaveTextContent('Save')
  })

  it('gives the close button a 44px target on a phone', () => {
    render(<ModalBase isOpen onClose={vi.fn()} title="Sheet"><p>Body</p></ModalBase>)

    expect(screen.getByRole('button', { name: 'Close modal' })).toHaveClass('h-11', 'w-11')
  })

  it('applies the side margin once for the full size (it was doubled)', () => {
    render(<ModalBase isOpen onClose={vi.fn()} title="Wide" size="full"><p>Body</p></ModalBase>)

    const classes = contentOf('Wide').className.split(/\s+/)
    expect(classes.filter((c) => c.endsWith('mx-4'))).toEqual(['lg:mx-4'])
    expect(classes).toContain('lg:max-w-[calc(100%-2rem)]')
  })

  it('caps the width from lg up only', () => {
    render(<ModalBase isOpen onClose={vi.fn()} title="Narrow" size="sm"><p>Body</p></ModalBase>)

    const content = contentOf('Narrow')
    expect(content).toHaveClass('lg:max-w-sm')
    expect(content).not.toHaveClass('max-w-sm')
  })
})

describe('PanelBase layout', () => {
  it('is never wider than the viewport', () => {
    render(<PanelBase isOpen onClose={vi.fn()} title="Side" width="28rem"><p>Body</p></PanelBase>)

    expect(screen.getByRole('dialog', { name: 'Side' })).toHaveClass('max-w-full')
  })
})
