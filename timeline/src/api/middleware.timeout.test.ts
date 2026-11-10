/**
 * The request budget and the error handler's behaviour once a response has
 * already gone out. A Wikipedia crawl outlived the 2 s query budget: the
 * timeout answered 408, the crawl failed later, and the error handler then
 * threw "Cannot set headers after they are sent".
 */

import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import express, { NextFunction, Request, Response } from 'express';
import { errorHandler, requestTimeout } from './middleware';

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
