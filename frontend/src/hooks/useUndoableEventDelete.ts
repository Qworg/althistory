import { useCallback } from 'react'
import { useCreateCausalLink, useCreateEvent, useDeleteEvent } from '@/hooks/useAPI'
import { useGlobalStore } from '@/stores/globalStore'
import type { EditHistoryEntry } from '@/hooks/useEditHistory'
import type { CausalRelationship, Event } from '@/types'

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

      let currentId = event.id
      const linkCount = links.length
      const description = `deleted "${event.description}"${
        linkCount ? ` and its ${linkCount} causal link${linkCount === 1 ? '' : 's'}` : ''
      }`

      record({
        description,
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
            let lostLinks = 0
            for (const link of links) {
              try {
                await createLink({
                  causeId: link.cause_event_id === currentId ? restoredId : link.cause_event_id,
                  effectId: link.effect_event_id === currentId ? restoredId : link.effect_event_id,
                  relationship: {
                    weight: link.weight,
                    evidence: link.evidence,
                    confidence: link.confidence,
                    relationship_type: link.relationship_type,
                  },
                })
              } catch {
                // The other end may have been deleted since.
                lostLinks++
              }
            }
            currentId = restoredId
            if (lostLinks > 0) {
              addError({
                type: 'general',
                message: `"${event.description}" is back, but ${lostLinks} of its causal links could not be restored: the event at the other end no longer exists.`,
              })
            }
            return true
          } catch (error) {
            addError({
              type: 'network',
              message: `"${event.description}" could not be restored: ${error instanceof Error ? error.message : 'unknown error'}. It is still in Version history.`,
            })
            return false
          }
        },
        redo: async () => {
          try {
            const again = await deleteEvent(currentId)
            return again.delivery === 'sent'
          } catch (error) {
            addError({
              type: 'network',
              message: `"${event.description}" could not be deleted again: ${error instanceof Error ? error.message : 'unknown error'}.`,
            })
            return false
          }
        },
      })
    },
    [record, addError, deleteEvent, createEvent, createLink]
  )
}
