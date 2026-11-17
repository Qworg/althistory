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
 * A feed token may instead be for the graph list alone: `{ mode: "feed",
 * channel: "*" }`, with no `X-Graph-Id`. It needs `read:graphs` as well as
 * `read:events`, and binds the socket to no graph, so it is what a client asks
 * for when the key may no longer read the graph it had open: every graph it
 * then subscribes to is checked on its own, as on any feed socket.
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
  GRAPH_LIST_CHANNEL,
  STREAM_FEED_PERMISSION,
  STREAM_GRAPH_LIST_PERMISSION,
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

/**
 * Whether the request asks for a graph-list token (`channel: "*"`). Only a feed
 * token may be one, and it names no graph: a header alongside it is a 400, as
 * a body that disagrees with the header is everywhere else.
 */
function readsGraphList(req: AuthenticatedRequest): boolean {
  const body: unknown = req.body;
  const channel = typeof body === 'object' && body !== null ? (body as { channel?: unknown }).channel : undefined;
  if (channel === undefined || channel === null) return false;
  if (channel !== GRAPH_LIST_CHANNEL) {
    throw new ValidationError('channel must be "*" (the graph list), or left out for the X-Graph-Id graph', 'channel');
  }
  if (readMode(req) !== 'feed') {
    throw new ValidationError('A graph-list token is a feed token: send mode "feed"', 'channel');
  }
  if (req.get('X-Graph-Id') !== undefined) {
    throw new ValidationError('A graph-list token names no graph: leave out X-Graph-Id', 'channel');
  }
  return true;
}

/** `authorize` for the permission the requested mode needs (and the graph list's, for a list token). */
function authorizeMode(req: AuthenticatedRequest, res: Response, next: (error?: unknown) => void): void {
  try {
    const mode = MODE_PERMISSION[readMode(req)];
    if (!readsGraphList(req)) {
      authorize(mode)(req, res, next);
      return;
    }
    authorize(mode)(req, res, (error?: unknown) => {
      if (error) next(error);
      else authorize(STREAM_GRAPH_LIST_PERMISSION)(req, res, next);
    });
  } catch (error) {
    next(error);
  }
}

/** Run `handler` for a graph token; a graph-list token has no graph to resolve or check. */
function forGraphToken(handler: RequestHandler): RequestHandler {
  return (req, res, next) => {
    if (readsGraphList(req as AuthenticatedRequest)) next();
    else handler(req, res, next);
  };
}

streamRoutes.post(
  '/token',
  authenticate as RequestHandler,
  requireAuth as RequestHandler,
  authorizeMode as RequestHandler,
  rateLimit() as RequestHandler,
  forGraphToken(resolveGraphContext() as RequestHandler),
  forGraphToken(authorizeGraphAccess((req) => requireGraphId(req)) as RequestHandler),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    // `requireAuth` already refused an unauthenticated request; the guard keeps
    // that invariant visible without a non-null assertion.
    if (!req.apiKey) {
      res.status(401).json({ error: { message: 'Authentication required' } });
      return;
    }

    const graphId = readsGraphList(req) ? GRAPH_LIST_CHANNEL : requireGraphId(req);
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
      // null: the app's own key holds any number of streams.
      concurrentStreams: req.apiKey.rateLimitExempt ? null : req.apiKey.rateLimit.concurrentStreams,
    });
  })
);
