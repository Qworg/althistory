import { Request, Response, NextFunction, RequestHandler } from 'express';
import { DatabaseConnectionError, ErrorHandler, NotFoundError } from '@/utils/errors';
import { assertSafeGraphId } from '@/utils/GraphContextStore';
import { getContainer } from '@/container';
import type { RequestContainer } from '@/container';
import { ApiKey, Permission, RateLimitConfig } from '@/models/ApiKey';

/**
 * The container-injection and request-timing middleware run before every route,
 * so these fields are present on every Request that reaches a handler.
 *
 * Declaring them by augmenting the Express namespace (rather than only as a
 * narrower RequestWithContainer) matters for assignability: Express types a
 * handler's `req` parameter as the base `Request`, and a handler that declares
 * a NARROWER request type is not assignable to it (parameters are checked
 * contravariantly). That mismatch made every `router.get/post(...)` call fail
 * with TS2769 "No overload matches this call" across the route files, because
 * `RequestContainer` is a deep type and TypeScript gave up on the structural
 * comparison. With the augmentation below, handlers can simply use `Request`.
 *
 * `container` is typed as `RequestContainer` rather than `Container`: see the
 * type's declaration for why handlers must not be able to reach an unscoped
 * repository.
 */
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      container: RequestContainer;
      requestId: string;
      startTime: number;
      /**
       * The graph this request is scoped to, resolved by
       * `resolveGraphContext` before any handler runs. Non-optional by design: a
       * handler must never observe a request whose graph scope is unknown,
       * because an unscoped read is the bug this field exists to prevent.
       */
      graphId: string;
    }
  }
}

/**
 * Extended Request interface with container access.
 *
 * @deprecated Prefer plain `Request` in handlers; the fields are now declared
 * on the base Express Request via the augmentation above. Kept as an alias for
 * existing callers and for documentation.
 */
export type RequestWithContainer = Request;

/**
 * Extended Request interface with authentication
 */
export interface AuthenticatedRequest extends RequestWithContainer {
  apiKey?: ApiKey;
  isAuthenticated: boolean;
}

/**
 * Container injection middleware
 */
export function injectContainer(req: RequestWithContainer, res: Response, next: NextFunction): void {
  try {
    req.container = getContainer();
    req.requestId = generateRequestId();
    req.startTime = Date.now();
    next();
  } catch (error) {
    next(new DatabaseConnectionError('Service container not available'));
  }
}

/**
 * The slice of `GraphRepository` that graph-context resolution needs.
 *
 * Declared structurally rather than as the concrete class so the resolver can
 * be exercised in isolation with a small fake, and so a future backing store
 * only has to satisfy these two lookups (design §9, storage-backend note).
 */
export interface GraphLookup {
  findById(id: string): Promise<{ id: string } | null>;
  getActiveGraph(): Promise<{ id: string } | null>;
}

/** Resolves the graph lookup for a request. Injectable for tests and wiring. */
export type GraphLookupResolver = (req: Request) => GraphLookup;

/** Request header that explicitly scopes a request to one graph. */
export const GRAPH_ID_HEADER = 'X-Graph-Id';

/**
 * Resolve exactly one graph for every request and attach it as `req.graphId`.
 *
 * Resolution order (design §5.1, Q1):
 *   1. A valid `X-Graph-Id` header, verified to name an existing graph.
 *   2. Otherwise the repository's active graph.
 *   3. Otherwise fail with 404 — never fall back to unscoped/global data.
 *
 * A header that is present but malformed is a 400, and a header that names a
 * missing graph is a 404; neither case consults the active graph, because
 * silently re-scoping a request to a graph the caller did not name is the same
 * class of bug as the unscoped fallback. Errors are thrown and rendered by the
 * shared `errorHandler`, so all responses keep the established
 * `{ error: { message, ... } }` shape.
 */
export function resolveGraphContext(
  resolveGraphLookup: GraphLookupResolver = () => getContainer().graphRepository
): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction): void => {
    void (async () => {
      try {
        const lookup = resolveGraphLookup(req);
        const headerValue = req.get(GRAPH_ID_HEADER);

        let graphId: string;
        if (headerValue !== undefined) {
          // Present-but-invalid is a client error. Validate before any lookup so
          // a malformed scope can never reach the active-graph fallback.
          assertSafeGraphId(headerValue);

          const graph = await lookup.findById(headerValue);
          if (!graph) {
            throw new NotFoundError(`Graph '${headerValue}' not found`, 'graph', headerValue);
          }
          graphId = graph.id;
        } else {
          const activeGraph = await lookup.getActiveGraph();
          if (!activeGraph) {
            throw new NotFoundError(
              'No graph context available: send an X-Graph-Id header or activate a graph',
              'graph'
            );
          }
          graphId = activeGraph.id;
        }

        req.graphId = graphId;
        next();
      } catch (error) {
        next(error);
      }
    })();
  };
}

/**
 * Enhanced error handling middleware with structured logging
 */
export function errorHandler(
  error: Error,
  req: RequestWithContainer,
  res: Response,
  // Express identifies an error handler by its arity, so `next` must stay in the
  // signature even though this handler responds directly instead of delegating.
  _next: NextFunction
): void {
  const requestId = req.requestId || 'unknown';
  const duration = req.startTime ? Date.now() - req.startTime : 0;

  // Structured error logging
  const errorLog = {
    requestId,
    timestamp: new Date().toISOString(),
    error: {
      name: error.name,
      message: error.message,
      stack: error.stack
    },
    request: {
      method: req.method,
      url: req.url,
      path: req.path,
      userAgent: req.get('User-Agent'),
      ip: req.ip,
      duration
    },
    level: 'error'
  };

  console.error('Request error:', JSON.stringify(errorLog, null, 2));

  const errorResponse = ErrorHandler.formatErrorResponse(error);

  // body-parser (behind express.json / express.urlencoded) reports a malformed
  // body or an oversized payload as an error carrying a `type` discriminator.
  // Without this mapping those fall through to the generic branch and surface
  // as 500, telling the client the server broke when in fact its request was
  // malformed. Map them to the status codes they actually warrant.
  const bodyParserStatus: Record<string, number> = {
    'entity.parse.failed': 400,
    'entity.too.large': 413,
    'encoding.unsupported': 415
  };
  // body-parser attaches the discriminator to the error itself, not to the
  // formatted response, so read it off the error with a type guard.
  const errorType =
    typeof error === 'object' && error !== null && 'type' in error && typeof error.type === 'string'
      ? error.type
      : undefined;
  const statusCode = (errorType !== undefined ? bodyParserStatus[errorType] : undefined) ?? errorResponse.statusCode;

  res.status(statusCode).json({
    error: {
      message: errorResponse.message,
      details: errorResponse.details,
      timestamp: new Date().toISOString(),
      path: req.path,
      requestId
    }
  });
}

/**
 * 404 handler for unknown routes
 */
export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({
    error: {
      message: `Route ${req.method} ${req.path} not found`,
      timestamp: new Date().toISOString(),
      path: req.path
    }
  });
}

/**
 * Enhanced request logging middleware with structured logging
 */
export function requestLogger(req: RequestWithContainer, res: Response, next: NextFunction): void {
  const requestId = req.requestId || generateRequestId();
  const startTime = Date.now();
  
  // Log request start
  const requestLog = {
    requestId,
    timestamp: new Date().toISOString(),
    request: {
      method: req.method,
      url: req.url,
      path: req.path,
      userAgent: req.get('User-Agent'),
      ip: req.ip,
      contentType: req.get('Content-Type'),
      contentLength: req.get('Content-Length')
    },
    level: 'info',
    type: 'request_start'
  };

  console.log('Request start:', JSON.stringify(requestLog, null, 2));
  
  res.on('finish', () => {
    const duration = Date.now() - startTime;
    
    // Log request completion
    const responseLog = {
      requestId,
      timestamp: new Date().toISOString(),
      request: {
        method: req.method,
        path: req.path
      },
      response: {
        statusCode: res.statusCode,
        contentLength: res.get('Content-Length'),
        duration
      },
      level: res.statusCode >= 400 ? 'warn' : 'info',
      type: 'request_complete'
    };

    console.log('Request complete:', JSON.stringify(responseLog, null, 2));
  });
  
  next();
}

/**
 * Request timeout middleware with enhanced logging
 */
export function requestTimeout(timeoutMs: number = 30000) {
  return (req: RequestWithContainer, res: Response, next: NextFunction): void => {
    const requestId = req.requestId || 'unknown';
    
    const timeout = setTimeout(() => {
      if (!res.headersSent) {
        const timeoutLog = {
          requestId,
          timestamp: new Date().toISOString(),
          request: {
            method: req.method,
            path: req.path,
            timeout: timeoutMs
          },
          level: 'warn',
          type: 'request_timeout'
        };

        console.warn('Request timeout:', JSON.stringify(timeoutLog, null, 2));

        res.status(408).json({
          error: {
            message: 'Request timeout',
            timeout: timeoutMs,
            timestamp: new Date().toISOString(),
            path: req.path,
            requestId
          }
        });
      }
    }, timeoutMs);

    res.on('finish', () => {
      clearTimeout(timeout);
    });

    next();
  };
}

/**
 * Enhanced validation middleware for JSON requests
 */
export function validateJsonRequest(req: RequestWithContainer, res: Response, next: NextFunction): void {
  const requestId = req.requestId || 'unknown';

  if (req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH') {
    if (!req.is('application/json')) {
      const validationLog = {
        requestId,
        timestamp: new Date().toISOString(),
        request: {
          method: req.method,
          path: req.path,
          contentType: req.get('Content-Type')
        },
        error: 'Invalid content type',
        level: 'warn',
        type: 'validation_error'
      };

      console.warn('Validation error:', JSON.stringify(validationLog, null, 2));

      res.status(400).json({
        error: {
          message: 'Content-Type must be application/json',
          timestamp: new Date().toISOString(),
          path: req.path,
          requestId
        }
      });
      return;
    }
  }
  next();
}

/**
 * Authentication middleware - validates API key from X-API-Key header
 */
export function authenticate(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  const requestId = req.requestId || 'unknown';

  // Initialize authentication state
  req.isAuthenticated = false;
  req.apiKey = undefined;

  // Get auth service from container
  let authService;
  try {
    authService = req.container?.authService;
  } catch {
    // Container not initialized yet
  }

  // If auth service not available, skip authentication
  if (!authService) {
    console.warn(`[Auth] Auth service not available, skipping authentication for ${req.path}`);
    next();
    return;
  }

  const apiKeyHeader = req.get('X-API-Key');

  if (!apiKeyHeader) {
    // No API key provided - continue without authentication
    // Protected routes should use requireAuth middleware
    next();
    return;
  }

  // Validate the API key
  authService
    .authenticate(apiKeyHeader)
    .then((result) => {
      if (result.authenticated && result.apiKey) {
        req.isAuthenticated = true;
        req.apiKey = result.apiKey;

        // Log successful authentication
        console.log(`[Auth] Key ${result.apiKey.keyPrefix}... authenticated for ${req.method} ${req.path}`);
      } else {
        console.warn(`[Auth] Invalid API key attempted for ${req.method} ${req.path}: ${result.error}`);
      }
      next();
    })
    .catch((error) => {
      console.error(`[Auth] Authentication error for ${req.method} ${req.path}:`, error);
      res.status(500).json({
        error: {
          message: 'Authentication service error',
          timestamp: new Date().toISOString(),
          path: req.path,
          requestId
        }
      });
    });
}

/**
 * Require authentication middleware - must be used after authenticate()
 */
export function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  const requestId = req.requestId || 'unknown';

  if (!req.isAuthenticated || !req.apiKey) {
    res.status(401).json({
      error: {
        message: 'API key is required',
        timestamp: new Date().toISOString(),
        path: req.path,
        requestId
      }
    });
    return;
  }

  next();
}

/**
 * Authorization middleware - checks if authenticated user has required permissions
 */
export function authorize(...permissions: Permission[]) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    const requestId = req.requestId || 'unknown';

    if (!req.isAuthenticated || !req.apiKey) {
      res.status(401).json({
        error: {
          message: 'Authentication required',
          timestamp: new Date().toISOString(),
          path: req.path,
          requestId
        }
      });
      return;
    }

    // Check if user has all required permissions
    const missingPermissions = permissions.filter((p) => !req.apiKey!.hasPermission(p));

    if (missingPermissions.length > 0) {
      console.warn(
        `[Auth] Key ${req.apiKey.keyPrefix}... missing permissions: ${missingPermissions.join(', ')} for ${req.method} ${req.path}`
      );

      res.status(403).json({
        error: {
          message: `Missing required permissions: ${missingPermissions.join(', ')}`,
          timestamp: new Date().toISOString(),
          path: req.path,
          requestId
        }
      });
      return;
    }

    next();
  };
}

/**
 * Authorize any permission - checks if user has at least one of the specified permissions
 */
export function authorizeAny(...permissions: Permission[]) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    const requestId = req.requestId || 'unknown';

    if (!req.isAuthenticated || !req.apiKey) {
      res.status(401).json({
        error: {
          message: 'Authentication required',
          timestamp: new Date().toISOString(),
          path: req.path,
          requestId
        }
      });
      return;
    }

    // Check if user has any of the required permissions
    if (!req.apiKey.hasAnyPermission(permissions)) {
      console.warn(
        `[Auth] Key ${req.apiKey.keyPrefix}... requires one of: ${permissions.join(', ')} for ${req.method} ${req.path}`
      );

      res.status(403).json({
        error: {
          message: `Requires at least one permission: ${permissions.join(', ')}`,
          timestamp: new Date().toISOString(),
          path: req.path,
          requestId
        }
      });
      return;
    }

    next();
  };
}

/**
 * Graph access middleware - checks if authenticated user can access the specified graph
 */
export function authorizeGraphAccess(getGraphId: (req: AuthenticatedRequest) => string | undefined) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    const requestId = req.requestId || 'unknown';

    if (!req.isAuthenticated || !req.apiKey) {
      res.status(401).json({
        error: {
          message: 'Authentication required',
          timestamp: new Date().toISOString(),
          path: req.path,
          requestId
        }
      });
      return;
    }

    const graphId = getGraphId(req);
    if (!graphId) {
      next();
      return;
    }

    if (!req.apiKey.canAccessGraph(graphId)) {
      console.warn(
        `[Auth] Key ${req.apiKey.keyPrefix}... denied access to graph ${graphId} for ${req.method} ${req.path}`
      );

      res.status(403).json({
        error: {
          message: `Access to graph '${graphId}' is not allowed`,
          timestamp: new Date().toISOString(),
          path: req.path,
          requestId
        }
      });
      return;
    }

    next();
  };
}

/**
 * Rate limiting middleware - enforces rate limits for authenticated requests
 */
export function rateLimit(customConfig?: Partial<RateLimitConfig>) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    const requestId = req.requestId || 'unknown';

    // Get rate limit service from container
    let rateLimitService;
    try {
      rateLimitService = req.container?.rateLimitService;
    } catch {
      // Container not initialized yet
    }

    // Skip rate limiting if service not available
    if (!rateLimitService) {
      next();
      return;
    }

    // Skip rate limiting for unauthenticated requests
    if (!req.isAuthenticated || !req.apiKey) {
      next();
      return;
    }

    const config = customConfig
      ? { ...req.apiKey.rateLimit, ...customConfig }
      : req.apiKey.rateLimit;

    const result = rateLimitService.recordRequest(req.apiKey.id, config);

    // Set rate limit headers
    const headers = rateLimitService.getHeaders(result);
    Object.entries(headers).forEach(([key, value]) => {
      if (value !== undefined) {
        res.setHeader(key, value);
      }
    });

    if (!result.allowed) {
      console.warn(
        `[RateLimit] Key ${req.apiKey.keyPrefix}... exceeded ${result.limit} for ${req.method} ${req.path}`
      );

      res.status(429).json({
        error: {
          message: `Rate limit exceeded: ${result.limit}`,
          retryAfter: result.retryAfter,
          timestamp: new Date().toISOString(),
          path: req.path,
          requestId
        }
      });
      return;
    }

    next();
  };
}

/**
 * Combined auth middleware - authenticate + requireAuth + rateLimit
 */
export function withAuth(...permissions: Permission[]) {
  return [
    authenticate,
    requireAuth,
    rateLimit(),
    ...(permissions.length > 0 ? [authorize(...permissions)] : [])
  ];
}

/**
 * Optional auth middleware - authenticate but don't require it
 */
export function withOptionalAuth() {
  return [authenticate, rateLimit()];
}

/**
 * Generate unique request ID
 */
function generateRequestId(): string {
  return `req_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
}

/**
 * Type-safe async handler wrapper for route handlers
 * Wraps async functions to ensure errors are passed to Express error handler
 */
export function asyncHandler<T extends AuthenticatedRequest = AuthenticatedRequest>(
  fn: (req: T, res: Response, next: NextFunction) => Promise<unknown>
): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(fn(req as T, res, next)).catch(next);
  };
}
