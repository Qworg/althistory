import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import type { FeedbackService } from '@/services/feedback/FeedbackService';

// Each app re-imports the router (the key decision is read when it is built), so
// the service, the errors and the handler come from the same fresh modules.
let FeedbackServiceClass: typeof FeedbackService;
let readFeedbackConfig: typeof import('@/services/feedback/FeedbackService').readFeedbackConfig;

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(16, 1)]);

const authRequired = vi.hoisted(() => ({ value: false }));
vi.mock('@/api/entityAuth', () => ({ entityRoutesRequireApiKey: () => authRequired.value }));

async function freshModules() {
  vi.resetModules();
  const feedback = await import('@/services/feedback/FeedbackService');
  FeedbackServiceClass = feedback.FeedbackService;
  readFeedbackConfig = feedback.readFeedbackConfig;
}

function makeService(env: Record<string, string> = { FEEDBACK_GITHUB_REPO: 'owner/repo', FEEDBACK_GITHUB_TOKEN: 'tok' }) {
  const fetchImpl = vi.fn(async (url: string) => {
    if (url.includes('/contents/')) return new Response('{}', { status: 201 });
    if (url.endsWith('/repos/owner/repo')) return new Response(JSON.stringify({ default_branch: 'main' }), { status: 200 });
    return new Response(JSON.stringify({ number: 7, html_url: 'https://github.com/owner/repo/issues/7' }), { status: 201 });
  });
  return { service: new FeedbackServiceClass(readFeedbackConfig(env), fetchImpl), fetchImpl };
}

async function makeApp(service: FeedbackService) {
  const { createFeedbackRouter } = await import('./feedback');
  const { errorHandler } = await import('@/api/middleware');
  const app = express();
  app.use(express.json({ limit: '10mb' }));
  app.use('/api/feedback', createFeedbackRouter(() => service));
  app.use(errorHandler);
  return app;
}

describe('/api/feedback', () => {
  beforeEach(async () => {
    authRequired.value = false;
    await freshModules();
  });

  it('says whether the server files reports, without a key and without the token', async () => {
    const { service } = makeService();
    const res = await request(await makeApp(service)).get('/api/feedback/config');
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ serverFiling: true, repo: 'owner/repo' });
    expect(JSON.stringify(res.body)).not.toContain('tok');
  });

  it('files a report and answers 201 with the issue', async () => {
    const { service, fetchImpl } = makeService();
    const res = await request(await makeApp(service))
      .post('/api/feedback')
      .send({ kind: 'bug', title: 'Broken', body: 'It broke', screenshot: `data:image/png;base64,${PNG.toString('base64')}` });
    expect(res.status).toBe(201);
    expect(res.body.data).toEqual({ number: 7, url: 'https://github.com/owner/repo/issues/7', screenshotStored: true });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('answers 400 for a malformed report without counting it or calling GitHub', async () => {
    const { service, fetchImpl } = makeService({ FEEDBACK_GITHUB_REPO: 'o/r', FEEDBACK_GITHUB_TOKEN: 't', FEEDBACK_RATE_PER_CLIENT: '1' });
    const app = await makeApp(service);
    const bad = await request(app).post('/api/feedback').send({ kind: 'bug', title: '' });
    expect(bad.status).toBe(400);
    expect(fetchImpl).not.toHaveBeenCalled();
    const good = await request(app).post('/api/feedback').send({ kind: 'bug', title: 'ok' });
    expect(good.status).toBe(201);
  });

  it('answers 429 with Retry-After once a client has sent its quota', async () => {
    const { service } = makeService({ FEEDBACK_GITHUB_REPO: 'o/r', FEEDBACK_GITHUB_TOKEN: 't', FEEDBACK_RATE_PER_CLIENT: '1' });
    const app = await makeApp(service);
    expect((await request(app).post('/api/feedback').send({ kind: 'idea', title: 'one' })).status).toBe(201);
    const second = await request(app).post('/api/feedback').send({ kind: 'idea', title: 'two' });
    expect(second.status).toBe(429);
    expect(Number(second.headers['retry-after'])).toBeGreaterThan(0);
    expect(second.body.error.code).toBe('FEEDBACK_RATE_LIMITED');
  });

  it('answers 503 when the server has no token, so the app uses the GitHub form', async () => {
    const { service, fetchImpl } = makeService({ FEEDBACK_GITHUB_REPO: 'o/r' });
    const res = await request(await makeApp(service)).post('/api/feedback').send({ kind: 'bug', title: 'x' });
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('FEEDBACK_NOT_CONFIGURED');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('answers 502 when GitHub refuses', async () => {
    const service = new FeedbackServiceClass(
      readFeedbackConfig({ FEEDBACK_GITHUB_REPO: 'o/r', FEEDBACK_GITHUB_TOKEN: 'secret' }),
      async () => new Response(JSON.stringify({ message: 'Bad credentials' }), { status: 401 })
    );
    const res = await request(await makeApp(service)).post('/api/feedback').send({ kind: 'bug', title: 'x' });
    expect(res.status).toBe(502);
    expect(JSON.stringify(res.body)).not.toContain('secret');
  });

  it('needs a key to file when the entity routes need one, but not to read the config', async () => {
    authRequired.value = true;
    const { service, fetchImpl } = makeService();
    const app = await makeApp(service);
    expect((await request(app).get('/api/feedback/config')).status).toBe(200);
    const res = await request(app).post('/api/feedback').send({ kind: 'bug', title: 'x' });
    expect(res.status).toBe(401);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('/api/feedback, after the first review', () => {
  beforeEach(async () => {
    authRequired.value = false;
    await freshModules();
  });

  it('counts reports per address, not per key, because the app shares one key', async () => {
    const { clientOf } = await import('./feedback');
    const visitor = (ip: string) => ({ ip, socket: {}, apiKey: { id: 'the-app-key' } }) as never;
    expect(clientOf(visitor('203.0.113.1'))).toBe('ip:203.0.113.1');
    expect(clientOf(visitor('203.0.113.2'))).not.toBe(clientOf(visitor('203.0.113.1')));
  });

  it('answers FEEDBACK_MAYBE_FILED when GitHub may have filed it', async () => {
    const service = new FeedbackServiceClass(
      readFeedbackConfig({ FEEDBACK_GITHUB_REPO: 'o/r', FEEDBACK_GITHUB_TOKEN: 't' }),
      async () => new Response('{}', { status: 504 })
    );
    const res = await request(await makeApp(service)).post('/api/feedback').send({ kind: 'bug', title: 'x' });
    expect(res.status).toBe(502);
    expect(res.body.error.code).toBe('FEEDBACK_MAYBE_FILED');
  });

  it('sends Retry-After when GitHub is limiting the token', async () => {
    const service = new FeedbackServiceClass(
      readFeedbackConfig({ FEEDBACK_GITHUB_REPO: 'o/r', FEEDBACK_GITHUB_TOKEN: 't' }),
      async () =>
        new Response(JSON.stringify({ message: 'limit' }), { status: 429, headers: { 'retry-after': '30' } })
    );
    const res = await request(await makeApp(service)).post('/api/feedback').send({ kind: 'bug', title: 'x' });
    expect(res.status).toBe(503);
    expect(res.headers['retry-after']).toBe('30');
  });
});
