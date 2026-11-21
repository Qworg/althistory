/**
 * In-app feedback, filed as GitHub issues (issue #49).
 *
 * The app's feedback dialog builds a report: a kind (bug, idea, other), a
 * title, a Markdown body (the reporter's words, then the page, state,
 * environment and recent errors it captured) and, optionally, a screenshot.
 * When this server is configured with a GitHub token and repository, it files
 * the report itself, so the reporter needs no GitHub account. Otherwise the app
 * opens GitHub's prefilled new-issue form instead; nothing here runs.
 *
 * The server is the boundary for an anonymous report, so it does not trust the
 * body it is given:
 *
 *  - every `@mention` and issue reference is neutralised (a zero-width space
 *    after the `@` or `#`), so a report cannot notify people or cross-reference
 *    issues in other repositories through this server's token;
 *  - sizes are capped, and a screenshot must be a real PNG, JPEG or WebP;
 *  - reports are rate-limited per client and across all clients, because the
 *    token is the server's and the repository may be public;
 *  - the token never leaves the server: `publicConfig` says only whether
 *    filing is on and which repository the app should send people to.
 *
 * GitHub's API cannot attach an image to an issue, so the screenshot is
 * committed (contents API) to a branch of its own, created from the default
 * branch the first time, and the issue links to it. In a public repository
 * that screenshot is public; the dialog says so before the reporter sends.
 */

import { randomUUID } from 'node:crypto';
import { UpstreamServiceError, ValidationError } from '@/utils/errors';

export type FeedbackKind = 'bug' | 'idea' | 'other';

export const FEEDBACK_KINDS: readonly FeedbackKind[] = ['bug', 'idea', 'other'];

/** The GitHub label each kind is filed under (besides the configured ones). */
const KIND_LABEL: Record<FeedbackKind, string | null> = {
  bug: 'bug',
  idea: 'enhancement',
  other: null,
};

/** GitHub's own caps on an issue. */
const GITHUB_TITLE_CHARS = 256;
const GITHUB_BODY_CHARS = 65_536;

export const FEEDBACK_LIMITS = {
  /** GitHub caps an issue title at 256; a title is a line, not a paragraph. */
  titleChars: 200,
  /** GitHub caps an issue body at 65,536 characters; this leaves room for the server's own lines. */
  bodyChars: 60_000,
  /** The decoded screenshot. The app downscales well under this. */
  screenshotBytes: 2 * 1024 * 1024,
} as const;

export interface RateWindow {
  max: number;
  windowMs: number;
}

export interface FeedbackConfig {
  /** `owner/name`, or null when unset (or not a repository name). */
  repo: string | null;
  /** The token the server files with; null leaves filing off. */
  token: string | null;
  /** The branch screenshots are committed to. */
  screenshotBranch: string;
  /** Labels every report is filed under, besides its kind's. */
  labels: string[];
  perClient: RateWindow;
  global: RateWindow;
  /** GitHub's REST API, overridable for GitHub Enterprise. */
  apiBase: string;
  /** What is wrong with the configuration, when something is. Logged once at start. */
  problem?: string;
}

/** What the app may know: whether the server files reports, and where people should go otherwise. */
export interface FeedbackPublicConfig {
  serverFiling: boolean;
  repo: string | null;
}

export interface FeedbackReport {
  kind: FeedbackKind;
  title: string;
  body: string;
  screenshot?: { bytes: Buffer; type: 'png' | 'jpeg' | 'webp' };
}

export interface FiledIssue {
  number: number;
  url: string;
  /** False when a screenshot was sent but could not be stored; the issue says so. */
  screenshotStored: boolean;
}

const REPO_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
/** `.` and `..` match the pattern but would walk the API path (`x/..` is `/repos`). */
const isRepoName = (value: string): boolean =>
  REPO_PATTERN.test(value) && value.split('/').every((part) => part !== '.' && part !== '..');
/** A token goes in a header: anything else (a line break, a space) would put it in an error message. */
const TOKEN_PATTERN = /^[\x21-\x7e]+$/;
const BRANCH_PATTERN = /^(?!\/)(?!.*\.\.)(?!.*\/\/)[A-Za-z0-9._/-]+(?<![/.])$/;

function positiveInt(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

/**
 * Read the feedback settings from the environment.
 *
 * FEEDBACK_GITHUB_REPO   `owner/name`: where reports go (also tells the app where to send people)
 * FEEDBACK_GITHUB_TOKEN  a token that may create issues and write contents there; without it, the
 *                        app uses GitHub's prefilled form
 * FEEDBACK_SCREENSHOT_BRANCH  default `feedback-screenshots`
 * FEEDBACK_LABELS        comma-separated, default `feedback`
 * FEEDBACK_RATE_PER_CLIENT    reports per client per 15 minutes, default 5
 * FEEDBACK_RATE_GLOBAL        reports per hour from all clients, default 30
 * FEEDBACK_GITHUB_API    default `https://api.github.com`
 */
export function readFeedbackConfig(env: NodeJS.ProcessEnv = process.env): FeedbackConfig {
  const problems: string[] = [];

  const rawRepo = env.FEEDBACK_GITHUB_REPO?.trim() || '';
  let repo: string | null = null;
  if (rawRepo) {
    if (isRepoName(rawRepo)) repo = rawRepo;
    else problems.push(`FEEDBACK_GITHUB_REPO must be "owner/name", not "${rawRepo}"`);
  }

  let token = env.FEEDBACK_GITHUB_TOKEN?.trim() || null;
  if (token && !TOKEN_PATTERN.test(token)) {
    // Never echo it: the message is logged.
    problems.push('FEEDBACK_GITHUB_TOKEN contains spaces or control characters, so the server will not file reports');
    token = null;
  }
  if (token && !repo) {
    problems.push('FEEDBACK_GITHUB_TOKEN is set but FEEDBACK_GITHUB_REPO is not, so the server will not file reports');
    token = null;
  }

  const rawBranch = env.FEEDBACK_SCREENSHOT_BRANCH?.trim() || 'feedback-screenshots';
  let screenshotBranch = rawBranch;
  if (!BRANCH_PATTERN.test(rawBranch)) {
    problems.push(`FEEDBACK_SCREENSHOT_BRANCH "${rawBranch}" is not a branch name; using feedback-screenshots`);
    screenshotBranch = 'feedback-screenshots';
  }

  const labels = (env.FEEDBACK_LABELS ?? 'feedback')
    .split(',')
    .map((label) => label.trim())
    .filter((label) => label.length > 0 && label.length <= 50);

  const apiBase = (env.FEEDBACK_GITHUB_API?.trim() || 'https://api.github.com').replace(/\/+$/, '');

  return {
    repo,
    token,
    screenshotBranch,
    labels,
    perClient: { max: positiveInt(env.FEEDBACK_RATE_PER_CLIENT, 5), windowMs: 15 * 60_000 },
    global: { max: positiveInt(env.FEEDBACK_RATE_GLOBAL, 30), windowMs: 60 * 60_000 },
    apiBase,
    ...(problems.length > 0 ? { problem: problems.join('; ') } : {}),
  };
}

const ZWSP = '\u200B';

/**
 * Make text inert on GitHub: no `@mention` notifies anyone and no `#123`,
 * `owner/repo#123`, `GH-123`, issue, pull or commit URL cross-references
 * anything. A zero-width space goes after each `@` or `#` that could start a
 * reference (what Dependabot and Renovate do), so the text still reads the same.
 *
 * The rule is deliberately blunt, because every narrower one leaked:
 *
 *  - every `@` followed by a name character is broken, whatever comes before
 *    it, so markup that renders away (`` `x`@a ``, `_a_@a`, `<div>&amp@a`)
 *    cannot leave a live mention behind. An email address gets one too; it
 *    still reads the same;
 *  - every `&` is followed by a zero-width space, so no character reference is
 *    ever decoded: `&#x40;`, `&#x23;`, `&#x31;`, `&#x2F;` and the like show as
 *    the literal text, and cannot become an `@`, a `#`, a digit or a slash
 *    after this rule has run.
 *
 * Idempotent: every insertion is skipped where the space is already there.
 */
export function neutralizeGitHubReferences(text: string): string {
  return text
    .replace(/&(?!\u200B)/g, `&${ZWSP}`)
    .replace(/@(?=[A-Za-z0-9_-])/g, `@${ZWSP}`)
    .replace(/#(?=\d)/g, `#${ZWSP}`)
    .replace(/GH-(?=\d)/gi, (match) => `${match}${ZWSP}`)
    .replace(/\/(issues|pull|pulls|discussions|commit|commits)\/(?=[0-9a-f])/gi, `/$1/${ZWSP}`);
}

const SIGNATURES: Array<{ type: 'png' | 'jpeg' | 'webp'; test: (bytes: Buffer) => boolean }> = [
  { type: 'png', test: (b) => b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { type: 'jpeg', test: (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  {
    type: 'webp',
    test: (b) => b.length > 12 && b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP',
  },
];

/** Read a `data:image/...;base64,` URL, checking the bytes are the image type it claims. */
export function readScreenshot(value: unknown): FeedbackReport['screenshot'] {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string') throw new ValidationError('screenshot must be a data URL', 'screenshot');

  const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!match) throw new ValidationError('screenshot must be a base64 PNG, JPEG or WebP data URL', 'screenshot');
  const claimed = match[1] as 'png' | 'jpeg' | 'webp';
  const encoded = match[2] as string;

  // Checked on the encoded length first, so an oversized upload is not decoded.
  if (Math.floor((encoded.length * 3) / 4) > FEEDBACK_LIMITS.screenshotBytes + 2) {
    throw new ValidationError(
      `screenshot is larger than ${FEEDBACK_LIMITS.screenshotBytes / (1024 * 1024)} MB`,
      'screenshot'
    );
  }
  const bytes = Buffer.from(encoded, 'base64');
  if (bytes.length > FEEDBACK_LIMITS.screenshotBytes) {
    throw new ValidationError(
      `screenshot is larger than ${FEEDBACK_LIMITS.screenshotBytes / (1024 * 1024)} MB`,
      'screenshot'
    );
  }
  const actual = SIGNATURES.find((signature) => signature.test(bytes))?.type;
  if (actual !== claimed) throw new ValidationError(`screenshot is not a ${claimed} image`, 'screenshot');
  return { bytes, type: claimed };
}

/** Check and normalise a report from a request body. Throws ValidationError (400). */
export function readFeedbackReport(raw: unknown): FeedbackReport {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new ValidationError('The report must be a JSON object');
  }
  const input = raw as Record<string, unknown>;

  const kind = input.kind;
  if (typeof kind !== 'string' || !(FEEDBACK_KINDS as readonly string[]).includes(kind)) {
    throw new ValidationError(`kind must be one of ${FEEDBACK_KINDS.join(', ')}`, 'kind');
  }

  if (typeof input.title !== 'string') throw new ValidationError('title is required', 'title');
  // A title is one line: GitHub would show a newline as a space anyway. The
  // limit is on what the reporter wrote; neutralising adds an invisible
  // character per @, # or &, which GitHub's own cap (256) still has room for.
  const written = input.title.replace(/\s+/g, ' ').trim();
  if (written.length === 0) throw new ValidationError('title is required', 'title');
  if (written.length > FEEDBACK_LIMITS.titleChars) {
    throw new ValidationError(`title is longer than ${FEEDBACK_LIMITS.titleChars} characters`, 'title');
  }
  const title = neutralizeGitHubReferences(written);
  if (title.length > GITHUB_TITLE_CHARS) {
    throw new ValidationError('title has too many @, # and & characters to file', 'title');
  }

  const rawBody = input.body ?? '';
  if (typeof rawBody !== 'string') throw new ValidationError('body must be text', 'body');
  if (rawBody.length > FEEDBACK_LIMITS.bodyChars) {
    throw new ValidationError(`body is longer than ${FEEDBACK_LIMITS.bodyChars} characters`, 'body');
  }
  const body = neutralizeGitHubReferences(rawBody);
  // GitHub's cap less room for the server's own lines (screenshot link, footer).
  if (body.length > GITHUB_BODY_CHARS - 1_000) {
    throw new ValidationError('body has too many @, # and & characters to file', 'body');
  }

  const screenshot = readScreenshot(input.screenshot);
  return { kind: kind as FeedbackKind, title, body, ...(screenshot ? { screenshot } : {}) };
}

/**
 * A sliding window per client, and one across all clients. In memory: a
 * restart forgets it, which costs at most one window's worth of reports.
 */
export class FeedbackRateLimiter {
  private readonly clients = new Map<string, number[]>();
  private global: number[] = [];

  constructor(
    private readonly perClient: RateWindow,
    private readonly overall: RateWindow,
    private readonly now: () => number = Date.now
  ) {}

  /** Count a report, or say how many seconds until the client may send one. */
  take(client: string): { allowed: true } | { allowed: false; retryAfterSeconds: number } {
    const now = this.now();
    const recent = (this.clients.get(client) ?? []).filter((t) => now - t < this.perClient.windowMs);
    this.global = this.global.filter((t) => now - t < this.overall.windowMs);

    const waits: number[] = [];
    if (recent.length >= this.perClient.max) waits.push((recent[0] as number) + this.perClient.windowMs - now);
    if (this.global.length >= this.overall.max) waits.push((this.global[0] as number) + this.overall.windowMs - now);
    if (waits.length > 0) {
      if (recent.length > 0) this.clients.set(client, recent);
      return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil(Math.max(...waits) / 1000)) };
    }

    recent.push(now);
    this.clients.set(client, recent);
    this.global.push(now);
    // Forget clients whose window has passed, so the map cannot grow without bound.
    if (this.clients.size > 10_000) {
      for (const [key, times] of this.clients) {
        if (times.every((t) => now - t >= this.perClient.windowMs)) this.clients.delete(key);
      }
    }
    return { allowed: true };
  }
}

/**
 * GitHub may have filed the issue and the server cannot tell: the call timed
 * out, failed in flight, or GitHub answered 5xx or an unreadable 201. The app
 * says so, so the reporter checks before sending again.
 */
export class FeedbackMaybeFiledError extends UpstreamServiceError {
  constructor(message: string, upstreamStatus: number, cause?: Error) {
    super(message, 502, 'github', upstreamStatus, undefined, cause);
  }
}

type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

/** One GitHub call's own deadline, so a hung connection cannot hold a request forever. */
const GITHUB_CALL_TIMEOUT_MS = 10_000;
/**
 * All of a report's calls together, so the answer comes inside the route's
 * 45 s budget and the app's 60 s timeout, however many calls it took.
 */
export const FEEDBACK_FILE_BUDGET_MS = 35_000;

export class FeedbackService {
  readonly limiter: FeedbackRateLimiter;
  /** The repository's default branch, asked once; forgotten if asking failed. */
  private defaultBranch: Promise<string> | null = null;

  constructor(
    readonly config: FeedbackConfig = readFeedbackConfig(),
    private readonly fetchImpl: FetchLike = (url, init) => fetch(url, init)
  ) {
    this.limiter = new FeedbackRateLimiter(config.perClient, config.global);
  }

  get enabled(): boolean {
    return this.config.token !== null && this.config.repo !== null;
  }

  publicConfig(): FeedbackPublicConfig {
    return { serverFiling: this.enabled, repo: this.config.repo };
  }

  /**
   * File a report. The screenshot goes first, so the issue can link it; if it
   * cannot be stored, the issue is still filed and says so, because the
   * reporter's words matter more than the picture.
   */
  async file(report: FeedbackReport): Promise<FiledIssue> {
    if (!this.enabled) {
      throw new UpstreamServiceError('This server does not file feedback; use the GitHub form', 503, 'github', 0);
    }

    const deadline = Date.now() + FEEDBACK_FILE_BUDGET_MS;
    let screenshotUrl: string | null = null;
    let screenshotStored = true;
    if (report.screenshot) {
      try {
        screenshotUrl = await this.storeScreenshot(report.screenshot, deadline);
      } catch (error) {
        screenshotStored = false;
        console.warn('[feedback] could not store the screenshot:', error instanceof Error ? error.message : error);
      }
    }

    const labels = [...this.config.labels];
    const kindLabel = KIND_LABEL[report.kind];
    if (kindLabel && !labels.includes(kindLabel)) labels.unshift(kindLabel);

    const sections = [neutralizeGitHubReferences(report.body.trim())];
    if (screenshotUrl) {
      sections.push(`### Screenshot\n\n![Screenshot of the app when the report was opened](${screenshotUrl})`);
    } else if (report.screenshot) {
      sections.push('### Screenshot\n\n_A screenshot was sent, but the server could not store it._');
    }
    sections.push(
      '---\n_Sent from the in-app feedback button and filed by the server. The reporter may not have a GitHub ' +
        'account, so a reply here may not reach them._'
    );

    let response: Response;
    try {
      response = await this.github(
        'POST',
        `/repos/${this.config.repo}/issues`,
        {
          title: neutralizeGitHubReferences(report.title),
          body: sections.filter((s) => s.length > 0).join('\n\n'),
          labels,
        },
        // The issue gets at least one full call's time, even after a slow screenshot.
        Math.max(deadline, Date.now() + GITHUB_CALL_TIMEOUT_MS)
      );
    } catch (error) {
      throw new FeedbackMaybeFiledError(
        'GitHub did not answer in time, so the issue may or may not have been filed',
        0,
        error instanceof Error ? error : undefined
      );
    }
    if (response.status >= 500) {
      throw new FeedbackMaybeFiledError(`GitHub failed (${response.status}) while filing the issue, which may have been filed`, response.status);
    }
    if (!response.ok) throw await this.upstreamError('create the issue', response);
    let issue: { number?: unknown; html_url?: unknown };
    try {
      issue = (await response.json()) as { number?: unknown; html_url?: unknown };
    } catch (error) {
      throw new FeedbackMaybeFiledError('GitHub filed the issue but its answer could not be read', response.status, error instanceof Error ? error : undefined);
    }
    if (typeof issue.number !== 'number' || typeof issue.html_url !== 'string') {
      throw new FeedbackMaybeFiledError('GitHub answered the new issue without its number or link', response.status);
    }
    return { number: issue.number, url: issue.html_url, screenshotStored };
  }

  private async storeScreenshot(screenshot: NonNullable<FeedbackReport['screenshot']>, deadline: number): Promise<string> {
    const { repo, screenshotBranch: branch } = this.config;
    // Anonymous reports must never commit to the branch everyone builds from.
    const defaultBranch = await this.readDefaultBranch(deadline);
    if (branch === defaultBranch) {
      throw new Error(`FEEDBACK_SCREENSHOT_BRANCH is the default branch (${branch}); screenshots are not stored there`);
    }

    const month = new Date().toISOString().slice(0, 7);
    const extension = screenshot.type === 'jpeg' ? 'jpg' : screenshot.type;
    const path = `feedback/${month}/${randomUUID()}.${extension}`;

    const put = () =>
      this.github(
        'PUT',
        `/repos/${repo}/contents/${path}`,
        { message: 'feedback: add a screenshot', content: screenshot.bytes.toString('base64'), branch },
        deadline
      );

    let response = await put();
    // A missing branch is a 404 (or, on some GitHub versions, a 422 naming the branch).
    if (response.status === 404 || response.status === 422) {
      await this.ensureBranch(defaultBranch, deadline);
      response = await put();
    }
    // 409: another report moved the branch's head between our read and write.
    if (response.status === 409) response = await put();
    if (!response.ok) throw await this.upstreamError('store the screenshot', response);

    // GitHub says where the file is, which is right on GitHub Enterprise too.
    const stored = (await response.json().catch(() => ({}))) as { content?: { html_url?: unknown } };
    const htmlUrl = stored.content?.html_url;
    if (typeof htmlUrl === 'string' && /^https:\/\//.test(htmlUrl)) return `${htmlUrl}?raw=true`;
    return `https://github.com/${repo}/blob/${encodeURIComponent(branch).replace(/%2F/g, '/')}/${path}?raw=true`;
  }

  private readDefaultBranch(deadline: number): Promise<string> {
    if (!this.defaultBranch) {
      this.defaultBranch = (async () => {
        const repository = await this.github('GET', `/repos/${this.config.repo}`, undefined, deadline);
        if (!repository.ok) throw await this.upstreamError('read the repository', repository);
        const name = ((await repository.json()) as { default_branch?: unknown }).default_branch;
        if (typeof name !== 'string') throw new Error('GitHub did not say which branch is the default');
        return name;
      })();
      this.defaultBranch.catch(() => {
        this.defaultBranch = null;
      });
    }
    return this.defaultBranch;
  }

  /** Create the screenshot branch from the default branch's head, unless it exists. */
  private async ensureBranch(defaultBranch: string, deadline: number): Promise<void> {
    const { repo, screenshotBranch: branch } = this.config;
    const existing = await this.github('GET', `/repos/${repo}/git/ref/heads/${branch}`, undefined, deadline);
    if (existing.ok) return;

    const head = await this.github('GET', `/repos/${repo}/git/ref/heads/${defaultBranch}`, undefined, deadline);
    if (!head.ok) throw await this.upstreamError('read the default branch', head);
    const sha = ((await head.json()) as { object?: { sha?: unknown } }).object?.sha;
    if (typeof sha !== 'string') throw new Error('GitHub did not give the default branch a commit');

    const created = await this.github('POST', `/repos/${repo}/git/refs`, { ref: `refs/heads/${branch}`, sha }, deadline);
    // 422: another report created it first.
    if (!created.ok && created.status !== 422) throw await this.upstreamError('create the screenshot branch', created);
  }

  private github(method: string, path: string, body: unknown, deadline: number): Promise<Response> {
    const left = Math.min(GITHUB_CALL_TIMEOUT_MS, deadline - Date.now());
    if (left <= 0) return Promise.reject(new Error('Out of time for GitHub'));
    return this.fetchImpl(`${this.config.apiBase}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.config.token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'althistory-feedback',
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(left),
    });
  }

  /** An error that says what failed and GitHub's status, never the token or GitHub's whole answer. */
  private async upstreamError(action: string, response: Response): Promise<UpstreamServiceError> {
    let detail = '';
    try {
      const payload = (await response.json()) as { message?: unknown };
      if (typeof payload.message === 'string') detail = `: ${payload.message.slice(0, 200)}`;
    } catch {
      // Not JSON; the status says enough.
    }
    // GitHub limits a token three ways: 429, a 403 with no requests left (reset
    // time in x-ratelimit-reset), or a 403 with retry-after (the secondary limit).
    const retryAfterHeader = Number(response.headers.get('retry-after'));
    const hasRetryAfter = Number.isFinite(retryAfterHeader) && retryAfterHeader > 0;
    const remaining = response.headers.get('x-ratelimit-remaining');
    const resetAt = Number(response.headers.get('x-ratelimit-reset'));
    const limited = response.status === 429 || (response.status === 403 && (remaining === '0' || hasRetryAfter));
    let retryAfter: number | undefined;
    if (hasRetryAfter) retryAfter = retryAfterHeader;
    else if (Number.isFinite(resetAt) && resetAt > 0) retryAfter = Math.max(1, Math.ceil(resetAt - Date.now() / 1000));
    return new UpstreamServiceError(
      `GitHub refused to ${action} (${response.status}${detail})`,
      limited ? 503 : 502,
      'github',
      response.status,
      limited ? retryAfter : undefined
    );
  }
}
