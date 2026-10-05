/// <reference types="vitest/globals" />
import { screen, fireEvent, waitFor, within } from '@testing-library/react'
import { expect } from 'vitest'

/**
 * Gets an element by its label text (case-insensitive)
 * @param label - The label text to search for
 * @returns The matching element
 */
export function getByLabelText(label: string): HTMLElement {
  return screen.getByLabelText(new RegExp(label, 'i'))
}

/**
 * Queries for an element by its label text (case-insensitive)
 * Returns null if not found instead of throwing
 * @param label - The label text to search for
 * @returns The matching element or null
 */
export function queryByLabelText(label: string): HTMLElement | null {
  return screen.queryByLabelText(new RegExp(label, 'i'))
}

/**
 * Gets a form field and provides helper methods for interaction
 * @param label - The label text to search for
 * @returns Object with element and helper methods
 */
export function getFormField(label: string) {
  const field = screen.getByLabelText(new RegExp(label, 'i')) as HTMLInputElement | HTMLTextAreaElement
  return {
    element: field,
    setValue: (value: string) => {
      fireEvent.change(field, { target: { value } })
    },
    getValue: () => field.value,
    clear: () => {
      fireEvent.change(field, { target: { value: '' } })
    },
    focus: () => {
      fireEvent.focus(field)
    },
    blur: () => {
      fireEvent.blur(field)
    }
  }
}

/**
 * Waits for a validation error with specific text to appear
 * @param errorText - The error text to wait for
 * @returns Promise that resolves when the error is found
 */
export async function waitForValidationError(errorText: string): Promise<void> {
  await waitFor(() => {
    const errors = screen.getAllByRole('alert')
    const hasError = errors.some(el => el.textContent?.includes(errorText))
    if (!hasError) {
      throw new Error(`Could not find validation error containing: ${errorText}`)
    }
  })
}

/**
 * Expects no validation errors to be present
 * Uses queryAllByRole to avoid throwing when none found
 */
export function expectNoValidationErrors(): void {
  const alerts = screen.queryAllByRole('alert')
  expect(alerts).toHaveLength(0)
}

/**
 * Gets a button by its accessible name
 * @param name - The button name/text
 * @returns The button element
 */
export function getButton(name: string): HTMLElement {
  return screen.getByRole('button', { name: new RegExp(name, 'i') })
}

/**
 * Queries for a button by its accessible name
 * @param name - The button name/text
 * @returns The button element or null
 */
export function queryButton(name: string): HTMLElement | null {
  return screen.queryByRole('button', { name: new RegExp(name, 'i') })
}

/**
 * Gets a dialog element
 * @returns The dialog element
 */
export function getDialog(): HTMLElement {
  return screen.getByRole('dialog')
}

/**
 * Queries for a dialog element
 * @returns The dialog element or null
 */
export function queryDialog(): HTMLElement | null {
  return screen.queryByRole('dialog')
}

/**
 * Expects a dialog to have proper ARIA attributes
 * @param dialog - The dialog element to check
 */
export function expectDialogAccessibility(dialog: HTMLElement): void {
  expect(dialog).toHaveAttribute('role', 'dialog')
  expect(dialog).toHaveAttribute('aria-modal', 'true')
  // Should have either aria-labelledby or aria-label
  const hasLabel = dialog.hasAttribute('aria-labelledby') || dialog.hasAttribute('aria-label')
  expect(hasLabel).toBe(true)
}

/**
 * Gets a tab by its name
 * @param name - The tab name/text
 * @returns The tab element
 */
export function getTab(name: string): HTMLElement {
  return screen.getByRole('tab', { name: new RegExp(name, 'i') })
}

/**
 * Queries for a tab by its name
 * @param name - The tab name/text
 * @returns The tab element or null
 */
export function queryTab(name: string): HTMLElement | null {
  return screen.queryByRole('tab', { name: new RegExp(name, 'i') })
}

/**
 * Gets a tabpanel element
 * @returns The tabpanel element
 */
export function getTabPanel(): HTMLElement {
  return screen.getByRole('tabpanel')
}

/**
 * Queries for a tabpanel element
 * @returns The tabpanel element or null
 */
export function queryTabPanel(): HTMLElement | null {
  return screen.queryByRole('tabpanel')
}

/**
 * Checks if an element is disabled
 * @param element - The element to check
 * @returns true if the element is disabled
 */
export function isDisabled(element: HTMLElement): boolean {
  return (
    element.hasAttribute('disabled') ||
    element.getAttribute('aria-disabled') === 'true'
  )
}

/**
 * Waits for an element to become enabled
 * @param element - The element to wait for
 */
export async function waitForEnabled(element: HTMLElement): Promise<void> {
  await waitFor(() => {
    expect(isDisabled(element)).toBe(false)
  })
}

/**
 * Waits for an element to become disabled
 * @param element - The element to wait for
 */
export async function waitForDisabled(element: HTMLElement): Promise<void> {
  await waitFor(() => {
    expect(isDisabled(element)).toBe(true)
  })
}

/**
 * Gets a heading by its level and optional text content
 * @param level - The heading level (1-6)
 * @param text - Optional text to match
 * @returns The heading element
 */
export function getHeading(level: 1 | 2 | 3 | 4 | 5 | 6, text?: string): HTMLElement {
  const options = text ? { name: new RegExp(text, 'i') } : undefined
  return screen.getByRole('heading', { level, ...options })
}

/**
 * Gets all elements with a specific role within a container
 * @param container - The container element
 * @param role - The ARIA role to search for
 * @returns Array of matching elements
 */
export function getWithinByRole(container: HTMLElement, role: string): HTMLElement[] {
  return within(container).getAllByRole(role)
}

/**
 * Checks if an element has focus
 * @param element - The element to check
 * @returns true if the element has focus
 */
export function hasFocus(element: HTMLElement): boolean {
  return document.activeElement === element
}

/**
 * Waits for an element to receive focus
 * @param element - The element to wait for
 */
export async function waitForFocus(element: HTMLElement): Promise<void> {
  await waitFor(() => {
    expect(document.activeElement).toBe(element)
  })
}

/**
 * Simulates pressing the Escape key
 */
export function pressEscape(): void {
  fireEvent.keyDown(document.activeElement || document.body, {
    key: 'Escape',
    code: 'Escape',
    keyCode: 27
  })
}

/**
 * Simulates pressing the Tab key
 * @param shiftKey - Whether Shift is held (for reverse tabbing)
 */
export function pressTab(shiftKey = false): void {
  fireEvent.keyDown(document.activeElement || document.body, {
    key: 'Tab',
    code: 'Tab',
    keyCode: 9,
    shiftKey
  })
}

/**
 * Simulates pressing the Enter key
 */
export function pressEnter(): void {
  fireEvent.keyDown(document.activeElement || document.body, {
    key: 'Enter',
    code: 'Enter',
    keyCode: 13
  })
}

/**
 * Gets an alert element by its text content
 * @param text - The text to search for
 * @returns The alert element
 */
export function getAlert(text: string): HTMLElement {
  const alerts = screen.getAllByRole('alert')
  const alert = alerts.find(el => el.textContent?.includes(text))
  if (!alert) {
    throw new Error(`Could not find alert containing: ${text}`)
  }
  return alert
}

/**
 * Queries for an alert by its text content
 * @param text - The text to search for
 * @returns The alert element or null
 */
export function queryAlert(text: string): HTMLElement | null {
  const alerts = screen.queryAllByRole('alert')
  return alerts.find(el => el.textContent?.includes(text)) || null
}

/**
 * Gets a listbox element
 * @returns The listbox element
 */
export function getListbox(): HTMLElement {
  return screen.getByRole('listbox')
}

/**
 * Gets options within a listbox
 * @param listbox - The listbox element (optional, will query screen if not provided)
 * @returns Array of option elements
 */
export function getOptions(listbox?: HTMLElement): HTMLElement[] {
  const container = listbox || screen
  return within(container as HTMLElement).getAllByRole('option')
}

/**
 * Checks if an element has the required attribute
 * @param element - The element to check
 * @returns true if the element is marked as required
 */
export function isRequired(element: HTMLElement): boolean {
  return (
    element.hasAttribute('required') ||
    element.getAttribute('aria-required') === 'true'
  )
}

/**
 * Checks if an element is marked as invalid
 * @param element - The element to check
 * @returns true if the element is marked as invalid
 */
export function isInvalid(element: HTMLElement): boolean {
  return element.getAttribute('aria-invalid') === 'true'
}

/**
 * Waits for a loading indicator to disappear
 * @param loadingText - The loading text to wait for (default: 'loading')
 */
export async function waitForLoadingToFinish(loadingText = 'loading'): Promise<void> {
  await waitFor(() => {
    expect(screen.queryByText(new RegExp(loadingText, 'i'))).not.toBeInTheDocument()
  })
}

/**
 * Gets the error description for a form field
 * @param fieldId - The ID of the form field
 * @returns The error description element or null
 */
export function getFieldErrorDescription(fieldId: string): HTMLElement | null {
  const field = document.getElementById(fieldId)
  if (!field) return null

  const describedBy = field.getAttribute('aria-describedby')
  if (!describedBy) return null

  return document.getElementById(describedBy)
}
