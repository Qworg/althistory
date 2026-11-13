/**
 * Stream token route (requirement 16.1, task 5.2).
 *
 * POST /api/stream/token
 *
 * A client authenticates with its API key, names the graph it will stream into
 * (via `X-Graph-Id`, or the active graph), and receives a short-lived token.
 * The token records the key id, the graph id and a snapshot of the key's
 * permissions; the WebSocket handler re-resolves the key on connect and
 * re-checks the permissions, so this route's `authorize` is the first of two
 * checks rather than the only one.
 *
 * The design document shows a `{ graphId }` request body; this route instead
 * follows the repository-wide convention of the `X-Graph-Id` header
 * (`resolveGraphContext`), which is how every other graph-scoped route selects
 * a graph. That is a deliberate deviation from the design's body field.
 *
 * A token is for one of two kinds of socket, chosen by `mode` in the body:
 *
 *   - `write` (the default): a session that may write events, arcs and links,
 *     and needs `write:events`;
 *   - `feed`: a read-only session for the live change feed, and needs
 *     `read:events`. A key that may only read can watch.
 *
 * This route is protected exactly like the other write routes: authenticate ->
 * requireAuth -> authorize -> rateLimit -> resolveGraphContext ->
 * authorizeGraphAccess. It does NOT follow the historical pattern of a route
 * with no auth middleware.
 */

import { Router, Response, RequestHandler } from 'express';
import type { Permission } from '@/models/ApiKey';
import { ValidationError } from '@/utils/errors';
import {
  AuthenticatedRequest,
  authenticate,
  requireAuth,
  authorize,
  rateLimit,
  resolveGraphContext,
  authorizeGraphAccess,
  requireGraphId,
  asyncHandler,
} from '@/api/middleware';
import {
  STREAM_FEED_PERMISSION,
  STREAM_REQUIRED_PERMISSION,
  STREAM_TOKEN_TTL_MS,
  getStreamTokenStore,
} from '@/websocket';

export const streamRoutes = Router();

/** The permission a socket of each mode needs. */
const MODE_PERMISSION: Record<'write' | 'feed', Permission> = {
  write: STREAM_REQUIRED_PERMISSION,
  feed: STREAM_FEED_PERMISSION,
};

/** The mode a request asks for; anything but `write` or `feed` is a 400. */
function readMode(req: AuthenticatedRequest): 'write' | 'feed' {
  const body: unknown = req.body;
  const mode = typeof body === 'object' && body !== null ? (body as { mode?: unknown }).mode : undefined;
  if (mode === undefined || mode === null || mode === 'write') return 'write';
  if (mode === 'feed') return 'feed';
  throw new ValidationError('mode must be "write" or "feed"', 'mode');
}

/** `authorize` for the permission the requested mode needs. */
function authorizeMode(req: AuthenticatedRequest, res: Response, next: (error?: unknown) => void): void {
  try {
    authorize(MODE_PERMISSION[readMode(req)])(req, res, next);
  } catch (error) {
    next(error);
  }
}

streamRoutes.post(
  '/token',
  authenticate as RequestHandler,
  requireAuth as RequestHandler,
  authorizeMode as RequestHandler,
  rateLimit() as RequestHandler,
  resolveGraphContext() as RequestHandler,
  authorizeGraphAccess((req) => requireGraphId(req)) as RequestHandler,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    // `requireAuth` already refused an unauthenticated request; the guard keeps
    // that invariant visible without a non-null assertion.
    if (!req.apiKey) {
      res.status(401).json({ error: { message: 'Authentication required' } });
      return;
    }

    const graphId = requireGraphId(req);
    const record = getStreamTokenStore().issue({
      apiKeyId: req.apiKey.id,
      graphId,
      permissions: req.apiKey.permissions,
      mode: readMode(req),
    });

    res.status(201).json({
      token: record.token,
      expiresIn: Math.floor(STREAM_TOKEN_TTL_MS / 1000),
      graphId,
      permissions: record.permissions,
      mode: record.mode,
      concurrentStreams: req.apiKey.rateLimit.concurrentStreams,
    });
  })
);
