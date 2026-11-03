import { describe, it, expect } from 'vitest'
import { findDuplicateEvent, knownNames, matchKnownName, normalizeName } from './reviewMatching'
import type { Event, ExtractedEvent } from '@/types'

const event = (description: string, timestamp: string, actor = 'A', target = 'B'): Event => ({
  id: description,
  description,
  actor,
  target,
  timestamp,
  created_at: timestamp,
  updated_at: timestamp,
})

const extracted = (description: string, timestamp: string): ExtractedEvent =>
  ({ tempId: 't1', description, timestamp, actor: 'A', target: 'B', confidence: 0.8, selected: true }) as unknown as ExtractedEvent

describe('normalizeName', () => {
  it('folds case, punctuation, accents and a leading "the"', () => {
    expect(normalizeName('The Bank of England')).toBe('bank of england')
    expect(normalizeName('Lloyd’s')).toBe('lloyds')
    expect(normalizeName('Café  Society!')).toBe('cafe society')
  })
})

describe('matchKnownName', () => {
  const known = ['British Admiralty', 'Bank of England', 'Prussian General Staff', 'Ada Lovelace']

  it('recognises a name the graph already has, however it is cased', () => {
    expect(matchKnownName('bank of england', known)).toEqual({ kind: 'known', name: 'Bank of England' })
  })

  it('offers the graph’s name for a word-for-word part of it', () => {
    expect(matchKnownName('Admiralty', known)).toEqual({ kind: 'similar', name: 'British Admiralty' })
    expect(matchKnownName('The Prussian General Staff of 1866', known)).toEqual({ kind: 'similar', name: 'Prussian General Staff' })
  })

  it('does not match on a fragment of a word or a stranger', () => {
    expect(matchKnownName('Prussia', known)).toBeNull()
    expect(matchKnownName('Royal Society', known)).toBeNull()
    expect(matchKnownName('Ad', known)).toBeNull()
  })
})

describe('findDuplicateEvent', () => {
  const graph = [
    event('Parliament passes the Engine Licensing Act', '1861-03-01T00:00:00Z'),
    event('Ten thousand clerks protest at Westminster', '1859-05-01T00:00:00Z'),
  ]

  it('finds the same description on any day', () => {
    expect(findDuplicateEvent(extracted('Parliament passes the Engine Licensing Act.', '1862-01-01'), graph)?.id).toBe(
      'Parliament passes the Engine Licensing Act'
    )
  })

  it('finds mostly the same words on the same day', () => {
    expect(findDuplicateEvent(extracted('Clerks protest at Westminster', '1859-05-01'), graph)?.id).toBe(
      'Ten thousand clerks protest at Westminster'
    )
  })

  it('leaves similar words on another day alone', () => {
    expect(findDuplicateEvent(extracted('Clerks protest at Westminster', '1860-05-01'), graph)).toBeNull()
  })
})

describe('knownNames', () => {
  it('lists each actor and target once', () => {
    expect(knownNames([event('x', '1850-01-01', 'Peel', 'Babbage'), event('y', '1851-01-01', 'peel', 'Clement')])).toEqual([
      'Peel',
      'Babbage',
      'Clement',
    ])
  })
})
