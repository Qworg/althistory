/**
 * Opening a toolbar dialog from elsewhere in the app.
 *
 * The toolbar owns the Create Event, Ingest and Import dialogs. An empty view
 * that offers "Create the first event" or "Extract from text" asks it to open
 * them, rather than mounting a second copy of each dialog of its own.
 */

export type ToolbarTool = 'create-event' | 'ingest' | 'import'

export const OPEN_TOOLBAR_TOOL_EVENT = 'althistory:open-toolbar-tool'

export function openToolbarTool(tool: ToolbarTool): void {
  window.dispatchEvent(new CustomEvent<ToolbarTool>(OPEN_TOOLBAR_TOOL_EVENT, { detail: tool }))
}
