/**
 * Cytoscape setup - registers all external layout extensions
 * Import this file once at app startup to enable all layouts
 */
import cytoscape from 'cytoscape'
import dagre from 'cytoscape-dagre'
import coseBilkent from 'cytoscape-cose-bilkent'

// Track if extensions have been registered to avoid double-registration
let isInitialized = false

export function initializeCytoscapeExtensions(): void {
  if (isInitialized) return

  // Register layout extensions
  cytoscape.use(dagre)
  cytoscape.use(coseBilkent)

  isInitialized = true
}

// Auto-initialize when this module is imported
initializeCytoscapeExtensions()
