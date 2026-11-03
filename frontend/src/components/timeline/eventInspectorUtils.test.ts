import { describe, it, expect } from 'vitest'
import { causesAndEffects, containingArcs, eventConfidence, eventSource } from './eventInspectorUtils'
import type { Arc, CausalRelationship, Event } from '@/types'

function event(id: string, timestamp: string, metadata?: Record<string, unknown>): Event {
  return { id, description: id, actor: 'A', target: 'B', timestamp, created_at: '', updated_at: '', metadata }
}

function arc(id: string, start: string, end: string, level: number, parent: string | null = null): Arc {
  return { id, name: id, description: '', start_time: start, end_time: end, level, parent_arc_id: parent, created_at: '', updated_at: '' }
}

function link(id: string, cause: string, effect: string): CausalRelationship {
  return {
    id,
    cause_event_id: cause,
    effect_event_id: effect,
    weight: 0.5,
    evidence: '',
    confidence: 0.5,
    relationship_type: 'direct',
    created_at: '',
    updated_at: '',
  }
}

describe('eventConfidence', () => {
  it('reads metadata.confidence when it is a number', () => {
    expect(eventConfidence(event('e', '1850-01-01', { confidence: 0.4 }))).toBe(0.4)
    expect(eventConfidence(event('e', '1850-01-01', { confidence: 'high' }))).toBeNull()
    expect(eventConfidence(event('e', '1850-01-01'))).toBeNull()
  })
})

describe('containingArcs', () => {
  const arcs = [
    arc('outer', '1840-01-01', '1860-01-01', 1),
    arc('inner', '1850-01-01', '1855-01-01', 2, 'outer'),
    arc('later', '1870-01-01', '1880-01-01', 1),
  ]

  it('prefers the assigned arc, with its ancestors first', () => {
    expect(containingArcs(event('e', '1875-01-01', { arcId: 'inner' }), arcs)).toEqual({
      arcs: [arcs[0], arcs[1]],
      basis: 'assigned',
    })
  })

  it('falls back to time bounds, outermost first, when nothing is assigned', () => {
    const result = containingArcs(event('e', '1852-01-01'), arcs)
    expect(result.basis).toBe('date')
    expect(result.arcs.map((a) => a.id)).toEqual(['outer', 'inner'])
  })

  it('falls back to time bounds when the assigned arc no longer exists', () => {
    expect(containingArcs(event('e', '1875-01-01', { arcId: 'gone' }), arcs).arcs.map((a) => a.id)).toEqual(['later'])
  })
})

describe('eventSource', () => {
  it('describes an ingested record', () => {
    expect(
      eventSource(event('e', '1850-01-01', { sourceUrl: 'https://x.test/a', extractionSource: 'wikidata' }))
    ).toEqual({ url: 'https://x.test/a', title: 'https://x.test/a', origin: 'Extracted from Wikidata' })
  })

  it('describes a simulated event', () => {
    expect(eventSource(event('e', '1850-01-01', { simulated: true, pressureType: 'economic' }))?.origin).toBe(
      'Simulated forward from an economic pressure'
    )
  })

  it('is null for a hand-made event', () => {
    expect(eventSource(event('e', '1850-01-01', { arcId: 'x', significance: 0.5 }))).toBeNull()
  })
})

describe('causesAndEffects', () => {
  it('splits links into causes and effects in date order, skipping ends not on this timeline', () => {
    const events = [
      event('a', '1850-01-01'),
      event('b', '1840-01-01'),
      event('x', '1855-01-01'),
      event('c', '1860-01-01'),
    ]
    const links = [link('1', 'a', 'x'), link('2', 'b', 'x'), link('3', 'x', 'c'), link('4', 'x', 'elsewhere')]
    const { causes, effects } = causesAndEffects('x', links, events)
    expect(causes.map((n) => n.event.id)).toEqual(['b', 'a'])
    expect(effects.map((n) => n.event.id)).toEqual(['c'])
  })
})
