import React, { useId, useMemo, useRef, useState } from 'react'
import { ModalBase } from '@/components/modals/ModalBase'
import { useHelpStore, type HelpTab } from './helpStore'
import {
  SHORTCUT_SCOPES,
  formatCombo,
  keyDisplay,
  shortcutsForScope,
  type KeyCombo,
  type Shortcut,
} from './shortcuts'
import { GLOSSARY, filterGlossary } from './glossary'

const TABS: ReadonlyArray<{ id: HelpTab; label: string }> = [
  { id: 'shortcuts', label: 'Keyboard shortcuts' },
  { id: 'glossary', label: 'Glossary' },
]

function Keycap({ keyName }: { keyName: string }) {
  const { label, spoken } = keyDisplay(keyName)
  return (
    <kbd className="font-mono-code inline-flex min-w-[1.75rem] items-center justify-center rounded border border-line border-b-2 bg-subtle px-1.5 py-0.5 text-xs text-ink">
      {label === spoken ? (
        label
      ) : (
        <>
          <span aria-hidden="true">{label}</span>
          <span className="sr-only">{spoken}</span>
        </>
      )}
    </kbd>
  )
}

function Combo({ combo }: { combo: KeyCombo }) {
  return (
    <span className="inline-flex items-center gap-0.5" data-combo={formatCombo(combo)}>
      {combo.map((key, index) => (
        <React.Fragment key={`${key}-${index}`}>
          {index > 0 && (
            <span className="text-ink-muted text-xs" aria-hidden="true">
              +
            </span>
          )}
          <Keycap keyName={key} />
        </React.Fragment>
      ))}
    </span>
  )
}

function ShortcutRow({ shortcut }: { shortcut: Shortcut }) {
  return (
    <li className="flex items-start justify-between gap-4 py-1.5">
      <span className="min-w-0">
        <span className="text-sm text-ink">{shortcut.description}</span>
        {shortcut.note && <span className="block text-xs text-ink-muted">{shortcut.note}</span>}
      </span>
      <span className="flex shrink-0 flex-wrap items-center justify-end gap-1">
        {shortcut.combos.map((combo, index) => (
          <React.Fragment key={formatCombo(combo)}>
            {index > 0 && <span className="text-xs text-ink-muted">or</span>}
            <Combo combo={combo} />
          </React.Fragment>
        ))}
      </span>
    </li>
  )
}

function ShortcutsPanel() {
  const headingPrefix = useId()
  return (
    <div className="space-y-5">
      {SHORTCUT_SCOPES.map((scope) => {
        const shortcuts = shortcutsForScope(scope.id)
        if (shortcuts.length === 0) return null
        const headingId = `${headingPrefix}-${scope.id}`
        return (
          <section key={scope.id} aria-labelledby={headingId}>
            <h3 id={headingId} className="text-base font-semibold text-ink">
              {scope.title}
            </h3>
            <p className="text-xs text-ink-muted">{scope.description}</p>
            <ul className="mt-1 divide-y divide-line">
              {shortcuts.map((shortcut) => (
                <ShortcutRow key={shortcut.id} shortcut={shortcut} />
              ))}
            </ul>
          </section>
        )
      })}
    </div>
  )
}

function GlossaryPanel() {
  const [query, setQuery] = useState('')
  const inputId = useId()
  const entries = useMemo(() => filterGlossary(query), [query])

  return (
    <div>
      <label htmlFor={inputId} className="block text-sm font-medium text-ink-secondary">
        Filter terms
      </label>
      <input
        id={inputId}
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="e.g. branch, weight, paradox"
        autoComplete="off"
        className="mt-1 w-full rounded-md border border-line bg-card px-3 py-1.5 text-sm text-ink placeholder:text-ink-muted focus:outline-none focus:ring-2 focus:ring-selected"
      />
      <p className="mt-2 text-xs text-ink-muted" role="status" aria-live="polite">
        {entries.length === GLOSSARY.length
          ? `${GLOSSARY.length} terms`
          : `${entries.length} of ${GLOSSARY.length} terms`}
      </p>
      {entries.length > 0 ? (
        <dl className="mt-2 divide-y divide-line">
          {entries.map((entry) => (
            <div key={entry.id} className="py-2">
              <dt className="text-sm font-semibold text-ink">{entry.term}</dt>
              <dd className="mt-0.5 text-sm text-ink-secondary">{entry.definition}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="mt-4 text-sm text-ink-secondary">No terms match “{query.trim()}”.</p>
      )}
    </div>
  )
}

/**
 * The "Help & reference" dialog: every keyboard shortcut, grouped by where it
 * works, and the domain glossary. Mounted once in MainLayout; opened through
 * `useHelpStore` (header button, user menu, or `?`).
 */
export function HelpDialog() {
  const isOpen = useHelpStore((state) => state.isOpen)
  const tab = useHelpStore((state) => state.tab)
  const setTab = useHelpStore((state) => state.setTab)
  const closeHelp = useHelpStore((state) => state.closeHelp)

  const idPrefix = useId()
  const tabRefs = useRef<Partial<Record<HelpTab, HTMLButtonElement | null>>>({})
  const tabId = (id: HelpTab) => `${idPrefix}-tab-${id}`
  const panelId = (id: HelpTab) => `${idPrefix}-panel-${id}`

  const selectTab = (next: HelpTab) => {
    setTab(next)
    tabRefs.current[next]?.focus()
  }

  const handleTabKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    const index = TABS.findIndex((t) => t.id === tab)
    let nextIndex: number | null = null
    switch (event.key) {
      case 'ArrowRight':
        nextIndex = (index + 1) % TABS.length
        break
      case 'ArrowLeft':
        nextIndex = (index - 1 + TABS.length) % TABS.length
        break
      case 'Home':
        nextIndex = 0
        break
      case 'End':
        nextIndex = TABS.length - 1
        break
    }
    const next = nextIndex === null ? undefined : TABS[nextIndex]
    if (next) {
      event.preventDefault()
      selectTab(next.id)
    }
  }

  // Keys pressed inside the dialog stay inside it: without this, the app's
  // document-level shortcuts (F, 1-8, Shift+F, Escape-clears-selection, ...)
  // would act on the view underneath. Tab still reaches ModalBase's focus trap,
  // and Escape closes the dialog here because it no longer reaches ModalBase's
  // own document listener.
  const containKeys = (event: React.KeyboardEvent) => {
    if (event.key === 'Tab') return
    event.stopPropagation()
    if (event.key === 'Escape') {
      event.preventDefault()
      closeHelp()
    }
  }

  if (!isOpen) return null

  return (
    // Not an interactive element: it only stops key events bubbling out of the dialog.
    <div onKeyDown={containKeys}>
      <ModalBase isOpen onClose={closeHelp} title="Help & reference" size="2xl">
        <div
          role="tablist"
          aria-label="Help sections"
          className="-mt-1 mb-4 flex gap-1 border-b border-line"
        >
          {TABS.map((t) => {
            const selected = t.id === tab
            return (
              <button
                key={t.id}
                ref={(el) => {
                  tabRefs.current[t.id] = el
                }}
                type="button"
                role="tab"
                id={tabId(t.id)}
                aria-selected={selected}
                aria-controls={panelId(t.id)}
                tabIndex={selected ? 0 : -1}
                onClick={() => setTab(t.id)}
                onKeyDown={handleTabKeyDown}
                className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-selected ${
                  selected
                    ? 'border-selected text-ink'
                    : 'border-transparent text-ink-secondary hover:text-ink'
                }`}
              >
                {t.label}
              </button>
            )
          })}
        </div>

        {TABS.map((t) => (
          <div
            key={t.id}
            role="tabpanel"
            id={panelId(t.id)}
            aria-labelledby={tabId(t.id)}
            hidden={t.id !== tab}
            tabIndex={0}
            className="focus:outline-none focus-visible:ring-2 focus-visible:ring-selected rounded-sm"
          >
            {t.id === 'shortcuts' ? <ShortcutsPanel /> : <GlossaryPanel />}
          </div>
        ))}
      </ModalBase>
    </div>
  )
}

export default HelpDialog
