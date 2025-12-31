import { Request, Response, NextFunction } from 'express';
import { AppError, ErrorHandler } from '@/utils/errors';
import { getContainer } from '@/container';

/**
 * Extended Request interface with container access
 */
export interface RequestWithContainer extends Request {
  container: ReturnType<typeof getContainer>;
  requestId: string;
  startTime: number;
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
    next(new AppError('Service container not available', 503, 'CONTAINER_UNAVAILABLE'));
  }
}

/**
 * Enhanced error handling middleware with structured logging
 */
export function errorHandler(
  error: Error,
  req: RequestWithContainer,
  res: Response,
  next: NextFunction
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
  
  res.status(errorResponse.statusCode).json({
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
 * Authentication middleware (placeholder for future implementation)
 */
export function authenticate(req: RequestWithContainer, res: Response, next: NextFunction): void {
  // TODO: Implement authentication logic
  // For now, we'll just pass through
  next();
}

/**
 * Authorization middleware (placeholder for future implementation)
 */
export function authorize(permissions: string[]) {
  return (req: RequestWithContainer, res: Response, next: NextFunction): void => {
    // TODO: Implement authorization logic
    // For now, we'll just pass through
    next();
  };
}

/**
 * Rate limiting middleware (placeholder for future implementation)
 */
export function rateLimit(options: { windowMs: number; max: number }) {
  return (req: RequestWithContainer, res: Response, next: NextFunction): void => {
    // TODO: Implement rate limiting logic using Redis
    // For now, we'll just pass through
    next();
  };
}

/**
 * Generate unique request ID
 */
function generateRequestId(): string {
  return `req_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
}