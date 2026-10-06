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
 * This route is protected exactly like the other write routes: authenticate ->
 * requireAuth -> authorize -> rateLimit -> resolveGraphContext ->
 * authorizeGraphAccess. It does NOT follow the historical pattern of a route
 * with no auth middleware.
 */

import { Router, Response, RequestHandler } from 'express';
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
  STREAM_REQUIRED_PERMISSION,
  STREAM_TOKEN_TTL_MS,
  getStreamTokenStore,
} from '@/websocket';

export const streamRoutes = Router();

streamRoutes.post(
  '/token',
  authenticate as RequestHandler,
  requireAuth as RequestHandler,
  authorize(STREAM_REQUIRED_PERMISSION) as RequestHandler,
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
    });

    res.status(201).json({
      token: record.token,
      expiresIn: Math.floor(STREAM_TOKEN_TTL_MS / 1000),
      graphId,
      permissions: record.permissions,
      concurrentStreams: req.apiKey.rateLimit.concurrentStreams,
    });
  })
);
