import { describe, it, expect } from 'vitest';
import request from 'supertest';
import express from 'express';
import { validateJsonRequest } from '@/api/middleware';
import { createJsonBodyParser } from '@/index';

/**
 * `validateJsonRequest` refuses a body that is not JSON. It used to refuse a
 * POST with no body at all, because such a request has no Content-Type: the
 * UI's graph switch (`POST /graphs/:id/activate`) and rollback are bodiless,
 * axios sends them without a Content-Type, and both failed with 400.
 */
function app() {
  const server = express();
  server.use(createJsonBodyParser());
  server.use(validateJsonRequest as express.RequestHandler);
  server.post('/action', (_req, res) => {
    res.status(200).json({ ok: true });
  });
  return server;
}

describe('validateJsonRequest', () => {
  it('accepts a bodiless POST without a Content-Type', async () => {
    await request(app()).post('/action').expect(200);
  });

  it('accepts a JSON body', async () => {
    await request(app()).post('/action').send({ a: 1 }).expect(200);
  });

  it('still refuses a body that is not JSON', async () => {
    const response = await request(app())
      .post('/action')
      .set('Content-Type', 'text/plain')
      .send('hello')
      .expect(400);
    expect(response.body.error.message).toBe('Content-Type must be application/json');
  });
});
