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

      // The restored copy's id once undo has re-created the event, and the
      // links still to be made. A restore a 429 interrupted is finished by the
      // next undo, which re-creates neither the event nor the links already made.
      let currentId = event.id
      let restoredId: string | null = null
      let pending: CausalRelationship[] = links
      // The lasting notice for links still missing, so a repeat replaces it.
      let missingNotice: string | null = null
      const linkCount = links.length
      const description = `deleted "${event.description}"${
        linkCount ? ` and its ${linkCount} causal link${linkCount === 1 ? '' : 's'}` : ''
      }`

      /** Where each missing link was going, by name where the event is in view. */
      const nameEnds = (missing: CausalRelationship[]): string => {
        const inView = new Map(useGlobalStore.getState().events.map((e) => [e.id, e.description]))
        const names = missing
          .map((link) => (link.cause_event_id === event.id ? link.effect_event_id : link.cause_event_id))
          .map((id) => inView.get(id))
          .filter((name): name is string => Boolean(name))
        if (names.length === 0) return ''
        const shown = names.slice(0, 2).map((n) => `"${n}"`)
        const rest = missing.length - shown.length
        const list =
          rest > 0 ? `${shown.join(', ')}, and ${rest} more` : shown.join(shown.length === 2 ? ' and ' : ', ')
        return ` (to ${list})`
      }

      /** A lasting notice; an identical one already showing is not added again. */
      const tell = (message: string, type: 'general' | 'network' = 'general') => {
        if (useGlobalStore.getState().errors.some((e) => e.message === message)) return
        addError({ type, message })
      }

      record({
        description,
        undo: async () => {
          try {
            if (restoredId === null) {
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
              restoredId = created.value.id
              currentId = restoredId
            }
            const newId = restoredId
            let lostLinks = 0
            // Links the server refused for load (429). They are not made yet; the
            // entry stays on the undo stack and the next undo makes them. After the
            // first refusal no more are sent: the rest would be refused too.
            const refused: CausalRelationship[] = []
            for (const link of pending) {
              if (refused.length > 0) {
                refused.push(link)
                continue
              }
              try {
                await createLink({
                  causeId: link.cause_event_id === event.id ? newId : link.cause_event_id,
                  effectId: link.effect_event_id === event.id ? newId : link.effect_event_id,
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
            pending = refused
            if (lostLinks > 0) {
              tell(
                `"${event.description}" is back, but ${lostLinks} of its causal links could not be restored: the event at the other end no longer exists.`
              )
            }
            if (refused.length > 0) {
              const message = `"${event.description}" is back, but ${refused.length} of its causal links weren't restored yet because the server is busy${nameEnds(
                refused
              )}. Press Undo again once the wait is over to restore them.`
              missingNotice = message
              tell(message)
              // Unfinished: the entry stays on the undo stack for the rest.
              return false
            }
            if (missingNotice !== null) {
              const { errors, removeError } = useGlobalStore.getState()
              for (const e of errors) if (e.message === missingNotice) removeError(e.id)
              missingNotice = null
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
            // Gone again: the next undo re-creates it from the snapshot.
            restoredId = null
            pending = links
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
