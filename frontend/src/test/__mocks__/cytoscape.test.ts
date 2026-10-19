import { describe, it, expect } from 'vitest'
import {
  createMockCollection,
  createMockCytoscape,
  createMockStyle,
  type MockElement,
  type MockNode
} from './cytoscape'

/**
 * Contract tests for the shared Cytoscape mock.
 *
 * These exist because a mock that behaves differently from Cytoscape turns a
 * real component bug into a passing test. Each case here pins behaviour a
 * component is entitled to rely on.
 */
describe('cytoscape mock contract', () => {
  it('keeps the style API chainable through selector/style/update', () => {
    const cy = createMockCytoscape()
    const style = cy.style()

    expect(style.selector('node')).toBe(style)
    expect(style.style({ 'background-color': 'red' })).toBe(style)
    expect(style.css({ label: 'data(label)' })).toBe(style)
    expect(style.update()).toBe(style)
    expect(style.clear()).toBe(style)
  })

  it('creates independent style objects per call', () => {
    expect(createMockStyle()).not.toBe(createMockStyle())
  })

  it('wraps elements before handing them to filter()', () => {
    const raw: MockElement[] = [{ data: { id: 'a' } }, { data: { id: 'b' } }]
    const collection = createMockCollection(raw)

    const filtered = collection.filter((item: MockNode) => String(item.data('id')) === 'b')

    expect(filtered.length).toBe(1)
    expect(String(filtered.map((item: MockNode) => item.id())[0])).toBe('b')
  })

  it('hands the same wrapped element to filter, forEach and map', () => {
    const raw: MockElement[] = [{ data: { id: 'a' } }]
    const collection = createMockCollection(raw)

    const seen: unknown[] = []
    collection.forEach((item: MockNode) => seen.push(item))
    const mapped = collection.map((item: MockNode) => item)
    const filtered = collection.filter((item: MockNode) => {
      seen.push(item)
      return true
    })

    // Wrap identity is cached per backing item, so a component that compares the
    // element it saw in filter() against the one it saw in forEach() sees one
    // object, not two.
    expect(seen[0]).toBe(seen[1])
    expect(mapped[0]).toBe(seen[0])
    expect(filtered.length).toBe(1)
  })

  it('passes the index to filter() callbacks', () => {
    const raw: MockElement[] = [{ data: { id: 'a' } }, { data: { id: 'b' } }]
    const collection = createMockCollection(raw)

    const indexes: number[] = []
    collection.filter((_item: MockNode, index: number) => {
      indexes.push(index)
      return true
    })

    expect(indexes).toEqual([0, 1])
  });

  it('does not hand filter() the raw backing objects', () => {
    const raw: MockElement[] = [{ data: { id: 'a' } }]
    const collection = createMockCollection(raw)

    collection.filter((item: MockNode) => {
      expect(item).not.toBe(raw[0])
      return true
    })
  })
})
