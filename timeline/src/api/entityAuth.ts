/**
 * The access rule for the entity API groups.
 *
 * `/api/events`, `/api/arcs`, `/api/causal`, `/api/temporal` and
 * `/api/inference` read and write graph data. They used to be mounted with no
 * authentication at all: only `resolveGraphContext` ran, so anyone who could
 * reach the port could read a timeline, rewrite it and run inference. The
 * permission model in `models/ApiKey.ts` existed and the docs described it, but
 * none of it was applied to these five groups.
 *
 * This module is the one place that decides:
 *
 *  - whether those groups require a key (`API_AUTH_REQUIRED`, see
 *    `utils/config.ts` for the default and why local execution is the one
 *    exception);
 *  - what each route is allowed to do (a read needs `read:*`, a write needs
 *    `write:*`). There is no `read:temporal` or `read:inference` permission,
 *    so those groups ask for the permissions of the data they touch.
 *
 * The decision is memoised on purpose. Two things read it -- the routers decide
 * what to mount, and the OpenAPI table decides what to document -- and they must
 * not be able to disagree, not even if something mutates the environment
 * between them. One decision per process, made when the first of the two asks.
 *
 * This is not a second auth implementation: it only composes the existing
 * `authenticate`, `requireAuth`, `authorize` and `rateLimit` middleware, in the
 * same order the already-authenticated groups use.
 */

import type { RequestHandler, Router } from 'express';
import {
  asRequestHandler,
  authenticate,
  authorize,
  authorizeGraphAccess,
  rateLimit,
  requireAuth,
  requireGraphId,
} from '@/api/middleware';
import type { Permission } from '@/models/ApiKey';
import { loadConfig } from '@/utils/config';

/** The one decision, memoised. `undefined` means "not asked yet". */
let entityAuthRequired: boolean | undefined;

/**
 * Whether the entity groups refuse callers without a key.
 *
 * Read once per process, because the mount and the document must agree.
 */
export function entityRoutesRequireApiKey(): boolean {
  if (entityAuthRequired === undefined) {
    entityAuthRequired = loadConfig().apiAuth.required;
  }
  return entityAuthRequired;
}

/**
 * The `auth` marker the OpenAPI document publishes for an entity operation.
 *
 * Derived from the same decision the routers mount, rather than written by
 * hand, so the two cannot drift apart. The drift test in
 * `entity-auth.test.ts` still checks the VALUE against what the mounted router
 * actually answers, so a bug in this function is visible rather than
 * self-consistent.
 */
export function entityOperationAuth(): 'required' | 'optional' {
  return entityRoutesRequireApiKey() ? 'required' : 'optional';
}

/**
 * Mount the authentication half of the guard on an entity router.
 *
 * `authenticate` reads the key (and is the only middleware that inspects it),
 * `requireAuth` refuses a keyless request with 401, and `rateLimit` charges the
 * key's per-key budget -- the same chain `keys.ts`, `batch.ts`, `export.ts` and
 * `stream.ts` mount.
 *
 * Mounted at router level, before `resolveGraphContext`, so a keyless caller is
 * refused without a graph lookup: otherwise a 404-vs-401 difference would tell
 * an anonymous caller whether a given graph exists.
 *
 * In the local-execution default it mounts nothing, which is exactly the
 * behaviour those routes had before: anonymous access, and the OpenAPI document
 * says so. It does not mount `authenticate` alone, because that would start
 * rejecting a key it cannot verify (401/403 on a write) in a mode that never
 * asked anyone for one.
 */
export function mountEntityAccessGuard(router: Router): void {
  if (!entityRoutesRequireApiKey()) {
    return;
  }

  router.use(
    asRequestHandler(authenticate),
    asRequestHandler(requireAuth),
    asRequestHandler(rateLimit())
  );
}

/**
 * The permission a single entity route requires, as route middleware.
 *
 * Returns nothing when the group does not require a key, so the route keeps its
 * previous behaviour; the OpenAPI marker says `optional` in that case.
 *
 * Pass every permission the route needs: `authorize` requires ALL of them. A
 * route that reads two kinds of entity (a timeline reads events *and* arcs)
 * therefore asks for both, rather than letting one read permission stand in for
 * the other.
 */
export function entityPermission(...permissions: Permission[]): RequestHandler[] {
  if (permissions.length === 0) {
    // `authorize()` with no permissions filters nothing, so it admits any
    // authenticated key. A route that reaches here has forgotten to say what
    // it needs; refuse the mount at startup, where a developer sees it,
    // rather than quietly letting a read-only key write.
    throw new Error(
      'entityPermission() needs at least one permission: a route with none would accept any valid key'
    );
  }

  if (!entityRoutesRequireApiKey()) {
    return [];
  }

  return [asRequestHandler(authorize(...permissions))];
}

/**
 * The per-key graph restriction, for the entity groups.
 *
 * `ApiKey.allowedGraphs` is what stops a key issued for one timeline from
 * reading another. The already-authenticated groups mount
 * `authorizeGraphAccess` (export, batch); these five did not, so any key could
 * name any graph in `X-Graph-Id` -- a key scoped to graph A could read and
 * write graph B.
 *
 * Mounted *after* `resolveGraphContext`, because it reads the graph that
 * middleware resolved. In local execution nothing is mounted, matching the
 * rest of the guard.
 */
export function mountEntityGraphAccess(router: Router): void {
  if (!entityRoutesRequireApiKey()) {
    return;
  }

  // `router.use()` with nothing to mount throws, so this is a mount helper
  // rather than a spread: in local execution there is nothing to add.
  router.use(asRequestHandler(authorizeGraphAccess((req) => requireGraphId(req))));
}
