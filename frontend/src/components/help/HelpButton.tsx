import { useHelpStore } from './helpStore'

/**
 * Header button that opens the "Help & reference" dialog (also `?`).
 * `touch` gives it the 44px target the phone layout needs.
 */
export function HelpButton({ touch = false }: { touch?: boolean }) {
  const openHelp = useHelpStore((state) => state.openHelp)
  const isOpen = useHelpStore((state) => state.isOpen)

  return (
    <button
      type="button"
      onClick={() => openHelp()}
      aria-label="Help and keyboard shortcuts"
      aria-haspopup="dialog"
      aria-expanded={isOpen}
      aria-keyshortcuts="Shift+?"
      title="Help and keyboard shortcuts (?)"
      className={`${touch ? 'inline-flex h-11 w-11 shrink-0 items-center justify-center' : 'p-2'} rounded-md text-ink-muted hover:text-ink hover:bg-subtle focus:outline-none focus:ring-2 focus:ring-selected`}
    >
      <svg
        className="h-5 w-5"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={2}
        aria-hidden="true"
      >
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 22a10 10 0 100-20 10 10 0 000 20z" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M9.1 9a3 3 0 015.8 1c0 2-3 3-3 3" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 17h.01" />
      </svg>
    </button>
  )
}
