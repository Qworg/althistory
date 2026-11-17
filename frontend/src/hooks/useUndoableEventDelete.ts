import { useCallback } from 'react'
import { useCreateCausalLink, useCreateEvent, useDeleteEvent } from '@/hooks/useAPI'
import { useGlobalStore } from '@/stores/globalStore'
import type { EditHistoryEntry } from '@/hooks/useEditHistory'
import type { CausalRelationship, Event } from '@/types'
import { isRefusal } from '@/services/rateLimitNotice'

/** An error's message as the end of a sentence: no stop of its own, so the caller's does not double it. */
function sentence(error: unknown): string {
  const text = error instanceof Error && error.message ? error.message : 'unknown error'
  return text.replace(/[.\s]+$/, '')
}

/** The graph that is open now, as the rest of the app reads it. */
function openGraphId(): string | null {
  try {
    return localStorage.getItem('active_graph_id')
  } catch {
    return null
  }
}

/**
 * The lasting notices these entries have left, by notice id, with the graph each
 * belongs to. They name events of that graph, so they go when another graph is
 * opened (as the edit history itself is reset). This listener lives at module
 * scope, not in a component, so it works whichever view is mounted.
 */
const noticeGraph = new Map<string, string | null>()

if (typeof window !== 'undefined') {
  const onGraphSwitched = (event: globalThis.Event) => {
    const now = (event as CustomEvent<{ graphId?: string | null }>).detail?.graphId ?? openGraphId()
    const { errors, removeError } = useGlobalStore.getState()
    for (const [id, graph] of noticeGraph) {
      if (graph === now) continue
      if (errors.some((e) => e.id === id)) removeError(id)
      noticeGraph.delete(id)
    }
  }
  window.addEventListener('graph-switched', onGraphSwitched)
  // A hot reload evaluates this module again: do not leave the old listener.
  import.meta.hot?.dispose(() => window.removeEventListener('graph-switched', onGraphSwitched))
}

/**
 * The restored copies that still have a "weren't restored" notice, by event id,
 * each with the function that takes it down. Deleting such an event by any other
 * route makes the notice false ("is back").
 */
const liveCopies = new Map<string, () => void>()

/** At most this many links are named in a notice; the rest are counted. */
const MAX_NAMED_LINKS = 3

/**
 * Delete an event and record how to take it back.
 *
 * The server assigns ids, so undo re-creates the event (with its metadata,
 * which carries its arc and confidence) and then re-creates each causal link
 * that touched it against the new id. Redo deletes whichever copy is current.
 *
 * A delete queued while offline is not recorded: the server has not seen it,
 * and the replay queue owns it.
 */
export function useUndoableEventDelete(record: (entry: EditHistoryEntry) => void) {
  // mutateAsync is stable across renders, so the entries' closures, which
  // outlive this render, keep working.
  const { mutateAsync: deleteEvent } = useDeleteEvent()
  const { mutateAsync: createEvent } = useCreateEvent()
  const { mutateAsync: createLink } = useCreateCausalLink()
  const addError = useGlobalStore((state) => state.addError)

  return useCallback(
    async (event: Event, relationships: CausalRelationship[]): Promise<void> => {
      const links = relationships.filter(
        (link) => link.cause_event_id === event.id || link.effect_event_id === event.id
      )
      const outcome = await deleteEvent(event.id)
      if (outcome.delivery === 'queued') return
      // This event may be a copy an earlier undo restored: it is gone again.
      liveCopies.get(event.id)?.()
      liveCopies.delete(event.id)

      // The id of the live copy: the original until an undo re-creates it, then
      // the restored one. Redo deletes whichever is live.
      let currentId = event.id
      // This entry's lasting notices, by id, two slots per history entry (so two
      // events with identical text never share a notice):
      //  - state: what is true of the event now ("is back, but 2 links weren't
      //    restored"). Taken down only by a step that changes that state: an undo
      //    that re-creates the event, or a redo that deletes it.
      //  - failure: why the last attempt failed. Replaced on every attempt.
      let stateSlot: string[] = []
      let failureSlot: string[] = []
      const linkCount = links.length
      const description = `deleted "${event.description}"${
        linkCount ? ` and its ${linkCount} causal link${linkCount === 1 ? '' : 's'}` : ''
      }`

      /** An event's name where it is in view, or its id. */
      const nameOf = (id: string): string => {
        if (id === event.id) return `"${event.description}"`
        const inView = useGlobalStore.getState().events.find((e) => e.id === id)
        return inView ? `"${inView.description}"` : id
      }

      const takeDown = (ids: string[]) => {
        const { errors, removeError } = useGlobalStore.getState()
        for (const id of ids) {
          if (errors.some((e) => e.id === id)) removeError(id)
          noticeGraph.delete(id)
        }
      }
      const clearState = () => {
        takeDown(stateSlot)
        stateSlot = []
      }
      const clearFailure = () => {
        takeDown(failureSlot)
        failureSlot = []
      }

      /**
       * A lasting notice for this entry, tied to the graph the step began in. If
       * another graph has been opened since, it names events nobody is looking
       * at, so it is not posted.
       */
      const tell = (
        graphAtStart: string | null,
        message: string,
        kind: 'state' | 'failure',
        type: 'general' | 'network' = 'general'
      ) => {
        if (openGraphId() !== graphAtStart) return
        const id = addError({ type, message })
        ;(kind === 'state' ? stateSlot : failureSlot).push(id)
        noticeGraph.set(id, graphAtStart)
      }

      record({
        description,
        // One step: the event, then each link. A 429 partway leaves the event
        // back and a notice that names what is missing; the entry is done.
        undo: async () => {
          const graph = openGraphId()
          clearFailure()
          try {
            const created = await createEvent({
              description: event.description,
              actor: event.actor,
              target: event.target,
              timestamp: event.timestamp,
              metadata: event.metadata,
            })
            if (created.delivery === 'queued') {
              tell(graph, 'You are offline, so the deletion cannot be undone yet.', 'failure', 'network')
              return false
            }
            const restoredId = created.value.id
            currentId = restoredId
            // A step that re-creates the event follows a delete, which already took
            // down what was said before, so there is nothing to clear here.
            liveCopies.set(restoredId, clearState)
            let lostLinks = 0
            // After the first refusal (429) no more are sent: the rest would be
            // refused too. They are named in the notice, not retried.
            const refused: CausalRelationship[] = []
            for (const link of links) {
              if (refused.length > 0) {
                refused.push(link)
                continue
              }
              try {
                await createLink({
                  causeId: link.cause_event_id === event.id ? restoredId : link.cause_event_id,
                  effectId: link.effect_event_id === event.id ? restoredId : link.effect_event_id,
                  relationship: {
                    weight: link.weight,
                    evidence: link.evidence,
                    confidence: link.confidence,
                    relationship_type: link.relationship_type,
                  },
                })
              } catch (linkError) {
                if (isRefusal(linkError)) {
                  refused.push(link)
                } else {
                  // The other end may have been deleted since.
                  lostLinks++
                }
              }
            }
            if (lostLinks > 0) {
              tell(
                graph,
                `"${event.description}" is back, but ${lostLinks} of its causal links could not be restored: the event at the other end no longer exists.`,
                'state'
              )
            }
            if (refused.length > 0) {
              const named = refused
                .slice(0, MAX_NAMED_LINKS)
                .map((link) => `${nameOf(link.cause_event_id)} → ${nameOf(link.effect_event_id)}`)
              const more = refused.length - named.length
              const list = more > 0 ? `${named.join(', ')}, and ${more} more` : named.join(', ')
              const count =
                refused.length === 1 ? '1 of its causal links wasn\'t' : `${refused.length} of its causal links weren't`
              tell(
                graph,
                `"${event.description}" is back, but ${count} restored because the server was busy: ${list}. Draw ${
                  refused.length === 1 ? 'it' : 'them'
                } again with Draw Link in the Causal Graph view once the wait is over.`,
                'state'
              )
            }
            return true
          } catch (error) {
            tell(
              graph,
              `"${event.description}" could not be restored: ${
                isRefusal(error) ? 'the server is busy, try again shortly' : sentence(error)
              }. It is still in Version history.`,
              'failure',
              'network'
            )
            return false
          }
        },
        redo: async () => {
          const graph = openGraphId()
          clearFailure()
          try {
            const again = await deleteEvent(currentId)
            // Deleted again (or queued to be, offline): "is back, but…" no longer holds.
            clearState()
            liveCopies.delete(currentId)
            if (again.delivery !== 'sent') {
              tell(graph, 'You are offline; it will be deleted again when you reconnect.', 'failure', 'network')
            }
            return true
          } catch (error) {
            tell(
              graph,
              `"${event.description}" could not be deleted again: ${
                isRefusal(error) ? 'the server is busy, try again shortly' : sentence(error)
              }.`,
              'failure',
              'network'
            )
            return false
          }
        },
      })
    },
    [record, addError, deleteEvent, createEvent, createLink]
  )
}
