import type { Router } from 'express'
import { getMountedRouters } from './mounts'

/**
 * The routes the API actually serves.
 *
 * The OpenAPI document's PATHS and METHODS come from here, so the document
 * cannot describe a route that is not mounted. What each route DOES is
 * hand-written in `operations.ts`, and the two are checked against each other
 * in `openapi.test.ts`.
 *
 * The walk fails LOUDLY on a shape it cannot read. A route that is silently
 * skipped would be a route the document does not describe, and the document
 * would claim to be complete -- which is the one thing it must not do.
 */

/** One route the API serves. */
export interface RouteEntry {
  /** The HTTP method, upper case. */
  method: string
  /** The full path, including the `/api` prefix, in Express syntax. */
  path: string
}

/** The parts of an Express layer this module needs. */
interface RouterLayer {
  name?: string
  route?: {
    path: string
    methods: Record<string, boolean>
  }
  handle?: Router
  regexp?: RegExp
}

/**
 * A path the OpenAPI document can express.
 *
 * Express accepts regular expressions, arrays of paths and optional
 * parameters. None of them can be written as an OpenAPI path, so they are
 * refused rather than guessed at.
 */
function assertDocumentablePath(path: unknown): void {
  if (typeof path !== 'string') {
    throw new Error(
      `The path ${JSON.stringify(path)} is not a string. Express accepts an ` +
        'array of paths, which OpenAPI cannot express.'
    )
  }

  if (path.includes(',')) {
    throw new Error(
      `The path ${JSON.stringify(path)} is an array of paths, which OpenAPI ` +
        'cannot express. Split it into separate routes.'
    )
  }

  if (path.includes('?')) {
    throw new Error(
      `The path ${JSON.stringify(path)} has an optional parameter, which ` +
        'OpenAPI cannot express. Make the parameter required.'
    )
  }

  if (path.includes('(') || path.includes('\\')) {
    throw new Error(
      `The path ${JSON.stringify(path)} is a regular expression, which ` +
        'OpenAPI cannot express.'
    )
  }

  if (path.includes('*') || path.includes('+')) {
    throw new Error(
      `The path ${JSON.stringify(path)} is a wildcard, which OpenAPI cannot ` +
        'express.'
    )
  }
}

/**
 * The path a router is mounted at.
 *
 * Express does not keep the mount path on the layer it creates, only the
 * regular expression it compiled the path into, so reading it back means
 * parsing that expression -- which breaks as soon as a router is mounted at a
 * path with a parameter in it. The mount path is recorded when the router is
 * mounted instead (see `mounts.ts`).
 */
function mountPrefixOf(router: Router): string {
  const mount = getMountedRouters().find((candidate) => candidate.router === router)
  if (!mount) {
    throw new Error(
      'A router is mounted on the API router without mountApi(), so the route ' +
        'inventory does not know its mount path. Mount it with mountApi().'
    )
  }

  return mount.prefix
}

/**
 * The regular expressions Express compiles a pathless `use()` into.
 */
const PATHLESS_LAYER_SOURCE = '^\\/?(?=\\/|$)'
const PATHLESS_ROOT_SOURCE = '^\\/?$'

/**
 * Whether a layer is mounted without a path.
 *
 * Express compiles a pathless `use()` into a regular expression that matches
 * the root, and a `use('/legacy')` into one that does not. A pathless layer
 * cannot add a route, so the inventory may skip it.
 */
function isPathlessLayer(layer: RouterLayer): boolean {
  const source = layer.regexp?.source
  if (!source) return true

  // A pathless `use()` matches the root and nothing else.
  return source === PATHLESS_LAYER_SOURCE || source === PATHLESS_ROOT_SOURCE
}

/**
 * Every route a router serves, in the order the router declares them.
 *
 * The `prefix` is what the router is mounted at; the paths inside it are
 * relative to it.
 */
function collectRoutes(router: Router, prefix = ''): RouteEntry[] {
  const entries: RouteEntry[] = []
  // SAFETY: `Router.stack` is Express's internal route table and is not in
  // its public types. The shape read here is the one Express 4 builds: a layer
  // has `route` for a route, or `name === 'router'` with a nested `handle`
  // for a mounted router. A router that does not have a stack (an
  // application rather than a router) yields no routes, which the
  // document-versus-router test reports.
  const stack = (router as unknown as { stack?: RouterLayer[] }).stack ?? []

  for (const layer of stack) {
    if (layer.route) {
      assertDocumentablePath(layer.route.path)

      for (const method of Object.keys(layer.route.methods)) {
        if (method === '_all') {
          throw new Error(
            `The route ${JSON.stringify(layer.route.path)} answers every ` +
              'method, which OpenAPI cannot describe. Register the methods ' +
              'separately.'
          )
        }

        entries.push({
          method: method.toUpperCase(),
          path: `${prefix}${layer.route.path}`.replace(/\/+$/, '') || '/',
        })
      }
      continue
    }

    if (layer.name === 'mounted_app') {
      throw new Error(
        'A sub-application is mounted on the API router, which the route ' +
          'inventory cannot walk. Mount a router instead.'
      )
    }

    if (layer.name === 'router' && layer.handle) {
      entries.push(...collectRoutes(layer.handle, `${prefix}${mountPrefixOf(layer.handle)}`))
      continue
    }

    // A layer that is neither a route nor a router may still answer requests
    // -- `router.use('/legacy', handler)` does. Skipping it would leave a route
    // out of the document, and the document claims to be complete.
    //
    // A middleware mounted WITHOUT a path is not such a layer: it cannot add a
    // route, so it is skipped. The difference is the regular expression Express
    // compiled the layer's path into: a pathless `use()` matches the root, and
    // a `use('/legacy')` does not.
    if (isPathlessLayer(layer)) {
      continue
    }

    throw new Error(
      `The API router has a layer the route inventory cannot read ` +
        `(${JSON.stringify(layer.name)}). Mount a router with mountApi(), or ` +
        'register the route directly.'
    )
  }

  return entries
}

/** The routes a router serves, without duplicates, sorted for a stable diff. */
export function uniqueRoutes(router: Router, prefix = ''): RouteEntry[] {
  const seen = new Set<string>()
  const entries: RouteEntry[] = []

  for (const entry of collectRoutes(router, prefix)) {
    const key = `${entry.method} ${entry.path}`
    if (seen.has(key)) continue
    seen.add(key)
    entries.push(entry)
  }

  return entries.sort((a, b) =>
    a.path === b.path ? a.method.localeCompare(b.method) : a.path.localeCompare(b.path)
  )
}
