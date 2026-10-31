import { describe, it, expect } from 'vitest';
import request from 'supertest';
import express from 'express';
import { createJsonBodyParser } from '@/index';
import { errorHandler } from '@/api/middleware';

/**
 * The body parser the application really mounts, behind the real error
 * handler. Route tests build their own `express.json()`, so they never saw
 * that the application's parser answered a malformed or empty JSON body with
 * a 500.
 */
function app() {
  const server = express();
  server.use(createJsonBodyParser());
  server.post('/echo', (req, res) => {
    res.status(200).json({ body: req.body });
  });
  server.use(errorHandler);
  return server;
}

describe('the application JSON body parser', () => {
  it('answers a malformed JSON body with 400, not 500', async () => {
    const response = await request(app())
      .post('/echo')
      .set('Content-Type', 'application/json')
      .send('{ not json')
      .expect(400);
    expect(response.body.error).toBeDefined();
  });

  it('accepts a JSON POST with an empty body', async () => {
    const response = await request(app())
      .post('/echo')
      .set('Content-Type', 'application/json')
      .send('')
      .expect(200);
    expect(response.body.body).toEqual({});
  });

  it('parses a well-formed body', async () => {
    const response = await request(app()).post('/echo').send({ a: 1 }).expect(200);
    expect(response.body.body).toEqual({ a: 1 });
  });
});
