import { describe, it, expect, beforeEach, vi } from 'vitest'
import { screen, fireEvent, within, act } from '@testing-library/react'
import { axe } from 'vitest-axe'
import { renderWithProviders } from '../../test/utils'
import { MainLayout } from '@/components/layout/MainLayout'
import { HelpDialog } from './HelpDialog'
import { useHelpShortcut, isTypingTarget } from './useHelpShortcut'
import { useHelpStore } from './helpStore'
import { SHORTCUTS, SHORTCUT_SCOPES, LAYOUT_LABELS, formatCombo } from './shortcuts'
import { GLOSSARY, filterGlossary } from './glossary'
import { LAYOUT_SHORTCUTS, ACTION_SHORTCUTS } from '@/utils/layoutManagerUtils'
import { VIEW_SHORTCUT_CONFIGS } from '@/hooks/useViewShortcuts'

/** The dialog plus the `?` listener, without the rest of the layout. */
function HelpHarness() {
  useHelpShortcut()
  return (
    <>
      <input aria-label="Some field" />
      <textarea aria-label="Some notes" />
      <div contentEditable suppressContentEditableWarning data-testid="editable">
        <span data-testid="editable-child">text</span>
      </div>
      <HelpDialog />
    </>
  )
}

const pressQuestionMark = (target: Element | Document = document.body) =>
  fireEvent.keyDown(target, { key: '?', shiftKey: true })

const getHelpDialog = () => screen.getByRole('dialog', { name: 'Help & reference' })
const queryHelpDialog = () => screen.queryByRole('dialog', { name: 'Help & reference' })

describe('Help & reference', () => {
  beforeEach(() => {
    useHelpStore.setState({ isOpen: false, tab: 'shortcuts' })
  })

  describe('opening', () => {
    it('opens on ? pressed outside a text field', () => {
      renderWithProviders(<HelpHarness />)
      expect(queryHelpDialog()).not.toBeInTheDocument()

      pressQuestionMark()

      expect(getHelpDialog()).toBeInTheDocument()
      expect(screen.getByRole('tab', { name: 'Keyboard shortcuts' })).toHaveAttribute('aria-selected', 'true')
    })

    it('does not open when ? is typed into an input, textarea or contenteditable', () => {
      renderWithProviders(<HelpHarness />)

      pressQuestionMark(screen.getByRole('textbox', { name: 'Some field' }))
      pressQuestionMark(screen.getByRole('textbox', { name: 'Some notes' }))
      pressQuestionMark(screen.getByTestId('editable'))
      pressQuestionMark(screen.getByTestId('editable-child'))

      expect(queryHelpDialog()).not.toBeInTheDocument()
    })

    it('ignores ? with Ctrl, Alt or Meta held', () => {
      renderWithProviders(<HelpHarness />)

      fireEvent.keyDown(document.body, { key: '?', ctrlKey: true })
      fireEvent.keyDown(document.body, { key: '?', altKey: true })
      fireEvent.keyDown(document.body, { key: '?', metaKey: true })

      expect(queryHelpDialog()).not.toBeInTheDocument()
    })

    it('does not open over another modal dialog', () => {
      renderWithProviders(
        <>
          <HelpHarness />
          <div role="dialog" aria-modal="true" aria-label="Other dialog" />
        </>
      )

      pressQuestionMark()

      expect(queryHelpDialog()).not.toBeInTheDocument()
    })

    it('is mounted by MainLayout: ? and the header button both open it', () => {
      renderWithProviders(
        <MainLayout>
          <div>content</div>
        </MainLayout>
      )
      expect(queryHelpDialog()).not.toBeInTheDocument()

      pressQuestionMark()
      expect(getHelpDialog()).toBeInTheDocument()

      fireEvent.click(within(getHelpDialog()).getByRole('button', { name: 'Close modal' }))
      expect(queryHelpDialog()).not.toBeInTheDocument()

      fireEvent.click(screen.getByRole('button', { name: /^Help: keyboard shortcuts/ }))
      expect(getHelpDialog()).toBeInTheDocument()
      // Mounted once, not once per entry point.
      expect(screen.getAllByRole('dialog', { name: 'Help & reference' })).toHaveLength(1)
    })
  })

  describe('closing and key containment', () => {
    it('closes on Escape', () => {
      renderWithProviders(<HelpHarness />)
      pressQuestionMark()

      fireEvent.keyDown(screen.getByRole('tab', { name: 'Keyboard shortcuts' }), { key: 'Escape' })

      expect(queryHelpDialog()).not.toBeInTheDocument()
    })

    it('keeps keys pressed inside the dialog from reaching document-level shortcuts', () => {
      const documentListener = vi.fn()
      document.addEventListener('keydown', documentListener)
      try {
        renderWithProviders(<HelpHarness />)
        act(() => useHelpStore.getState().openHelp())

        fireEvent.keyDown(screen.getByRole('tab', { name: 'Keyboard shortcuts' }), { key: 'f' })
        fireEvent.keyDown(screen.getByRole('tab', { name: 'Keyboard shortcuts' }), { key: 'Escape' })

        expect(documentListener).not.toHaveBeenCalled()
      } finally {
        document.removeEventListener('keydown', documentListener)
      }
    })
  })

  describe('tabs', () => {
    it('switches tabs with the arrow keys, Home and End, and moves focus', () => {
      renderWithProviders(<HelpHarness />)
      act(() => useHelpStore.getState().openHelp())

      const shortcutsTab = screen.getByRole('tab', { name: 'Keyboard shortcuts' })
      const glossaryTab = screen.getByRole('tab', { name: 'Glossary' })
      expect(screen.getByRole('tablist', { name: 'Help sections' })).toBeInTheDocument()
      expect(shortcutsTab).toHaveAttribute('tabindex', '0')
      expect(glossaryTab).toHaveAttribute('tabindex', '-1')

      shortcutsTab.focus()
      fireEvent.keyDown(shortcutsTab, { key: 'ArrowRight' })
      expect(glossaryTab).toHaveAttribute('aria-selected', 'true')
      expect(glossaryTab).toHaveFocus()
      expect(screen.getByRole('tabpanel', { name: 'Glossary' })).toBeVisible()
      expect(screen.queryByRole('tabpanel', { name: 'Keyboard shortcuts' })).not.toBeInTheDocument()

      // Wraps around.
      fireEvent.keyDown(glossaryTab, { key: 'ArrowRight' })
      expect(shortcutsTab).toHaveAttribute('aria-selected', 'true')
      expect(shortcutsTab).toHaveFocus()

      fireEvent.keyDown(shortcutsTab, { key: 'ArrowLeft' })
      expect(glossaryTab).toHaveAttribute('aria-selected', 'true')

      fireEvent.keyDown(glossaryTab, { key: 'Home' })
      expect(shortcutsTab).toHaveAttribute('aria-selected', 'true')

      fireEvent.keyDown(shortcutsTab, { key: 'End' })
      expect(glossaryTab).toHaveAttribute('aria-selected', 'true')
    })

    it('lists shortcuts grouped by scope, with keys as <kbd>', () => {
      renderWithProviders(<HelpHarness />)
      act(() => useHelpStore.getState().openHelp())

      const panel = screen.getByRole('tabpanel', { name: 'Keyboard shortcuts' })
      for (const scope of SHORTCUT_SCOPES) {
        expect(within(panel).getByRole('heading', { name: scope.title })).toBeInTheDocument()
      }
      const anywhere = within(panel).getByRole('region', { name: 'Anywhere' })
      const helpRow = within(anywhere).getByText('Open this help and reference').closest('li')
      expect(helpRow?.querySelector('kbd')?.textContent).toContain('?')
      expect(panel.querySelector('[data-combo="Alt+1"]')).not.toBeNull()
    })
  })

  describe('glossary', () => {
    it('filters terms as you type and says when nothing matches', () => {
      renderWithProviders(<HelpHarness />)
      act(() => useHelpStore.getState().openHelp('glossary'))

      const panel = screen.getByRole('tabpanel', { name: 'Glossary' })
      const terms = () => within(panel).queryAllByRole('term').map((el) => el.textContent)
      expect(terms()).toHaveLength(GLOSSARY.length)

      const filter = within(panel).getByRole('searchbox', { name: 'Filter terms' })
      fireEvent.change(filter, { target: { value: 'divergence' } })
      expect(terms()).toContain('Point of divergence')
      expect(terms()).not.toContain('Arc')
      expect(within(panel).getByRole('status')).toHaveTextContent(`of ${GLOSSARY.length} terms`)

      // Aliases match too.
      fireEvent.change(filter, { target: { value: 'pod' } })
      expect(terms()).toEqual(['Point of divergence'])

      fireEvent.change(filter, { target: { value: 'zzz-no-such-term' } })
      expect(terms()).toHaveLength(0)
      expect(within(panel).getByText(/No terms match/)).toBeInTheDocument()
    })

    it('covers the core domain vocabulary', () => {
      const terms = GLOSSARY.map((entry) => entry.term)
      for (const term of [
        'Graph', 'Event', 'Arc', 'Causal link', 'Direct link', 'Indirect link', 'Contributory link',
        'Weight', 'Confidence', 'Causal-order invariant', 'Inferred pressure', 'Point of divergence',
        'Branch', 'Version', 'Merge', 'Actor and target',
      ]) {
        expect(terms).toContain(term)
      }
      expect(filterGlossary('environmental').map((entry) => entry.id)).toContain('inferred-pressure')
    })
  })

  describe('accessibility', () => {
    it('has no axe violations on either tab', async () => {
      renderWithProviders(<HelpHarness />)
      act(() => useHelpStore.getState().openHelp())
      expect(await axe(getHelpDialog())).toHaveNoViolations()

      fireEvent.click(screen.getByRole('tab', { name: 'Glossary' }))
      expect(await axe(getHelpDialog())).toHaveNoViolations()
    })
  })
})

describe('shortcut registry', () => {
  it('has unique ids and only known scopes', () => {
    const ids = SHORTCUTS.map((s) => s.id)
    expect(new Set(ids).size).toBe(ids.length)
    const scopes = new Set(SHORTCUT_SCOPES.map((s) => s.id))
    for (const shortcut of SHORTCUTS) {
      expect(scopes.has(shortcut.scope)).toBe(true)
      expect(shortcut.combos.length).toBeGreaterThan(0)
    }
  })

  it('lists every view switch the layout handles: Shift+n, with Alt+n as an alternative', () => {
    for (const config of VIEW_SHORTCUT_CONFIGS) {
      const entry = SHORTCUTS.find((s) => s.id === `view-${config.mode}`)
      expect(entry?.combos.map(formatCombo)).toEqual([`Shift+${config.shortcut}`, `Alt+${config.shortcut}`])
    }
  })

  it('lists every causal-graph layout and action key, with a name for each layout', () => {
    for (const [key, layout] of Object.entries(LAYOUT_SHORTCUTS)) {
      expect(LAYOUT_LABELS[layout]).toBeDefined()
      const entry = SHORTCUTS.find((s) => s.id === `layout-${layout}`)
      expect(entry?.combos.map(formatCombo)).toEqual([key])
    }
    for (const key of Object.keys(ACTION_SHORTCUTS)) {
      expect(
        SHORTCUTS.some((s) => s.scope === 'causal' && s.combos.some((c) => formatCombo(c) === key.toUpperCase()))
      ).toBe(true)
    }
  })

  it('isTypingTarget recognises fields and editable regions only', () => {
    const input = document.createElement('input')
    const select = document.createElement('select')
    const button = document.createElement('button')
    expect(isTypingTarget(input)).toBe(true)
    expect(isTypingTarget(select)).toBe(true)
    expect(isTypingTarget(button)).toBe(false)
    expect(isTypingTarget(null)).toBe(false)
    expect(isTypingTarget(document)).toBe(false)
  })
})
