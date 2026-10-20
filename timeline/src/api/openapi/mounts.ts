import type { Router } from 'express'

/**
 * The routers mounted on the API router, and the path each is mounted at.
 *
 * Express does not keep the mount path on the layer it creates -- only the
 * regular expression it compiled the path into -- so reading it back means
 * parsing a regular expression, which breaks the moment a router is mounted at
 * a path with a parameter in it. Recording the mount path instead is exact,
 * and it makes the route inventory independent of Express's internals.
 */
export interface MountedRouter {
  /** The path the router is mounted at, without a trailing slash. */
  prefix: string
  /** The router itself. */
  router: Router
}

const mountedRouters: MountedRouter[] = []

/**
 * Mount a router on the API router, and record where.
 *
 * Every router the API serves is mounted through this, so the route inventory
 * knows the prefix of each without having to guess it.
 */
export function mountApi(parent: Router, prefix: string, router: Router): void {
  // The same router mounted twice would be walked with the FIRST prefix, and
  // the second mount would silently disappear from the document. That is the
  // kind of drift the document exists to prevent, so it is refused here.
  if (mountedRouters.some((mount) => mount.router === router)) {
    throw new Error(
      `The router is already mounted (at ${mountedRouters.find((mount) => mount.router === router)?.prefix}). ` +
        'Mount it once, or mount a different router instance.'
    )
  }

  mountedRouters.push({ prefix, router })
  parent.use(prefix, router)
}

/** The routers mounted on the API router, and where. */
export function getMountedRouters(): MountedRouter[] {
  return mountedRouters
}
