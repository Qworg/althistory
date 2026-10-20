/**
 * Shared permission metadata for the API key dashboard.
 *
 * The labels are shown on every key in the list and the groups drive the
 * presets of the create form, so both live in one place.
 */

import type { Permission } from '@/types'

/** Human readable label for every permission the API supports. */
export const PERMISSION_LABELS: Record<Permission, string> = {
  'read:events': 'Read Events',
  'write:events': 'Write Events',
  'read:arcs': 'Read Arcs',
  'write:arcs': 'Write Arcs',
  'read:relationships': 'Read Relationships',
  'write:relationships': 'Write Relationships',
  'read:graphs': 'Read Graphs',
  'write:graphs': 'Write Graphs',
  'export': 'Export',
  'import': 'Import',
  'ingest': 'Ingest',
  'admin': 'Admin',
}

/**
 * Permission presets offered by the create form.
 *
 * The arrays are readonly: they are handed straight into the request body, so
 * a caller that mutated one would change the preset for every later create.
 * `admin` is deliberately in no preset -- it is not offered by the form.
 */
export const PERMISSION_GROUPS = {
  readOnly: ['read:events', 'read:arcs', 'read:relationships', 'read:graphs', 'export'],
  readWrite: ['read:events', 'write:events', 'read:arcs', 'write:arcs', 'read:relationships', 'write:relationships', 'read:graphs', 'write:graphs', 'export', 'import'],
  full: ['read:events', 'write:events', 'read:arcs', 'write:arcs', 'read:relationships', 'write:relationships', 'read:graphs', 'write:graphs', 'export', 'import', 'ingest'],
} as const satisfies Record<string, readonly Permission[]>
