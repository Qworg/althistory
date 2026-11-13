/**
 * Says who a request's changes are by, for the live change feed.
 *
 * Mounted first on the API router. The key that authenticated the request (the
 * app's global `authenticate` has already run) gives the author a name, and two
 * request headers say what kind of client it is and which browser tab:
 *
 *   - `X-Althistory-Client`: `web`, `mcp` or `cli`, sent by the app, the MCP
 *     server and the command line. Anything else, or nothing, is `api`.
 *   - `X-Client-Id`: a tab's own id, so a tab can tell its edits from others'.
 *
 * Both are claims by the caller, used only to label a change for people
 * watching a graph the key may already read. They grant nothing.
 */

import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { AuthenticatedRequest } from './middleware';
import {
  CLIENT_ID_HEADER,
  CLIENT_KIND_HEADER,
  readActorKind,
  readOriginId,
  runWithChangeContext,
  type ChangeContext,
} from '@/utils/ChangeContext';

/** The author of a request's changes. */
export function changeContextOf(req: Request): ChangeContext {
  const key = (req as AuthenticatedRequest).apiKey;
  const origin = readOriginId(req.get(CLIENT_ID_HEADER));
  return {
    actor: {
      kind: readActorKind(req.get(CLIENT_KIND_HEADER)),
      ...(key ? { name: key.name, keyId: key.id } : {}),
    },
    ...(origin !== undefined ? { origin } : {}),
  };
}

export const attributeChanges: RequestHandler = (req: Request, _res: Response, next: NextFunction): void => {
  runWithChangeContext(changeContextOf(req), next);
};
