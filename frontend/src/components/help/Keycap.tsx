import { keyDisplay } from './shortcuts'

/**
 * One key, drawn as a keycap: an inset second pixel of the neutral rule
 * colour along the bottom is the physical-key depth cue. Shared by the Help
 * dialog and every place a control shows its shortcut, so a key looks the
 * same wherever it appears.
 */
export function Keycap({ keyName, className = '' }: { keyName: string; className?: string }) {
  const { label, spoken } = keyDisplay(keyName)
  return (
    <kbd
      className={`font-mono-code inline-flex min-w-[1.75rem] items-center justify-center rounded border border-line bg-subtle shadow-[inset_0_-1px_0_var(--border-subtle)] px-1.5 py-0.5 text-xs text-ink ${className}`}
    >
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
