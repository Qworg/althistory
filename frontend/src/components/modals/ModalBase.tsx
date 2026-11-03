import React, { useEffect, useId, useCallback, useRef } from 'react'
import { useStackedDialogKeys } from './useStackedDialogKeys'

const FOCUSABLE_SELECTOR =
  'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'

/**
 * Moves focus into the dialog when it opens and back to the opener when it
 * closes. Keeping focus inside (Tab wrapping) is useStackedDialogKeys' job.
 */
function useFocusTrap(isOpen: boolean) {
  const containerRef = useRef<HTMLDivElement>(null)
  const previouslyFocusedRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (!isOpen) return

    // Store the previously focused element
    previouslyFocusedRef.current = document.activeElement as HTMLElement

    // Focus the container or first focusable element
    const container = containerRef.current
    if (container) {
      const focusableElements = container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
      const firstElement = focusableElements[0]
      if (firstElement) {
        firstElement.focus()
      } else {
        container.focus()
      }
    }

    // Restore focus when closing
    return () => {
      if (previouslyFocusedRef.current && typeof previouslyFocusedRef.current.focus === 'function') {
        previouslyFocusedRef.current.focus()
      }
    }
  }, [isOpen])

  // Tab wrapping (and Escape) is handled by useStackedDialogKeys, which acts
  // only for the topmost dialog, so stacked dialogs do not fight over focus.

  return containerRef
}

/**
 * Desktop widths. Below `lg` every size is a full-screen sheet, so the caps
 * apply from `lg` up. `full` is the viewport less the shared side margin
 * (the margin is applied once, on the content box).
 */
const sizeClasses = {
  sm: 'lg:max-w-sm',
  md: 'lg:max-w-md',
  lg: 'lg:max-w-lg',
  xl: 'lg:max-w-xl',
  '2xl': 'lg:max-w-2xl',
  '3xl': 'lg:max-w-3xl',
  '4xl': 'lg:max-w-4xl',
  full: 'lg:max-w-[calc(100%-2rem)]'
}

export interface ModalBaseProps {
  /** Whether the modal is currently open */
  isOpen: boolean
  /** Callback when the modal should close */
  onClose: () => void
  /** The title displayed in the modal header */
  title: string
  /** Modal content */
  children: React.ReactNode
  /** Modal width size */
  size?: keyof typeof sizeClasses
  /** Whether pressing Escape closes the modal */
  closeOnEscape?: boolean
  /** Whether clicking the backdrop closes the modal */
  closeOnBackdrop?: boolean
  /** Additional CSS classes for the modal container */
  className?: string
  /** Footer content (buttons, etc.) */
  footer?: React.ReactNode
  /** Whether to show the close button in the header */
  showCloseButton?: boolean
}

/**
 * Base modal component with proper accessibility attributes.
 * Provides consistent modal behavior across the application.
 *
 * Below `lg` (the phone layout) it is a full-screen sheet: no side margins,
 * the full dynamic viewport height, the header and footer fixed in place and
 * only the body scrolling. From `lg` up it is the centred card.
 */
export const ModalBase: React.FC<ModalBaseProps> = ({
  isOpen,
  onClose,
  title,
  children,
  size = 'md',
  closeOnEscape = true,
  closeOnBackdrop = true,
  className = '',
  footer,
  showCloseButton = true
}) => {
  const titleId = useId()
  const focusTrapRef = useFocusTrap(isOpen)

  // Escape closes only the topmost dialog, and Tab stays inside it. With
  // closeOnEscape false, Escape is swallowed while this dialog is on top
  // rather than falling through to whatever is underneath.
  useStackedDialogKeys(focusTrapRef, isOpen, onClose, closeOnEscape)

  // Prevent body scroll when modal is open
  useEffect(() => {
    if (isOpen) {
      const originalOverflow = document.body.style.overflow
      document.body.style.overflow = 'hidden'
      return () => {
        document.body.style.overflow = originalOverflow
      }
    }
  }, [isOpen])

  // Handle backdrop click
  const handleBackdropClick = useCallback((e: React.MouseEvent) => {
    if (e.target === e.currentTarget && closeOnBackdrop) {
      onClose()
    }
  }, [closeOnBackdrop, onClose])

  if (!isOpen) return null

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      className={`fixed inset-0 z-50 flex items-stretch justify-center lg:items-center lg:overflow-y-auto ${className}`}
    >
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/50 transition-opacity"
        onClick={handleBackdropClick}
        aria-hidden="true"
      />

      {/* Content */}
      <div
        ref={focusTrapRef}
        className={`relative flex flex-col w-full h-dvh bg-card text-ink shadow-xl lg:h-auto lg:rounded-lg lg:border lg:border-line lg:mx-4 lg:my-8 ${sizeClasses[size]}`}
        style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
      >
        {/* Header (stays put: only the body scrolls) */}
        <div className="flex shrink-0 items-center justify-between gap-3 px-4 py-2 lg:p-4 border-b border-line">
          <h2 id={titleId} className="font-display text-xl leading-tight font-semibold text-ink">
            {title}
          </h2>
          {showCloseButton && (
            <button
              type="button"
              onClick={onClose}
              aria-label="Close modal"
              className="inline-flex h-11 w-11 shrink-0 items-center justify-center lg:h-auto lg:w-auto lg:p-2 hover:bg-subtle rounded-md transition-colors text-ink-muted hover:text-ink"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>

        {/* Body */}
        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-4 lg:flex-none lg:max-h-[calc(100vh-200px)]">
          {children}
        </div>

        {/* Footer (stays put on a phone, in thumb reach) */}
        {footer && (
          <div className="shrink-0 border-t border-line p-4 bg-subtle lg:rounded-b-lg">
            {footer}
          </div>
        )}
      </div>
    </div>
  )
}

export interface PanelBaseProps {
  /** Whether the panel is currently open */
  isOpen: boolean
  /** Callback when the panel should close */
  onClose: () => void
  /** The title displayed in the panel header */
  title: string
  /** Panel content */
  children: React.ReactNode
  /** Panel position */
  position?: 'left' | 'right'
  /** Panel width in rem or pixels */
  width?: string
  /** Whether pressing Escape closes the panel */
  closeOnEscape?: boolean
  /** Additional CSS classes for the panel container */
  className?: string
  /** Footer content (buttons, etc.) */
  footer?: React.ReactNode
}

/**
 * Base sliding panel component with proper accessibility attributes.
 * Provides consistent panel behavior for side-docked content.
 */
export const PanelBase: React.FC<PanelBaseProps> = ({
  isOpen,
  onClose,
  title,
  children,
  position = 'right',
  width = '24rem',
  closeOnEscape = true,
  className = '',
  footer
}) => {
  const titleId = useId()
  const focusTrapRef = useFocusTrap(isOpen)

  // Escape closes only the topmost dialog, and Tab stays inside it. With
  // closeOnEscape false, Escape is swallowed while this dialog is on top
  // rather than falling through to whatever is underneath.
  useStackedDialogKeys(focusTrapRef, isOpen, onClose, closeOnEscape)

  if (!isOpen) return null

  const positionClasses = position === 'left' ? 'left-0' : 'right-0'

  return (
    <div
      ref={focusTrapRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      className={`fixed inset-y-0 ${positionClasses} max-w-full bg-card text-ink shadow-xl border-l border-line transform transition-transform duration-300 ease-in-out z-50 ${className}`}
      style={{ width }}
    >
      <div className="flex flex-col h-full">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-line">
          <h2 id={titleId} className="font-display text-xl leading-tight font-semibold text-ink">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close panel"
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center lg:h-auto lg:w-auto lg:p-2 hover:bg-subtle rounded-md transition-colors text-ink-muted hover:text-ink"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4">
          {children}
        </div>

        {/* Footer */}
        {footer && (
          <div className="border-t border-line p-4">
            {footer}
          </div>
        )}
      </div>
    </div>
  )
}

export default ModalBase
