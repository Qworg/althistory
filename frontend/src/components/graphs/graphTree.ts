import type { Graph } from '@/types'

/** A graph and the branches forked from it, for a nested list. */
export interface GraphTreeNode {
  graph: Graph
  /** The graph it was branched from, when that graph is in the list. */
  parent: Graph | null
  /** 0 for a baseline, 1 for its branch, 2 for a branch of that branch… */
  depth: number
}

/**
 * Order `graphs` so every branch follows the graph it was forked from
 * (`parentGraphId`), depth-first, keeping the list's order among siblings. A
 * branch whose parent is not in the list (filtered out, or deleted) is listed
 * as a root, so nothing disappears.
 */
export function buildGraphTree(graphs: readonly Graph[]): GraphTreeNode[] {
  const ids = new Set(graphs.map((graph) => graph.id))
  const children = new Map<string, Graph[]>()
  const roots: Graph[] = []
  for (const graph of graphs) {
    const parentId = graph.parentGraphId
    if (parentId && parentId !== graph.id && ids.has(parentId)) {
      const list = children.get(parentId) ?? []
      list.push(graph)
      children.set(parentId, list)
    } else {
      roots.push(graph)
    }
  }

  const ordered: GraphTreeNode[] = []
  const visited = new Set<string>()
  const visit = (graph: Graph, parent: Graph | null, depth: number) => {
    if (visited.has(graph.id)) return
    visited.add(graph.id)
    ordered.push({ graph, parent, depth })
    for (const child of children.get(graph.id) ?? []) visit(child, graph, depth + 1)
  }
  roots.forEach((root) => visit(root, null, 0))
  // A parent cycle has no root; list what is left rather than drop it.
  graphs.forEach((graph) => visit(graph, null, 0))
  return ordered
}

const SEPARATOR = /^\s*[—–\-:/·|]\s*/

/**
 * The part of a branch's name that is its own: "The Engine Age — Clerks
 * Prevail" under "The Engine Age" is "Clerks Prevail". A name that does not
 * start with its parent's is returned whole.
 */
export function branchLabel(graph: Graph, parent: Graph | null): string {
  if (!parent) return graph.name
  const prefix = parent.name.trim()
  const name = graph.name.trim()
  if (!prefix || !name.toLowerCase().startsWith(prefix.toLowerCase())) return graph.name
  const rest = name.slice(prefix.length)
  if (!SEPARATOR.test(rest)) return graph.name
  const own = rest.replace(SEPARATOR, '').trim()
  return own || graph.name
}
