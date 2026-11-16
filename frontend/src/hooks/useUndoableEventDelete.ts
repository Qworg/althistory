import { useCallback, useEffect } from 'react'
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

/**
 * The lasting notices this hook has left. They name events of the graph that
 * was open, so they go when it changes (as the edit history itself is reset).
 */
const leftNotices = new Set<string>()

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

  // Another graph is open: its events are not the ones these notices name.
  useEffect(() => {
    const onGraphSwitched = () => {
      const { errors, removeError } = useGlobalStore.getState()
      for (const e of errors) if (leftNotices.has(e.message)) removeError(e.id)
      leftNotices.clear()
    }
    window.addEventListener('graph-switched', onGraphSwitched)
    return () => window.removeEventListener('graph-switched', onGraphSwitched)
  }, [])

  return useCallback(
    async (event: Event, relationships: CausalRelationship[]): Promise<void> => {
      const links = relationships.filter(
        (link) => link.cause_event_id === event.id || link.effect_event_id === event.id
      )
      const outcome = await deleteEvent(event.id)
      if (outcome.delivery === 'queued') return

      // The id of the live copy: the original until an undo re-creates it, then
      // the restored one. Redo deletes whichever is live.
      let currentId = event.id
      // The lasting notice this entry last left about links it could not restore,
      // so a repeat replaces it instead of stacking.
      let lastMissing: string | null = null
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

      /**
       * A lasting notice. An identical one already showing is removed first and
       * the new one added, so a repeated failure is announced again instead of
       * staying silent or stacking.
       */
      const tell = (message: string, type: 'general' | 'network' = 'general') => {
        const { errors, removeError } = useGlobalStore.getState()
        for (const e of errors) if (e.message === message) removeError(e.id)
        leftNotices.add(message)
        addError({ type, message })
      }

      /** Take down the "links weren't restored" notice: it no longer describes the event. */
      const clearMissing = () => {
        if (lastMissing === null) return
        const { errors, removeError } = useGlobalStore.getState()
        for (const e of errors) if (e.message === lastMissing) removeError(e.id)
        leftNotices.delete(lastMissing)
        lastMissing = null
      }

      record({
        description,
        // One step: the event, then each link. A 429 partway leaves the event
        // back and a notice that names what is missing; the entry is done.
        undo: async () => {
          try {
            const created = await createEvent({
              description: event.description,
              actor: event.actor,
              target: event.target,
              timestamp: event.timestamp,
              metadata: event.metadata,
            })
            if (created.delivery === 'queued') {
              addError({ type: 'network', message: 'You are offline, so the deletion cannot be undone yet.' })
              return false
            }
            const restoredId = created.value.id
            currentId = restoredId
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
                `"${event.description}" is back, but ${lostLinks} of its causal links could not be restored: the event at the other end no longer exists.`
              )
            }
            if (refused.length > 0) {
              const named = refused
                .slice(0, MAX_NAMED_LINKS)
                .map((link) => `${nameOf(link.cause_event_id)} \u2192 ${nameOf(link.effect_event_id)}`)
              const more = refused.length - named.length
              const list = more > 0 ? `${named.join(', ')}, and ${more} more` : named.join(', ')
              const count =
                refused.length === 1 ? '1 of its causal links wasn\'t' : `${refused.length} of its causal links weren't`
              clearMissing()
              lastMissing = `"${event.description}" is back, but ${count} restored because the server was busy: ${list}. Draw ${
                refused.length === 1 ? 'it' : 'them'
              } again with Draw Link in the Causal Graph view once the wait is over.`
              tell(lastMissing)
            } else {
              // Every link is back: an earlier "weren't restored" no longer holds.
              clearMissing()
            }
            return true
          } catch (error) {
            tell(
              `"${event.description}" could not be restored: ${
                isRefusal(error) ? 'the server is busy, try again shortly' : sentence(error)
              }. It is still in Version history.`,
              'network'
            )
            return false
          }
        },
        redo: async () => {
          try {
            const again = await deleteEvent(currentId)
            if (again.delivery !== 'sent') return false
            // The event is deleted again: "is back, but…" is no longer true.
            clearMissing()
            return true
          } catch (error) {
            tell(
              `"${event.description}" could not be deleted again: ${
                isRefusal(error) ? 'the server is busy, try again shortly' : sentence(error)
              }.`,
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
