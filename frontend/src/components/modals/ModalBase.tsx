import React, { useEffect, useId, useCallback, useRef } from 'react'

const FOCUSABLE_SELECTOR =
  'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'

/**
 * Custom hook to trap focus within an element for accessibility
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

  // Handle Tab key to trap focus
  const handleTabKey = useCallback((e: KeyboardEvent) => {
    const container = containerRef.current
    if (!container || e.key !== 'Tab') return

    const focusableElements = container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
    if (focusableElements.length === 0) return

    const firstElement = focusableElements[0]
    const lastElement = focusableElements[focusableElements.length - 1]

    // Guard against undefined elements (shouldn't happen given length check above)
    if (!firstElement || !lastElement) return

    if (e.shiftKey) {
      // Shift+Tab: if on first element, go to last
      if (document.activeElement === firstElement) {
        e.preventDefault()
        lastElement.focus()
      }
    } else {
      // Tab: if on last element, go to first
      if (document.activeElement === lastElement) {
        e.preventDefault()
        firstElement.focus()
      }
    }
  }, [])

  useEffect(() => {
    if (!isOpen) return

    document.addEventListener('keydown', handleTabKey)
    return () => document.removeEventListener('keydown', handleTabKey)
  }, [isOpen, handleTabKey])

  return containerRef
}

const sizeClasses = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
  xl: 'max-w-xl',
  '2xl': 'max-w-2xl',
  '3xl': 'max-w-3xl',
  '4xl': 'max-w-4xl',
  full: 'max-w-full mx-4'
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

  // Handle escape key
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape' && closeOnEscape) {
      onClose()
    }
  }, [closeOnEscape, onClose])

  useEffect(() => {
    if (!isOpen) return

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, handleKeyDown])

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
      className={`fixed inset-0 z-50 flex items-center justify-center overflow-y-auto ${className}`}
    >
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black bg-opacity-50 transition-opacity"
        onClick={handleBackdropClick}
        aria-hidden="true"
      />

      {/* Content */}
      <div
        ref={focusTrapRef}
        className={`relative bg-white rounded-lg shadow-xl w-full ${sizeClasses[size]} mx-4 my-8`}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-200">
          <h2 id={titleId} className="text-lg font-semibold text-gray-900">
            {title}
          </h2>
          {showCloseButton && (
            <button
              type="button"
              onClick={onClose}
              aria-label="Close modal"
              className="p-2 hover:bg-gray-100 rounded-md transition-colors text-gray-400 hover:text-gray-600"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>

        {/* Body */}
        <div className="p-4 max-h-[calc(100vh-200px)] overflow-y-auto">
          {children}
        </div>

        {/* Footer */}
        {footer && (
          <div className="border-t border-gray-200 p-4 bg-gray-50 rounded-b-lg">
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

  // Handle escape key
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape' && closeOnEscape) {
      onClose()
    }
  }, [closeOnEscape, onClose])

  useEffect(() => {
    if (!isOpen) return

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, handleKeyDown])

  if (!isOpen) return null

  const positionClasses = position === 'left' ? 'left-0' : 'right-0'

  return (
    <div
      ref={focusTrapRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      className={`fixed inset-y-0 ${positionClasses} bg-white shadow-xl border-l border-gray-200 transform transition-transform duration-300 ease-in-out z-50 ${className}`}
      style={{ width }}
    >
      <div className="flex flex-col h-full">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-200">
          <h2 id={titleId} className="text-lg font-semibold text-gray-900">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close panel"
            className="p-2 hover:bg-gray-100 rounded-md transition-colors text-gray-400 hover:text-gray-600"
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
          <div className="border-t border-gray-200 p-4">
            {footer}
          </div>
        )}
      </div>
    </div>
  )
}

export default ModalBase
