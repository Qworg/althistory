/**
 * In-app feedback (issue #49).
 *
 * GET  /api/feedback/config  whether feedback is on (FEEDBACK_ENABLED), whether this server files
 *                            reports, and which repository the app should send people to when it
 *                            does not (no key needed: it holds no secret)
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
import { UpstreamServiceError } from '@/utils/errors';
import { FeedbackMaybeFiledError, FeedbackService, readFeedbackReport } from '@/services/feedback/FeedbackService';

/**
 * Who a report counts against: the address. Not the key: the bundled app sends
 * one key for every visitor (VITE_API_KEY), so a per-key bucket would let one
 * person use up everyone's reports. Behind a proxy, TRUST_PROXY makes this the
 * real client's address.
 */
export function clientOf(req: Pick<AuthenticatedRequest, 'ip' | 'socket'>): string {
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
      if (!service.config.enabled) {
        res.status(404).json({
          success: false,
          error: { code: 'FEEDBACK_DISABLED', message: 'Feedback is turned off on this server.', requestId: req.requestId },
        });
        return;
      }
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
      try {
        const issue = await commitSection(() => service.file(report));
        res.status(201).json({ success: true, data: issue, requestId: req.requestId });
      } catch (error) {
        if (error instanceof FeedbackMaybeFiledError) {
          // Said apart from a refusal, so the app asks the reporter to look before sending again.
          res.status(502).json({
            success: false,
            error: { code: 'FEEDBACK_MAYBE_FILED', message: error.message, requestId: req.requestId },
          });
          return;
        }
        // GitHub refused, so nothing was filed. Said with a code of our own, so
        // the app can tell it from a gateway's 502 (which might follow a filing).
        if (error instanceof UpstreamServiceError) {
          if (error.retryAfterSeconds) res.setHeader('Retry-After', String(error.retryAfterSeconds));
          res.status(error.statusCode).json({
            success: false,
            error: {
              code: error.statusCode === 503 ? 'FEEDBACK_GITHUB_LIMITED' : 'FEEDBACK_REFUSED',
              message: error.message,
              ...(error.retryAfterSeconds ? { retryAfter: error.retryAfterSeconds } : {}),
              requestId: req.requestId,
            },
          });
          return;
        }
        throw error;
      }
    })
  );

  return router;
}

export const feedbackRoutes = createFeedbackRouter();
