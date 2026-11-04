import { createContext, useContext, useLayoutEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

/** The container of the portal this one is rendered inside, if any. */
const PortalHost = createContext<HTMLElement | null>(null)

/**
 * Render an overlay (a dialog, a sheet, a drawer) at the end of <body>.
 *
 * Dialogs rendered in place sat inside the sticky header and the toolbar.
 * `position: fixed` only escapes an ancestor while none of them has a
 * transform, filter or `contain`; the day one does, the dialog is clipped to
 * it and stacks under its siblings. Rendered here, it always covers the page.
 *
 * A portal opened inside another (a confirmation over a dialog) attaches to
 * that portal's container rather than to <body>, so nested dialogs stay DOM
 * descendants of the dialog they open from. useStackedDialogKeys relies on
 * that: the last open dialog in document order is the one on top. React
 * events still bubble through the component tree, so handlers and context
 * work as before.
 */
export function Portal({ children }: { children: ReactNode }) {
  const parent = useContext(PortalHost)
  const [container] = useState(() => (typeof document === 'undefined' ? null : document.createElement('div')))

  useLayoutEffect(() => {
    if (!container) return
    const host = parent ?? document.body
    host.appendChild(container)
    return () => {
      container.remove()
    }
  }, [container, parent])

  if (!container) return <>{children}</>
  return createPortal(<PortalHost.Provider value={container}>{children}</PortalHost.Provider>, container)
}
