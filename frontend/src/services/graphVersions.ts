import type { GraphVersion } from '@/types'

/**
 * A version record as `GET /api/graphs/:id/versions` returns it (the backend's
 * `VersionRef`).
 */
export interface ServerVersionRef {
  graphId?: string
  version: number
  timestamp: string
  parentVersion?: number | null
  operation?: string
  description?: string
  userId?: string
  changes?: {
    added?: Array<{ type: string; id: string }>
    modified?: Array<{ type: string; id: string }>
    deleted?: Array<{ type: string; id: string }>
  }
  treeHash?: string
}

/**
 * The version panel's view of a server version record.
 *
 * The client used to hand the server records straight to the panel typed as
 * `GraphVersion`, which they are not: the commit text is `description`, not
 * `message`, and `changes` lists the changed entities rather than counting
 * them. The panel therefore read "No commit message" on every version and drew
 * empty "E: A: R:" badges.
 */
export function toGraphVersion(ref: ServerVersionRef): GraphVersion {
  const count = (list: Array<{ type: string }> | undefined, type: string) =>
    (list ?? []).filter((change) => change.type === type).length
  const added = ref.changes?.added
  const modified = ref.changes?.modified
  const deleted = ref.changes?.deleted

  return {
    version: ref.version,
    commitHash: ref.treeHash ?? '',
    timestamp: ref.timestamp,
    message: ref.description ?? '',
    operation: ref.operation,
    author: ref.userId,
    changes: {
      eventsAdded: count(added, 'event'),
      eventsModified: count(modified, 'event'),
      eventsDeleted: count(deleted, 'event'),
      arcsAdded: count(added, 'arc'),
      arcsModified: count(modified, 'arc'),
      arcsDeleted: count(deleted, 'arc'),
      relationshipsAdded: count(added, 'relationship'),
      relationshipsModified: count(modified, 'relationship'),
      relationshipsDeleted: count(deleted, 'relationship'),
    },
  }
}
