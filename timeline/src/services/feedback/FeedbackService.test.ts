import { describe, it, expect, vi } from 'vitest';
import {
  FeedbackMaybeFiledError,
  FeedbackRateLimiter,
  FeedbackService,
  neutralizeGitHubReferences,
  readFeedbackConfig,
  readFeedbackReport,
  readScreenshot,
  type FeedbackConfig,
} from './FeedbackService';
import { UpstreamServiceError, ValidationError } from '@/utils/errors';

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(16, 1)]);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(16, 2)]);
const pngUrl = `data:image/png;base64,${PNG.toString('base64')}`;
const ZWSP = '\u200B';

function config(overrides: Partial<FeedbackConfig> = {}): FeedbackConfig {
  return {
    ...readFeedbackConfig({ FEEDBACK_GITHUB_REPO: 'owner/repo', FEEDBACK_GITHUB_TOKEN: 'secret-token' }),
    ...overrides,
  };
}

/** A fake GitHub: answers by "METHOD path", records every call. */
function fakeGitHub(routes: Record<string, (body: any) => { status: number; json?: unknown; headers?: Record<string, string> }>) {
  const calls: Array<{ method: string; path: string; body: any; headers: Record<string, string> }> = [];
  const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
    const path = url.replace('https://api.github.com', '');
    const method = init.method ?? 'GET';
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, path, body, headers: init.headers as Record<string, string> });
    const key = Object.keys(routes).find((pattern) => {
      const [m, p] = pattern.split(' ');
      return m === method && (p === path || (p?.endsWith('*') && path.startsWith(p.slice(0, -1))));
    });
    const answer = key ? routes[key]!(body) : { status: 404, json: { message: 'Not Found' } };
    return new Response(answer.json === undefined ? null : JSON.stringify(answer.json), {
      status: answer.status,
      headers: answer.headers,
    });
  });
  return { calls, fetchImpl };
}

describe('neutralizeGitHubReferences', () => {
  it('stops mentions and issue references without changing what the text reads', () => {
    const out = neutralizeGitHubReferences('ping @octocat and @org/team about #12, other/repo#3, GH-4 and https://github.com/a/b/issues/9');
    expect(out).toBe(
      `ping @${ZWSP}octocat and @${ZWSP}org/team about #${ZWSP}12, other/repo#${ZWSP}3, GH-${ZWSP}4 and https://github.com/a/b/issues/${ZWSP}9`
    );
    expect(out.replace(/\u200B/g, '')).toBe(
      'ping @octocat and @org/team about #12, other/repo#3, GH-4 and https://github.com/a/b/issues/9'
    );
  });

  it('leaves headings and non-numeric hashes alone, and an email address reads the same', () => {
    const text = '## Heading\ncolour #fff and pull/requests';
    expect(neutralizeGitHubReferences(text)).toBe(text);
    expect(neutralizeGitHubReferences('mail jo@example.com')).toBe(`mail jo@${ZWSP}example.com`);
  });

  it('catches a mention at the start of a line and after punctuation', () => {
    expect(neutralizeGitHubReferences('@a\n(@b)')).toBe(`@${ZWSP}a\n(@${ZWSP}b)`);
  });

  it('catches pull-request URLs and discussions', () => {
    expect(neutralizeGitHubReferences('github.com/a/b/pull/7 github.com/a/b/discussions/8')).toBe(
      `github.com/a/b/pull/${ZWSP}7 github.com/a/b/discussions/${ZWSP}8`
    );
  });
});

describe('readScreenshot', () => {
  it('reads a PNG data URL', () => {
    expect(readScreenshot(pngUrl)).toEqual({ bytes: PNG, type: 'png' });
  });

  it('treats an absent screenshot as none', () => {
    expect(readScreenshot(undefined)).toBeUndefined();
    expect(readScreenshot('')).toBeUndefined();
    expect(readScreenshot(null)).toBeUndefined();
  });

  it('refuses bytes that are not the type the URL claims', () => {
    expect(() => readScreenshot(`data:image/png;base64,${JPEG.toString('base64')}`)).toThrow(ValidationError);
    expect(() => readScreenshot(`data:image/png;base64,${Buffer.from('<svg/>').toString('base64')}`)).toThrow(
      /not a png/
    );
  });

  it('refuses SVG, other schemes and non-base64 data', () => {
    expect(() => readScreenshot('data:image/svg+xml;base64,PHN2Zy8+')).toThrow(ValidationError);
    expect(() => readScreenshot('https://example.com/a.png')).toThrow(ValidationError);
    expect(() => readScreenshot('data:image/png;base64,not base64!')).toThrow(ValidationError);
    expect(() => readScreenshot(42)).toThrow(ValidationError);
  });

  it('refuses a screenshot over 2 MB without decoding it', () => {
    const big = `data:image/png;base64,${'A'.repeat(Math.ceil((2 * 1024 * 1024 + 10) / 3) * 4)}`;
    const from = vi.spyOn(Buffer, 'from');
    expect(() => readScreenshot(big)).toThrow(/larger than 2 MB/);
    expect(from).not.toHaveBeenCalled();
    from.mockRestore();
  });
});

describe('readFeedbackReport', () => {
  it('collapses the title to one line and keeps the body as written', () => {
    expect(readFeedbackReport({ kind: 'bug', title: '  Timeline\n  breaks ', body: 'a\n\nb' })).toEqual({
      kind: 'bug',
      title: 'Timeline breaks',
      body: 'a\n\nb',
    });
  });

  it.each([
    [null, /JSON object/],
    [[], /JSON object/],
    [{ kind: 'spam', title: 'x' }, /kind must be/],
    [{ kind: 'bug' }, /title is required/],
    [{ kind: 'bug', title: '   ' }, /title is required/],
    [{ kind: 'bug', title: 'x'.repeat(201) }, /title is longer/],
    [{ kind: 'bug', title: 'x', body: 5 }, /body must be text/],
    [{ kind: 'bug', title: 'x', body: 'y'.repeat(60_001) }, /body is longer/],
  ])('refuses %j', (input, message) => {
    expect(() => readFeedbackReport(input)).toThrow(message);
  });
});

describe('readFeedbackConfig', () => {
  it('is off with nothing set', () => {
    const cfg = readFeedbackConfig({});
    expect(cfg.repo).toBeNull();
    expect(cfg.token).toBeNull();
    expect(cfg.problem).toBeUndefined();
    expect(new FeedbackService(cfg).publicConfig()).toEqual({ serverFiling: false, repo: null });
  });

  it('names the repository without a token, so the app can send people to its form', () => {
    expect(new FeedbackService(readFeedbackConfig({ FEEDBACK_GITHUB_REPO: 'a/b' })).publicConfig()).toEqual({
      serverFiling: false,
      repo: 'a/b',
    });
  });

  it('does not file with a token and no repository, and says why', () => {
    const cfg = readFeedbackConfig({ FEEDBACK_GITHUB_TOKEN: 't' });
    expect(cfg.token).toBeNull();
    expect(cfg.problem).toMatch(/FEEDBACK_GITHUB_REPO is not/);
  });

  it('refuses a repository that is not owner/name, and a bad branch', () => {
    const cfg = readFeedbackConfig({
      FEEDBACK_GITHUB_REPO: 'https://github.com/a/b',
      FEEDBACK_GITHUB_TOKEN: 't',
      FEEDBACK_SCREENSHOT_BRANCH: '../main',
    });
    expect(cfg.repo).toBeNull();
    expect(cfg.token).toBeNull();
    expect(cfg.screenshotBranch).toBe('feedback-screenshots');
    expect(cfg.problem).toMatch(/owner\/name/);
  });

  it('reads labels and limits, ignoring nonsense numbers', () => {
    const cfg = readFeedbackConfig({ FEEDBACK_LABELS: 'feedback, from-app,,', FEEDBACK_RATE_PER_CLIENT: '2', FEEDBACK_RATE_GLOBAL: '-1' });
    expect(cfg.labels).toEqual(['feedback', 'from-app']);
    expect(cfg.perClient.max).toBe(2);
    expect(cfg.global.max).toBe(30);
  });

  it('never puts the token in the public config', () => {
    const service = new FeedbackService(config());
    expect(JSON.stringify(service.publicConfig())).not.toContain('secret-token');
  });
});

describe('FeedbackRateLimiter', () => {
  it('allows a client its quota per window, then says when to retry', () => {
    let now = 0;
    const limiter = new FeedbackRateLimiter({ max: 2, windowMs: 60_000 }, { max: 100, windowMs: 3_600_000 }, () => now);
    expect(limiter.take('a').allowed).toBe(true);
    now = 10_000;
    expect(limiter.take('a').allowed).toBe(true);
    now = 20_000;
    expect(limiter.take('a')).toEqual({ allowed: false, retryAfterSeconds: 40 });
    expect(limiter.take('b').allowed).toBe(true);
    now = 60_000;
    expect(limiter.take('a').allowed).toBe(true);
  });

  it('caps all clients together', () => {
    let now = 0;
    const limiter = new FeedbackRateLimiter({ max: 5, windowMs: 60_000 }, { max: 2, windowMs: 3_600_000 }, () => now);
    expect(limiter.take('a').allowed).toBe(true);
    expect(limiter.take('b').allowed).toBe(true);
    now = 1000;
    expect(limiter.take('c')).toEqual({ allowed: false, retryAfterSeconds: 3599 });
  });

  it('does not count a refused report', () => {
    let now = 0;
    const limiter = new FeedbackRateLimiter({ max: 1, windowMs: 1000 }, { max: 100, windowMs: 1000 }, () => now);
    limiter.take('a');
    now = 500;
    limiter.take('a');
    limiter.take('a');
    now = 1000;
    expect(limiter.take('a').allowed).toBe(true);
  });
});

describe('FeedbackService.file', () => {
  const issueCreated = () => ({ status: 201, json: { number: 50, html_url: 'https://github.com/owner/repo/issues/50' } });
  const defaultBranchMain = () => ({ status: 200, json: { default_branch: 'main' } });

  it('files the issue with the kind label, the configured labels and a neutralised body', async () => {
    const github = fakeGitHub({ 'POST /repos/owner/repo/issues': issueCreated });
    const service = new FeedbackService(config(), github.fetchImpl);

    const issue = await service.file({ kind: 'bug', title: 'Fix @someone #1', body: 'cc @maintainer' });

    expect(issue).toEqual({ number: 50, url: 'https://github.com/owner/repo/issues/50', screenshotStored: true });
    const sent = github.calls[0]!;
    expect(sent.headers.Authorization).toBe('Bearer secret-token');
    expect(sent.body.labels).toEqual(['bug', 'feedback']);
    expect(sent.body.title).toBe(`Fix @${ZWSP}someone #${ZWSP}1`);
    expect(sent.body.body).toContain(`cc @${ZWSP}maintainer`);
    expect(sent.body.body).toContain('filed by the server');
    expect(sent.body.body).not.toContain('### Screenshot');
  });

  it('labels an idea as an enhancement, and other with the configured labels only', async () => {
    const github = fakeGitHub({ 'POST /repos/owner/repo/issues': issueCreated });
    const service = new FeedbackService(config(), github.fetchImpl);
    await service.file({ kind: 'idea', title: 'x', body: '' });
    await service.file({ kind: 'other', title: 'y', body: '' });
    expect(github.calls.map((c) => c.body.labels)).toEqual([['enhancement', 'feedback'], ['feedback']]);
  });

  it('commits the screenshot to its branch and links it from the issue', async () => {
    const github = fakeGitHub({
      'GET /repos/owner/repo': defaultBranchMain,
      'PUT /repos/owner/repo/contents/*': () => ({ status: 201, json: {} }),
      'POST /repos/owner/repo/issues': issueCreated,
    });
    const service = new FeedbackService(config(), github.fetchImpl);

    await service.file({ kind: 'bug', title: 'x', body: 'b', screenshot: { bytes: PNG, type: 'png' } });

    const put = github.calls.find((c) => c.method === 'PUT')!;
    expect(put.method).toBe('PUT');
    expect(put.path).toMatch(/^\/repos\/owner\/repo\/contents\/feedback\/\d{4}-\d{2}\/[0-9a-f-]{36}\.png$/);
    expect(put.body).toMatchObject({ branch: 'feedback-screenshots', content: PNG.toString('base64') });
    const file = put.path.replace('/repos/owner/repo/contents/', '');
    expect(github.calls.at(-1)!.body.body).toContain(
      `![Screenshot of the app when the report was opened](https://github.com/owner/repo/blob/feedback-screenshots/${file}?raw=true)`
    );
  });

  it('creates the screenshot branch from the default branch when it is missing', async () => {
    let branchExists = false;
    const github = fakeGitHub({
      'PUT /repos/owner/repo/contents/*': () =>
        branchExists ? { status: 201, json: {} } : { status: 404, json: { message: 'Branch feedback-screenshots not found' } },
      'GET /repos/owner/repo/git/ref/heads/main': () => ({ status: 200, json: { object: { sha: 'abc123' } } }),
      'GET /repos/owner/repo': () => ({ status: 200, json: { default_branch: 'main' } }),
      'POST /repos/owner/repo/git/refs': () => {
        branchExists = true;
        return { status: 201, json: {} };
      },
      'POST /repos/owner/repo/issues': issueCreated,
    });
    const service = new FeedbackService(config(), github.fetchImpl);

    const issue = await service.file({ kind: 'bug', title: 'x', body: '', screenshot: { bytes: PNG, type: 'png' } });

    expect(issue.screenshotStored).toBe(true);
    expect(github.calls.find((c) => c.path === '/repos/owner/repo/git/refs')?.body).toEqual({
      ref: 'refs/heads/feedback-screenshots',
      sha: 'abc123',
    });
    expect(github.calls.filter((c) => c.method === 'PUT')).toHaveLength(2);
  });

  it('still files the issue when the screenshot cannot be stored, and says so', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const github = fakeGitHub({
      'GET /repos/owner/repo': defaultBranchMain,
      'PUT /repos/owner/repo/contents/*': () => ({ status: 403, json: { message: 'Resource not accessible' } }),
      'POST /repos/owner/repo/issues': issueCreated,
    });
    const service = new FeedbackService(config(), github.fetchImpl);

    const issue = await service.file({ kind: 'bug', title: 'x', body: '', screenshot: { bytes: PNG, type: 'png' } });

    expect(issue.screenshotStored).toBe(false);
    expect(github.calls.at(-1)!.body.body).toContain('the server could not store it');
    warn.mockRestore();
  });

  it('answers 502 when GitHub refuses the issue, naming the status but not the token', async () => {
    const github = fakeGitHub({
      'POST /repos/owner/repo/issues': () => ({ status: 401, json: { message: 'Bad credentials' } }),
    });
    const service = new FeedbackService(config(), github.fetchImpl);

    const error = await service.file({ kind: 'bug', title: 'x', body: '' }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(UpstreamServiceError);
    expect((error as UpstreamServiceError).statusCode).toBe(502);
    expect((error as Error).message).toContain('401: Bad credentials');
    expect((error as Error).message).not.toContain('secret-token');
  });

  it('answers 503 with Retry-After when GitHub is limiting the token', async () => {
    const github = fakeGitHub({
      'POST /repos/owner/repo/issues': () => ({
        status: 403,
        json: { message: 'API rate limit exceeded' },
        headers: { 'x-ratelimit-remaining': '0', 'retry-after': '60' },
      }),
    });
    const error = (await new FeedbackService(config(), github.fetchImpl)
      .file({ kind: 'bug', title: 'x', body: '' })
      .catch((e: unknown) => e)) as UpstreamServiceError;
    expect(error.statusCode).toBe(503);
    expect(error.retryAfterSeconds).toBe(60);
  });

  it('refuses to file when it has no token', async () => {
    const fetchImpl = vi.fn();
    const service = new FeedbackService(readFeedbackConfig({ FEEDBACK_GITHUB_REPO: 'a/b' }), fetchImpl);
    await expect(service.file({ kind: 'bug', title: 'x', body: '' })).rejects.toThrow(/does not file/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('first review: what got through', () => {
  const issueCreated = () => ({ status: 201, json: { number: 50, html_url: 'https://github.com/owner/repo/issues/50' } });

  it.each([
    ['a mention right after a code span', '`x`@octocat', `\`x\`@${ZWSP}octocat`],
    ['a mention after emphasis', '_a_@octocat', `_a_@${ZWSP}octocat`],
    ['a reference without its semicolon in an HTML block', '<div>&amp@octocat</div>', `<div>&${ZWSP}amp@${ZWSP}octocat</div>`],
    ['&#x40;', '&#x40;octocat', `&${ZWSP}#x40;octocat`],
    ['&commat;', '&commat;octocat', `&${ZWSP}commat;octocat`],
    ['a digit written as a reference', '#&#x31;', `#&${ZWSP}#x31;`],
    ['a slash written as a reference', 'github.com/o/r/pull&#x2F;1', `github.com/o/r/pull&${ZWSP}#x2F;1`],
    ['a reference that builds another', '&&&#35;x23;x40;octocat', `&${ZWSP}&${ZWSP}&${ZWSP}#${ZWSP}35;x23;x40;octocat`],
    ['a commit reference', 'o/r@7fd1a60 and github.com/o/r/commit/7fd1a60', `o/r@${ZWSP}7fd1a60 and github.com/o/r/commit/${ZWSP}7fd1a60`],
  ])('neutralises %s', (_name, input, expected) => {
    expect(neutralizeGitHubReferences(input)).toBe(expected);
  });

  /** A small seeded generator: strings built from the pieces references are made of. */
  function randomTexts(count: number, seed = 49): string[] {
    const pieces = ['@', '#', '&', ';', 'x', '4', '0', '2', '3', '1', '9', '_', '`', '*', '<', '>', '/', 'div', 'issues/', 'pull/',
      'GH-', 'gh-', 'amp', 'commat', 'num', '#x', '#6', 'octocat', 'a', ' ', '\n', '-', '.', 'é', '\\'];
    let state = seed;
    const next = () => (state = (state * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
    return Array.from({ length: count }, () =>
      Array.from({ length: 1 + Math.floor(next() * 24) }, () => pieces[Math.floor(next() * pieces.length)]).join('')
    );
  }

  it('over 20,000 random texts: no live @name, #digit, GH-digit or character reference is left, twice is once, and the text reads the same', () => {
    for (const text of randomTexts(20_000)) {
      const once = neutralizeGitHubReferences(text);
      expect(neutralizeGitHubReferences(once)).toBe(once);
      expect(once.replace(/\u200B/g, '')).toBe(text);
      expect(once).not.toMatch(/@[A-Za-z0-9_-]/);
      expect(once).not.toMatch(/#\d/);
      expect(once).not.toMatch(/GH-\d/i);
      expect(once).not.toMatch(/&(?!\u200B)/);
    }
  });

  it('is idempotent, so neutralising twice changes nothing', () => {
    const once = neutralizeGitHubReferences('@a #1 &#64;b GH-2 x/y/issues/3 &&&#35;x23;');
    expect(neutralizeGitHubReferences(once)).toBe(once);
  });

  it('takes a full 200-character title with references in it (the room is GitHub’s 256)', () => {
    const title = '#1'.repeat(20) + 'x'.repeat(160);
    expect(title).toHaveLength(200);
    expect(readFeedbackReport({ kind: 'bug', title }).title).toHaveLength(220);
  });

  it('measures the title and body as they will be filed', () => {
    expect(() => readFeedbackReport({ kind: 'bug', title: '&'.repeat(200) })).toThrow(/too many @, # and &/);
    expect(() => readFeedbackReport({ kind: 'bug', title: 'x'.repeat(201) })).toThrow(/title is longer/);
    expect(() => readFeedbackReport({ kind: 'bug', title: 'x', body: '&'.repeat(40_000) })).toThrow(/too many @, # and &/);
    expect(readFeedbackReport({ kind: 'bug', title: 'see #1', body: '@a' })).toMatchObject({
      title: `see #${ZWSP}1`,
      body: `@${ZWSP}a`,
    });
  });

  it.each(['../..', 'x/..', './x'])('refuses the repository %s', (repo) => {
    const cfg = readFeedbackConfig({ FEEDBACK_GITHUB_REPO: repo, FEEDBACK_GITHUB_TOKEN: 't' });
    expect(cfg.repo).toBeNull();
    expect(cfg.token).toBeNull();
  });

  it('refuses a token with a line break or space, without repeating it', () => {
    const cfg = readFeedbackConfig({ FEEDBACK_GITHUB_REPO: 'a/b', FEEDBACK_GITHUB_TOKEN: 'ghp_SECRET\nX-Evil: 1' });
    expect(cfg.token).toBeNull();
    expect(cfg.problem).toMatch(/control characters/);
    expect(cfg.problem).not.toContain('SECRET');
  });

  it('never commits a screenshot to the default branch, but still files the issue', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const github = fakeGitHub({
      'GET /repos/owner/repo': () => ({ status: 200, json: { default_branch: 'main' } }),
      'POST /repos/owner/repo/issues': issueCreated,
    });
    const service = new FeedbackService(config({ screenshotBranch: 'main' }), github.fetchImpl);
    const issue = await service.file({ kind: 'bug', title: 'x', body: '', screenshot: { bytes: PNG, type: 'png' } });
    expect(issue.screenshotStored).toBe(false);
    expect(github.calls.some((c) => c.method === 'PUT')).toBe(false);
    warn.mockRestore();
  });

  it('links the screenshot where GitHub says it is (GitHub Enterprise too), and asks the default branch once', async () => {
    const github = fakeGitHub({
      'GET /repos/owner/repo': () => ({ status: 200, json: { default_branch: 'main' } }),
      'PUT /repos/owner/repo/contents/*': () => ({
        status: 201,
        json: { content: { html_url: 'https://ghe.example/owner/repo/blob/feedback-screenshots/feedback/a.png' } },
      }),
      'POST /repos/owner/repo/issues': issueCreated,
    });
    const service = new FeedbackService(config({ apiBase: 'https://api.github.com' }), github.fetchImpl);
    await service.file({ kind: 'bug', title: 'x', body: '', screenshot: { bytes: PNG, type: 'png' } });
    await service.file({ kind: 'bug', title: 'y', body: '', screenshot: { bytes: PNG, type: 'png' } });
    expect(github.calls.at(-1)!.body.body).toContain('(https://ghe.example/owner/repo/blob/feedback-screenshots/feedback/a.png?raw=true)');
    expect(github.calls.filter((c) => c.path === '/repos/owner/repo')).toHaveLength(1);
  });

  it('retries a screenshot once when another report moved the branch (409)', async () => {
    let puts = 0;
    const github = fakeGitHub({
      'GET /repos/owner/repo': () => ({ status: 200, json: { default_branch: 'main' } }),
      'PUT /repos/owner/repo/contents/*': () => (++puts === 1 ? { status: 409, json: { message: 'conflict' } } : { status: 201, json: {} }),
      'POST /repos/owner/repo/issues': issueCreated,
    });
    const issue = await new FeedbackService(config(), github.fetchImpl).file({
      kind: 'bug',
      title: 'x',
      body: '',
      screenshot: { bytes: PNG, type: 'png' },
    });
    expect(issue.screenshotStored).toBe(true);
    expect(puts).toBe(2);
  });

  it.each([
    ['times out', async () => Promise.reject(new DOMException('The operation was aborted due to timeout', 'TimeoutError'))],
    ['answers 502', async () => new Response('{}', { status: 502 })],
    ['answers 201 with no readable body', async () => new Response('not json', { status: 201 })],
    ['answers 201 without the issue', async () => new Response('{}', { status: 201 })],
  ])('says the issue may have been filed when GitHub %s', async (_name, answer) => {
    const service = new FeedbackService(config(), answer as unknown as (url: string, init: RequestInit) => Promise<Response>);
    const error = await service.file({ kind: 'bug', title: 'x', body: '' }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(FeedbackMaybeFiledError);
  });

  it('keeps every call inside the report’s budget, giving the issue at least one call’s time', async () => {
    vi.useFakeTimers();
    try {
      const timeouts: number[] = [];
      const timeout = vi.spyOn(AbortSignal, 'timeout').mockImplementation((ms: number) => {
        timeouts.push(ms);
        return new AbortController().signal;
      });
      const github = fakeGitHub({
        'GET /repos/owner/repo': () => {
          vi.advanceTimersByTime(30_000);
          return { status: 200, json: { default_branch: 'main' } };
        },
        'PUT /repos/owner/repo/contents/*': () => ({ status: 201, json: {} }),
        'POST /repos/owner/repo/issues': issueCreated,
      });
      await new FeedbackService(config(), github.fetchImpl).file({
        kind: 'bug',
        title: 'x',
        body: '',
        screenshot: { bytes: PNG, type: 'png' },
      });
      // 35 s in all: the repository read had 10, the PUT the 5 left; the issue still gets 10.
      expect(timeouts).toEqual([10_000, 5_000, 10_000]);
      timeout.mockRestore();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('second review: every way GitHub limits a token', () => {
  const refuse = async (headers: Record<string, string>, status = 403): Promise<UpstreamServiceError> => {
    const service = new FeedbackService(config(), async () => new Response(JSON.stringify({ message: 'limited' }), { status, headers }));
    try {
      await service.file({ kind: 'bug', title: 'x', body: '' });
    } catch (error) {
      return error as UpstreamServiceError;
    }
    throw new Error('expected GitHub to refuse');
  };

  it('reads the wait from x-ratelimit-reset when there is no retry-after', async () => {
    const reset = Math.floor(Date.now() / 1000) + 120;
    const error = await refuse({ 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(reset) });
    expect(error.statusCode).toBe(503);
    expect(error.retryAfterSeconds).toBeGreaterThanOrEqual(119);
    expect(error.retryAfterSeconds).toBeLessThanOrEqual(121);
  });

  it('treats a 403 with retry-after as the secondary limit, even with requests left', async () => {
    const error = await refuse({ 'x-ratelimit-remaining': '4000', 'retry-after': '45' });
    expect(error.statusCode).toBe(503);
    expect(error.retryAfterSeconds).toBe(45);
  });

  it('keeps a plain 403 a refusal', async () => {
    const error = await refuse({ 'x-ratelimit-remaining': '4000' });
    expect(error.statusCode).toBe(502);
    expect(error.retryAfterSeconds).toBeUndefined();
  });
});

describe('the app’s copy of the rule', () => {
  it('is the same as this one, line for line', async () => {
    // The app neutralises the state it captures with its own copy (it cannot
    // import the server's code). A change to one must be made to both.
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const rule = (source: string) => {
      const start = source.indexOf('export function neutralizeGitHubReferences');
      const body = source.slice(start, source.indexOf('\n}\n', start));
      return body
        .split('\n')
        .filter((line) => line.trim().startsWith('.replace('))
        .map((line) => line.trim().replace(/;$/, ''));
    };
    const server = rule(readFileSync(resolve(__dirname, 'FeedbackService.ts'), 'utf8'));
    const app = rule(readFileSync(resolve(__dirname, '../../../../frontend/src/components/feedback/issueBody.ts'), 'utf8'));
    expect(server).toHaveLength(5);
    expect(app).toEqual(server);
  });
});
