import { useCallback } from 'react'
import { useCreateCausalLink, useCreateEvent } from './useAPI'
import type { CreateEventRequest, Event } from '@/types'
import type { CausalLinkType, EventSaveExtras } from '@/components/modals/EventDetailModal'

/** A new link's weight by its kind, until the user tunes it in the causal graph. */
const DEFAULT_LINK_WEIGHT: Record<CausalLinkType, number> = {
  direct: 0.7,
  indirect: 0.4,
  contributory: 0.5,
}

export type CreateEventOutcome =
  /** Created, and linked to its cause when one was named. */
  | { status: 'created'; event: Event; linked: boolean }
  /** Offline: the create is queued and its cause link could not be made yet. */
  | { status: 'queued'; linkSkipped: boolean }

/**
 * Creates an event from the event form, then the link to the cause the form
 * named. The link needs the new event's id, so it follows the create; an
 * offline create is queued, and the link with it cannot be (the caller says so).
 */
export function useCreateEventWithCause() {
  const createEvent = useCreateEvent()
  const createLink = useCreateCausalLink()

  return useCallback(
    async (data: CreateEventRequest, extras?: EventSaveExtras): Promise<CreateEventOutcome> => {
      const outcome = await createEvent.mutateAsync(data)
      if (outcome.delivery === 'queued') return { status: 'queued', linkSkipped: Boolean(extras?.cause) }
      const event = outcome.value
      const cause = extras?.cause
      if (!cause) return { status: 'created', event, linked: false }
      const confidence = typeof data.metadata?.confidence === 'number' ? data.metadata.confidence : 0.7
      await createLink.mutateAsync({
        causeId: cause.eventId,
        effectId: event.id,
        relationship: {
          relationship_type: cause.type,
          weight: DEFAULT_LINK_WEIGHT[cause.type],
          confidence,
          evidence: '',
        },
      })
      return { status: 'created', event, linked: true }
    },
    [createEvent, createLink]
  )
}
