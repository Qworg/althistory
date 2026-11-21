/**
 * In-app feedback (issue #49).
 *
 * GET  /api/feedback/config  whether this server files reports, and which repository the app should
 *                            send people to when it does not (no key needed: it holds no secret)
 * POST /api/feedback         file a report as a GitHub issue; 201 with the issue's number and link
 *
 * A report needs a key when the entity routes do (`API_AUTH_REQUIRED`), and is
 * always limited per client and across clients (`FeedbackRateLimiter`), because
 * the GitHub token is the server's, not the reporter's. The work is in
 * `services/feedback/FeedbackService.ts`.
 */

import { Router, type Request, type Response, type RequestHandler } from 'express';
import {
  asRequestHandler,
  asyncHandler,
  authenticate,
  rateLimit,
  requireAuth,
  type AuthenticatedRequest,
} from '@/api/middleware';
import { entityRoutesRequireApiKey } from '@/api/entityAuth';
import { getContainer } from '@/container';
import { commitSection } from '@/utils/requestBudget';
import { FeedbackService, readFeedbackReport } from '@/services/feedback/FeedbackService';

/** Who a report counts against: the key when there is one, else the address. */
function clientOf(req: AuthenticatedRequest): string {
  if (req.apiKey?.id) return `key:${req.apiKey.id}`;
  return `ip:${req.ip ?? req.socket.remoteAddress ?? 'unknown'}`;
}

/**
 * @param resolve the service to use; by default the container's, resolved per
 *                request (the container is built after this module loads)
 */
export function createFeedbackRouter(resolve: () => FeedbackService = () => getContainer().feedbackService): Router {
  const router = Router();

  router.get('/config', (_req: Request, res: Response) => {
    res.json({ success: true, data: resolve().publicConfig() });
  });

  const guard: RequestHandler[] = entityRoutesRequireApiKey()
    ? [asRequestHandler(authenticate), asRequestHandler(requireAuth), asRequestHandler(rateLimit())]
    : [];

  router.post(
    '/',
    ...guard,
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const service = resolve();
      if (!service.enabled) {
        res.status(503).json({
          success: false,
          error: {
            code: 'FEEDBACK_NOT_CONFIGURED',
            message: 'This server does not file feedback. Use the GitHub form instead.',
            requestId: req.requestId,
          },
        });
        return;
      }

      // Checked before the limiter, so a malformed report costs nothing.
      const report = readFeedbackReport(req.body);

      const taken = service.limiter.take(clientOf(req));
      if (!taken.allowed) {
        res.setHeader('Retry-After', String(taken.retryAfterSeconds));
        res.status(429).json({
          success: false,
          error: {
            code: 'FEEDBACK_RATE_LIMITED',
            message: `Too many reports. Try again in ${taken.retryAfterSeconds} seconds, or use the GitHub form.`,
            retryAfter: taken.retryAfterSeconds,
            requestId: req.requestId,
          },
        });
        return;
      }

      // Once GitHub is asked to write, the report may exist: a 408 would say it
      // does not, and a retry would file it twice. So the request is committed
      // here and answers with its real result, however late.
      const issue = await commitSection(() => service.file(report));
      res.status(201).json({ success: true, data: issue, requestId: req.requestId });
    })
  );

  return router;
}

export const feedbackRoutes = createFeedbackRouter();
