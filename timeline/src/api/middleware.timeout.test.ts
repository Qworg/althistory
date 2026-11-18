/**
 * The request budget and the error handler's behaviour once a response has
 * already gone out. A Wikipedia crawl outlived the 2 s query budget: the
 * timeout answered 408, the crawl failed later, and the error handler then
 * threw "Cannot set headers after they are sent".
 */

import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import express, { NextFunction, Request, Response } from 'express';
import { errorHandler, rateLimit, requestTimeout } from './middleware';
import { RequestCancelledError, checkpoint } from '@/utils/requestBudget';

function slowApp(delayMs: number, fail: boolean): express.Application {
  const app = express();
  app.use(requestTimeout(50, { '/api/ingest': 1000 }));
  const slow = (_req: Request, res: Response, next: NextFunction): void => {
    // A late failure goes to next(), as asyncHandler routes it; a late success
    // checks headersSent itself, as only the error path is under test here.
    setTimeout(() => {
      if (fail) next(new Error('upstream failed late'));
      else if (!res.headersSent) res.json({ ok: true });
    }, delayMs);
  };
  app.post('/api/ingest/url', slow);
  app.post('/api/events', slow);
  app.use(errorHandler);
  return app;
}

describe('requestTimeout', () => {
  it('gives an overridden prefix its own budget', async () => {
    const response = await request(slowApp(150, false)).post('/api/ingest/url');
    expect(response.status).toBe(200);
  });

  it('keeps the default budget everywhere else', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const response = await request(slowApp(150, false)).post('/api/events');
    expect(response.status).toBe(408);
    warn.mockRestore();
  });
});

describe('errorHandler after a response was sent', () => {
  it('logs the late error and does not try to send a second response', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = {
      headersSent: true,
      status: vi.fn(() => {
        throw new Error('Cannot set headers after they are sent to the client');
      }),
      json: vi.fn(),
    } as unknown as Response;
    const req = { path: '/api/ingest/url', url: '/api/ingest/url', method: 'POST', get: () => undefined } as unknown as Request;

    expect(() => errorHandler(new Error('upstream failed late'), req, res, vi.fn() as unknown as NextFunction)).not.toThrow();
    expect(res.status).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith('Request error:', expect.stringContaining('upstream failed late'));
    error.mockRestore();
  });
});

describe('a request that timed out is cancelled, not left running', () => {
  const lateApp = (handler: (req: Request, res: Response, next: NextFunction) => void, before?: express.RequestHandler): express.Application => {
    const app = express();
    app.use(requestTimeout(50));
    if (before) app.use(before);
    app.post('/api/events', handler);
    app.use(errorHandler);
    return app;
  };
  const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

  it('hands a route a signal that fires before the 408, and refuses its write at the checkpoint', async () => {
    const store: string[] = [];
    const logged: string[] = [];
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error').mockImplementation((...args) => void logged.push(args.join(' ')));
    const seen: boolean[] = [];
    const app = lateApp(async (_req, res, next) => {
      await wait(150);
      seen.push((res.locals.signal as AbortSignal).aborted);
      try {
        checkpoint(); // what every store does before it makes a change durable
        store.push('written');
        res.status(201).json({ ok: true });
      } catch (e) {
        next(e);
      }
    });

    const response = await request(app).post('/api/events');
    await wait(200);

    expect(response.status).toBe(408);
    expect(seen).toEqual([true]);
    expect(store).toEqual([]);
    expect(logged.filter((line) => line.includes('Cannot set headers') || line.includes('Request error'))).toEqual([]);
    warn.mockRestore();
    error.mockRestore();
  });

  it('keeps a route that ignores the signal from writing to the sent response', async () => {
    const logged: string[] = [];
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error').mockImplementation((...args) => void logged.push(args.join(' ')));
    let threw: unknown;
    const app = lateApp(async (_req, res) => {
      await wait(150);
      try {
        res.status(201).json({ late: true });
      } catch (e) {
        threw = e;
      }
    });

    const response = await request(app).post('/api/events');
    await wait(200);

    expect(response.status).toBe(408);
    expect(threw).toBeUndefined();
    expect(logged.filter((line) => line.includes('Cannot set headers'))).toEqual([]);
    warn.mockRestore();
    error.mockRestore();
  });

  it('does not count a request against its key when the 408 went out before the limiter ran', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const recordRequest = vi.fn(() => ({ allowed: true, limit: '1/minute', remaining: 0, resetAt: Date.now() + 1000 }));
    const getHeaders = vi.fn(() => ({}));
    const app = express();
    app.use(requestTimeout(50));
    app.use((req, _res, next) => {
      Object.assign(req, {
        container: { rateLimitService: { recordRequest, getHeaders } },
        isAuthenticated: true,
        apiKey: { id: 'k', keyPrefix: 'ak_', rateLimit: { requestsPerMinute: 1, requestsPerHour: 1, requestsPerDay: 1 } },
      });
      setTimeout(next, 150);
    });
    app.post('/api/events', rateLimit(), (_req, res) => res.json({ ok: true }));
    app.use(errorHandler);

    const response = await request(app).post('/api/events');
    await wait(200);

    expect(response.status).toBe(408);
    expect(recordRequest).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('treats the cancellation that follows a 408 as the answer, not as an error to log', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = { headersSent: true, locals: {}, status: vi.fn(), json: vi.fn() } as unknown as Response;
    const req = { path: '/api/events', url: '/api/events', method: 'POST', get: () => undefined } as unknown as Request;
    errorHandler(new RequestCancelledError(), req, res, vi.fn() as unknown as NextFunction);
    expect(error).not.toHaveBeenCalled();
    error.mockRestore();
  });
});
