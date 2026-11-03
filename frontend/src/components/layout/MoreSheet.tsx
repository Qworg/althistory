import { useEffect, useId, useRef, type ReactNode } from 'react'
import { useStackedDialogKeys } from '@/components/modals/useStackedDialogKeys'

export interface MoreSheetItem {
  id: string
  label: string
  icon: ReactNode
  /** One line under the label: touch has no hover, so no tooltip either. */
  description?: string
  onClick: () => void
}

export interface MoreSheetGroup {
  label: string
  items: MoreSheetItem[]
}

interface MoreSheetProps {
  isOpen: boolean
  onClose: () => void
  groups: MoreSheetGroup[]
  /** Drawn after the groups (the streaming connection). */
  footer?: ReactNode
}

/**
 * The mobile overflow for the toolbar: a bottom sheet of the graph-management
 * actions that do not fit a phone's toolbar. It is a modal dialog (so app
 * shortcuts stand aside while it is open), Escape and the backdrop close it,
 * Tab stays inside it, and closing returns focus to whatever opened it.
 * Choosing an item closes the sheet, then runs the item.
 */
export function MoreSheet({ isOpen, onClose, groups, footer }: MoreSheetProps) {
  const titleId = useId()
  const panelRef = useRef<HTMLDivElement>(null)

  useStackedDialogKeys(panelRef, isOpen, onClose)

  useEffect(() => {
    if (!isOpen) return
    const opener = document.activeElement as HTMLElement | null
    panelRef.current?.querySelector<HTMLElement>('[data-more-item]')?.focus()
    return () => {
      if (opener && typeof opener.focus === 'function' && opener.isConnected) opener.focus()
    }
  }, [isOpen])

  if (!isOpen) return null

  return (
    <div role="dialog" aria-modal="true" aria-labelledby={titleId} className="fixed inset-0 z-50 lg:hidden">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} aria-hidden="true" />
      <div
        ref={panelRef}
        className="absolute inset-x-0 bottom-0 flex max-h-[85dvh] flex-col rounded-t-xl border-t border-line bg-card text-ink shadow-xl"
        style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
      >
        <div className="flex items-center justify-between border-b border-line px-4 py-1">
          <h2 id={titleId} className="font-display text-lg font-semibold text-ink">
            More
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="inline-flex h-11 w-11 items-center justify-center rounded-md text-ink-muted hover:bg-subtle hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-selected"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto overscroll-contain px-2 py-2">
          {groups.filter((group) => group.items.length > 0).map((group) => (
            <section key={group.label} aria-label={group.label} className="py-1">
              <h3 className="px-2 pb-1 pt-2 text-xs font-medium text-ink-muted">{group.label}</h3>
              <ul className="space-y-0.5">
                {group.items.map((item) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      data-more-item
                      onClick={() => {
                        onClose()
                        item.onClick()
                      }}
                      className="flex min-h-12 w-full items-center gap-3 rounded-md px-2 py-2 text-left text-ink-secondary hover:bg-subtle hover:text-ink focus:outline-none focus-visible:bg-subtle focus-visible:ring-2 focus-visible:ring-selected"
                    >
                      <span className="shrink-0 text-ink-muted" aria-hidden="true">{item.icon}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium text-ink">{item.label}</span>
                        {item.description && (
                          <span className="block text-xs text-ink-muted">{item.description}</span>
                        )}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
          {footer && <div className="border-t border-line px-2 pb-2 pt-3">{footer}</div>}
        </div>
      </div>
    </div>
  )
}
