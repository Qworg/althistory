/**
 * Job Service for managing async operations (export, import, ingest)
 */

import { EventEmitter } from 'events';
import {
  AsyncJob, 
  JobStatus,
  JobResult,
  ExportJobParams,
  CreateExportJobRequest,
  CreateExportJobResponse,
} from '../models/AsyncJob';
import { JobRepository, JobFilter, JobStats } from '../repositories/JobRepository';
import { ExportService, ExportOptions } from './ExportService';
import { GraphRepository } from '../repositories/GraphRepository';
import { assertWebhookTarget } from '../utils/webhookTarget';
import { NotFoundError } from '../utils/errors';
import { createLogger, ILogger } from '../utils/logger';

export interface JobServiceConfig {
  dataDir: string;
  maxConcurrentJobs?: number;
  jobTimeoutMs?: number;
  pollIntervalMs?: number;
  appVersion?: string;
  /** Total webhook delivery attempts, including the first. Defaults to 4. */
  webhookMaxAttempts?: number;
  /** Delay before the second attempt; doubles per attempt. Defaults to 1000ms. */
  webhookInitialBackoffMs?: number;
  /** Upper bound on a single backoff delay. Defaults to 30000ms. */
  webhookMaxBackoffMs?: number;
  /** Per-attempt AbortController timeout. Defaults to 30000ms. */
  webhookTimeoutMs?: number;
}

export interface JobProgress {
  jobId: string;
  progress: number;
  status: JobStatus;
  message?: string;
}

/**
 * Webhook delivery defaults. A webhook notifies an external endpoint about an
 * operation that has already reached a terminal state, so delivery is retried
 * in the background while the job itself is never held open for it.
 *
 * Four attempts with a 1s base delay and a 30s per-attempt timeout bounds the
 * retry window to roughly 7s of waiting (1s + 2s + 4s) when the endpoint is
 * unreachable, which rides out a transient blip without hiding a permanent
 * failure for long.
 */
const DEFAULT_WEBHOOK_MAX_ATTEMPTS = 4;
const DEFAULT_WEBHOOK_INITIAL_BACKOFF_MS = 1000;
const DEFAULT_WEBHOOK_MAX_BACKOFF_MS = 30000;
const DEFAULT_WEBHOOK_TIMEOUT_MS = 30000;

/**
 * Outcome of one webhook POST. `retryable` classifies the failure: a 4xx is a
 * malformed request that will fail identically on retry, while a 5xx, a
 * timeout, a rate limit or a connection error may succeed later.
 */
interface WebhookAttemptResult {
  delivered: boolean;
  retryable: boolean;
  reason: string;
}

/**
 * Service for orchestrating async job execution
 */
export class JobService extends EventEmitter {
  private readonly jobRepository: JobRepository;
  private readonly exportService: ExportService;
  private readonly graphRepository: GraphRepository;
  private readonly dataDir: string;
  private readonly maxConcurrentJobs: number;
  private readonly jobTimeoutMs: number;
  private readonly pollIntervalMs: number;
  
  private activeJobs: Map<string, Promise<void>> = new Map();
  private pollInterval?: NodeJS.Timeout;
  private readonly logger: ILogger;
  private initialized = false;
  private running = false;

  private readonly webhookMaxAttempts: number;
  private readonly webhookInitialBackoffMs: number;
  private readonly webhookMaxBackoffMs: number;
  private readonly webhookTimeoutMs: number;
  // In-flight webhook requests and their per-attempt timeouts, plus backoff
  // waits, so stop() can cancel all of them rather than leak timers.
  private readonly webhookControllers: Set<AbortController> = new Set();
  private readonly webhookTimeoutTimers: Set<NodeJS.Timeout> = new Set();
  private readonly pendingWebhookWaits: Set<() => void> = new Set();

  constructor(config: JobServiceConfig) {
    super();
    this.dataDir = config.dataDir;
    this.maxConcurrentJobs = config.maxConcurrentJobs || 3;
    this.jobTimeoutMs = config.jobTimeoutMs || 30 * 60 * 1000; // 30 minutes
    this.pollIntervalMs = config.pollIntervalMs || 5000; // 5 seconds
    this.webhookMaxAttempts = config.webhookMaxAttempts ?? DEFAULT_WEBHOOK_MAX_ATTEMPTS;
    this.webhookInitialBackoffMs = config.webhookInitialBackoffMs ?? DEFAULT_WEBHOOK_INITIAL_BACKOFF_MS;
    this.webhookMaxBackoffMs = config.webhookMaxBackoffMs ?? DEFAULT_WEBHOOK_MAX_BACKOFF_MS;
    this.webhookTimeoutMs = config.webhookTimeoutMs ?? DEFAULT_WEBHOOK_TIMEOUT_MS;

    this.jobRepository = new JobRepository({ dataDir: config.dataDir });
    this.exportService = new ExportService({ 
      dataDir: config.dataDir,
      appVersion: config.appVersion,
    });
    this.graphRepository = new GraphRepository({ dataDir: config.dataDir });
    this.logger = createLogger('JobService');
  }

  /**
   * Initialize the service
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    await this.jobRepository.initialize();
    await this.exportService.initialize();
    await this.graphRepository.initialize();

    // Recover any stalled jobs from previous runs
    const recovered = await this.jobRepository.recoverStalledJobs(this.jobTimeoutMs);
    if (recovered > 0) {
      this.logger.info('Recovered stalled jobs', { count: recovered });
    }

    await this.recoverInterruptedExportJobs();
    await this.failOrphanedNonExportJobs();

    this.initialized = true;
  }

  /**
   * Re-queue export jobs that were `processing` when a previous process died.
   *
   * `recoverStalledJobs` only reaches jobs older than the timeout, so a recent
   * crash leaves a `processing` export that `getNextPending` will never return
   * and `cleanupExpiredJobs` will never delete. Re-running an export is safe
   * (it rewrites the same output file), so they go back to `pending` rather
   * than being failed.
   */
  private async recoverInterruptedExportJobs(): Promise<void> {
    const interrupted = await this.jobRepository.findAll({
      type: 'export',
      status: 'processing',
    });

    for (const job of interrupted) {
      job.status = 'pending';
      job.progress = 0;
      job.progressMessage = 'Re-queued after a previous process stopped mid-export';
      job.startedAt = undefined;
      await this.jobRepository.update(job);
      this.logger.warn('Re-queued an interrupted export job', { jobId: job.id });
    }
  }

  /**
   * Fail import/ingest jobs left runnable by a previous process.
   *
   * They live in the same store as export jobs but have no owner after a
   * restart: `ImportService` keeps its in-flight work in memory, and ingestion
   * runs synchronously in its route. Without this, such a row stays `pending`
   * forever, because `recoverStalledJobs` only ages out `processing` rows.
   *
   * This relies on ordering: `container.initialize()` runs before `setupRoutes`
   * builds the routers, so the sweep sees the disk state and any `ImportService`
   * created later starts from it. `JobService` is not the only component with a
   * `JobRepository` (the container and each import/ingest router build their
   * own), so if that order changes, a sweep could fail a job another component
   * is about to run.
   */
  private async failOrphanedNonExportJobs(): Promise<void> {
    const candidates = await this.jobRepository.findAll({
      status: ['pending', 'processing'],
    });

    for (const job of candidates) {
      if (job.type === 'export') continue;

      job.fail(`Job was left ${job.status} by a previous process; re-run the ${job.type}`);
      await this.jobRepository.update(job);
      this.logger.warn('Failed orphaned job from a previous process', {
        jobId: job.id,
        type: job.type,
      });
    }
  }

  /**
   * Start the job processing loop
   */
  start(): void {
    if (this.running) return;
    this.running = true;

    this.pollInterval = setInterval(() => {
      this.processNextJobs().catch((err) => this.logger.error('Job processing failed', err));
    }, this.pollIntervalMs);

    // Process immediately on start
    this.processNextJobs().catch((err) => this.logger.error('Initial job processing failed', err));
  }

  /**
   * Stop the job processing loop
   */
  stop(): void {
    this.running = false;
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = undefined;
    }

    // Wake any backoff waits so their delivery loops run again and observe
    // `running === false` before scheduling anything further.
    for (const wake of Array.from(this.pendingWebhookWaits)) {
      wake();
    }
    this.pendingWebhookWaits.clear();

    // Abort in-flight requests and drop their per-attempt timeouts. On a real
    // fetch the abort settles the request, but a timeout that is still pending
    // is cleared explicitly so it cannot fire after shutdown.
    for (const controller of Array.from(this.webhookControllers)) {
      controller.abort();
    }
    this.webhookControllers.clear();
    for (const timer of Array.from(this.webhookTimeoutTimers)) {
      clearTimeout(timer);
    }
    this.webhookTimeoutTimers.clear();

    this.jobRepository.stop();
  }

  /**
   * Create an export job
   */
  async createExportJob(request: CreateExportJobRequest): Promise<CreateExportJobResponse> {
    // Validate graph exists
    const graph = await this.graphRepository.findById(request.graphId);
    if (!graph) {
      throw new Error(`Graph not found: ${request.graphId}`);
    }

    // Reject an unusable webhook now rather than recording a job whose
    // completion notification can never be delivered (see
    // `utils/webhookTarget` for the policy).
    if (request.webhook) {
      assertWebhookTarget(request.webhook);
    }

    // A pinned version has to exist now, not when the worker picks the job up:
    // otherwise the same request is a 404 on GET /export and on /export/sync
    // but a 202 here, followed by a failed job.
    if (request.version !== undefined) {
      const versionRef = await this.graphRepository.getVersion(request.graphId, request.version);
      if (!versionRef) {
        throw new NotFoundError(
          `Graph version ${request.version} not found`,
          'GraphVersion',
          `${request.graphId}@${request.version}`
        );
      }
    }

    // Create job parameters
    const params: ExportJobParams = {
      type: 'export',
      graphId: request.graphId,
      scope: request.scope,
      filters: request.filters,
      includeProvenance: request.includeProvenance ?? false,
      version: request.version,
    };

    // Create the job
    const job = await this.jobRepository.create({
      type: 'export',
      parameters: params,
      webhookUrl: request.webhook,
    });

    // Estimate export size
    const estimatedSize = await this.exportService.estimateExportSize({
      graphId: request.graphId,
      scope: request.scope,
      filters: request.filters,
      includeProvenance: request.includeProvenance ?? false,
      version: request.version,
    });

    // Estimate time based on size (rough: 1MB/sec)
    const estimatedTime = Math.ceil(estimatedSize / (1024 * 1024)) + 1;

    this.emit('jobCreated', { jobId: job.id, type: 'export' });

    return {
      jobId: job.id,
      estimatedSize,
      estimatedTime,
    };
  }

  /**
   * Get job by ID
   */
  async getJob(id: string): Promise<AsyncJob | null> {
    return this.jobRepository.findById(id);
  }

  /**
   * Get jobs with filter
   */
  async getJobs(filter?: JobFilter): Promise<AsyncJob[]> {
    return this.jobRepository.findAll(filter);
  }

  /**
   * Get job statistics
   */
  async getStats(): Promise<JobStats> {
    return this.jobRepository.getStats();
  }

  /**
   * Cancel a job
   */
  async cancelJob(id: string): Promise<boolean> {
    const job = await this.jobRepository.findById(id);
    if (!job) return false;

    if (job.status === 'completed' || job.status === 'failed') {
      return false;
    }

    try {
      job.cancel();
      await this.jobRepository.update(job);
      this.emit('jobCancelled', { jobId: id });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Delete a completed/failed/cancelled job
   */
  async deleteJob(id: string): Promise<boolean> {
    const job = await this.jobRepository.findById(id);
    if (!job) return false;

    // Only allow deleting terminal state jobs
    if (job.status === 'pending' || job.status === 'processing') {
      throw new Error('Cannot delete a pending or processing job');
    }

    return this.jobRepository.delete(id);
  }

  /**
   * Get the result file path for a completed export job
   */
  async getExportFilePath(jobId: string): Promise<string | null> {
    const job = await this.jobRepository.findById(jobId);
    if (!job || job.type !== 'export' || job.status !== 'completed') {
      return null;
    }
    return job.result?.outputPath || null;
  }

  // Private methods

  private async processNextJobs(): Promise<void> {
    if (!this.running) return;

    // Check if we can process more jobs
    if (this.activeJobs.size >= this.maxConcurrentJobs) return;

    // Get pending jobs
    const availableSlots = this.maxConcurrentJobs - this.activeJobs.size;
    
    for (let i = 0; i < availableSlots; i++) {
      // These jobs live in the same store but are not this worker's to run:
      // `ImportService` executes imports itself in-process, and ingestion is
      // synchronous in the ingest route. The type filter is what keeps a job
      // written by another service from being failed here with the wrong
      // reason; `failOrphanedNonExportJobs` handles rows left by a previous
      // process, which no in-process owner will ever adopt.
      const job = await this.jobRepository.getNextPending('export');
      if (!job) break;

      // Skip if already processing
      if (this.activeJobs.has(job.id)) continue;

      // Start processing
      const promise = this.processJob(job);
      this.activeJobs.set(job.id, promise);

      // Clean up when done
      promise.finally(() => {
        this.activeJobs.delete(job.id);
      });
    }
  }

  private async processJob(job: AsyncJob): Promise<void> {
    try {
      job.start();
      await this.jobRepository.update(job);
      this.emit('jobStarted', { jobId: job.id });

      let result: JobResult;

      switch (job.type) {
        case 'export':
          result = await this.executeExportJob(job);
          break;
        case 'import':
        case 'ingest':
          // Defensive: `processNextJobs` only claims export jobs, so this is
          // reachable only if the repository hands back a type it was not asked
          // for.
          throw new Error(
            `Job type '${job.type}' is not executed by JobService ` +
              '(imports are owned by ImportService, ingestion by the ingest route)'
          );
        default:
          throw new Error(`Unknown job type: ${job.type}`);
      }

      job.complete(result);
      await this.jobRepository.update(job);
      this.emit('jobCompleted', { jobId: job.id, result });

      // Send webhook if configured. The job is already complete; delivery runs
      // in the background so retries do not hold the job (or its worker slot)
      // open.
      if (job.webhookUrl) {
        this.dispatchWebhook(job);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      job.fail(errorMessage);
      await this.jobRepository.update(job);
      this.emit('jobFailed', { jobId: job.id, error: errorMessage });

      // Send webhook even on failure
      if (job.webhookUrl) {
        this.dispatchWebhook(job);
      }
    }
  }

  private async executeExportJob(job: AsyncJob): Promise<JobResult> {
    const params = job.parameters as ExportJobParams;

    await this.reportProgress(job, 10, 'Starting export...');

    const options: ExportOptions = {
      graphId: params.graphId,
      scope: params.scope,
      filters: params.filters,
      includeProvenance: params.includeProvenance,
      // Carried through the job parameters so a pinned export does not silently
      // export the head once it crosses the async threshold.
      version: params.version,
    };

    await this.reportProgress(job, 50, 'Generating export file...');

    const filePath = await this.exportService.exportToFile(options);

    await this.reportProgress(job, 100, 'Export complete');

    return {
      outputPath: filePath,
      summary: {
        graphId: params.graphId,
        scope: params.scope,
      },
    };
  }

  /**
   * Persist progress as well as emitting it. `GET /export/jobs/:id` serves the
   * stored job, so an event-only update leaves the caller polling a job that
   * stays at 0% until it completes.
   */
  private async reportProgress(
    job: AsyncJob,
    progress: number,
    message: string
  ): Promise<void> {
    job.updateProgress(progress);
    job.progressMessage = message;
    await this.jobRepository.update(job);
    this.emitProgress(job.id, progress, message);
  }

  private emitProgress(jobId: string, progress: number, message?: string): void {
    this.emit('jobProgress', {
      jobId,
      progress,
      status: 'processing' as JobStatus,
      message,
    } as JobProgress);
  }

  /**
   * Start webhook delivery without blocking the caller. Delivery is a
   * notification, so the job's terminal state and worker slot are released
   * first; failures are recorded asynchronously on the job.
   */
  private dispatchWebhook(job: AsyncJob): void {
    void this.sendWebhook(job).catch((error) => {
      this.logger.error('Webhook delivery task failed', error, { jobId: job.id });
    });
  }

  /**
   * Deliver the job's webhook, retrying retryable failures with exponential
   * backoff. Never called with `await` from job processing.
   *
   * The first attempt is made even if the service has already started
   * stopping: the process is still alive and the POST is short, so a delivery
   * that is already underway is not silently dropped. Only the retry backoff
   * is abandoned on shutdown, and that outcome is recorded on the job as
   * `webhookDeliveryStatus: 'abandoned'` rather than being lost.
   */
  private async sendWebhook(job: AsyncJob): Promise<void> {
    if (!job.webhookUrl || job.webhookSent) return;

    const webhookUrl = job.webhookUrl;
    const payload = JSON.stringify({
      jobId: job.id,
      type: job.type,
      status: job.status,
      result: job.result,
      error: job.error,
      completedAt: job.completedAt,
    });

    let lastReason = 'unknown error';
    let attemptsMade = 0;

    for (let attempt = 1; attempt <= this.webhookMaxAttempts; attempt++) {
      attemptsMade = attempt;

      const outcome = await this.attemptWebhook(webhookUrl, payload);

      if (outcome.delivered) {
        job.markWebhookSent();
        job.webhookDeliveryStatus = 'delivered';
        job.webhookDeliveryError = undefined;
        await this.jobRepository.update(job);
        this.logger.info('Webhook delivered', { jobId: job.id, attempts: attempt });
        this.emit('webhookDelivered', { jobId: job.id, attempts: attempt });
        return;
      }

      lastReason = outcome.reason;
      this.logger.error('Webhook delivery attempt failed', undefined, {
        jobId: job.id,
        attempt,
        maxAttempts: this.webhookMaxAttempts,
        retryable: outcome.retryable,
        reason: outcome.reason,
      });

      // A 4xx (other than 408/429) means the request itself is wrong, and the
      // last attempt means the retry budget is spent. Both are terminal
      // failures regardless of whether the service is stopping.
      if (!outcome.retryable) break;
      if (attempt === this.webhookMaxAttempts) break;

      // The service has stopped: there is nothing left to retry, but the
      // interrupted delivery is recorded rather than dropped.
      if (!this.running) {
        await this.recordWebhookAbandoned(job, attemptsMade, lastReason);
        return;
      }

      const backoffMs = Math.min(
        this.webhookInitialBackoffMs * 2 ** (attempt - 1),
        this.webhookMaxBackoffMs
      );
      this.logger.warn('Webhook delivery failed; retrying', {
        jobId: job.id,
        attempt,
        maxAttempts: this.webhookMaxAttempts,
        retryInMs: backoffMs,
        reason: outcome.reason,
      });
      await this.waitForBackoff(backoffMs);

      // stop() resolves the backoff wait so it cannot outlive the service; the
      // retry is abandoned explicitly instead of being silently skipped.
      if (!this.running) {
        await this.recordWebhookAbandoned(job, attemptsMade, lastReason);
        return;
      }
    }

    await this.recordWebhookFailure(job, attemptsMade, lastReason);
  }

  /**
   * One webhook POST with the existing per-attempt AbortController timeout.
   * Distinguishes a response that will not change on retry (4xx) from one that
   * might (5xx, 408, 429, timeout, connection error).
   */
  private async attemptWebhook(
    webhookUrl: string,
    payload: string
  ): Promise<WebhookAttemptResult> {
    // Validate (and normalize) the caller-supplied destination before any
    // request is made. An invalid destination is terminal: retrying cannot make
    // it valid. The fetch below uses this checked value, never the raw field.
    let endpoint: string;
    try {
      endpoint = assertWebhookTarget(webhookUrl);
    } catch (error) {
      return {
        delivered: false,
        retryable: false,
        reason: error instanceof Error ? error.message : String(error),
      };
    }

    let timedOut = false;
    const controller = new AbortController();
    this.webhookControllers.add(controller);
    const timeoutId = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.webhookTimeoutMs);
    this.webhookTimeoutTimers.add(timeoutId);

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: payload,
        signal: controller.signal,
        // A redirect would re-POST this body to a destination that was never
        // validated -- the exact hop the SSRF check exists to stop. Refuse it
        // and let the 3xx fall through as a non-retryable failure.
        redirect: 'manual',
      });

      if (response.ok) {
        return { delivered: true, retryable: false, reason: 'delivered' };
      }

      return {
        delivered: false,
        retryable: this.isRetryableWebhookStatus(response.status),
        reason: `HTTP ${response.status}`,
      };
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        // `timedOut` distinguishes this attempt's own timeout from stop()
        // aborting the request during shutdown; the two are not the same
        // failure and must not be reported as one.
        return timedOut
          ? {
              delivered: false,
              retryable: true,
              reason: `timeout after ${this.webhookTimeoutMs}ms`,
            }
          : {
              delivered: false,
              retryable: true,
              reason: 'aborted because the service is stopping',
            };
      }
      return {
        delivered: false,
        retryable: true,
        reason: error instanceof Error ? error.message : String(error),
      };
    } finally {
      clearTimeout(timeoutId);
      this.webhookTimeoutTimers.delete(timeoutId);
      this.webhookControllers.delete(controller);
    }
  }

  /**
   * 408 (request timeout), 429 (rate limited) and any 5xx are worth retrying.
   * Other 4xx responses are not: the endpoint rejected the request itself.
   */
  private isRetryableWebhookStatus(status: number): boolean {
    return status === 408 || status === 429 || status >= 500;
  }

  /**
   * Record a terminal webhook delivery failure on the job and in the job
   * repository, following the same pattern as job failures: mutate the job,
   * persist it, then emit. The delivery outcome is written to the dedicated
   * `webhookDeliveryStatus`/`webhookDeliveryError` fields, never to `error`,
   * because the job's own status may be `completed` and a delivery failure is
   * not a job failure.
   */
  private async recordWebhookFailure(job: AsyncJob, attempts: number, reason: string): Promise<void> {
    const message = `Webhook delivery failed after ${attempts} attempt${attempts === 1 ? '' : 's'}: ${reason}`;

    job.webhookDeliveryStatus = 'failed';
    job.webhookDeliveryError = message;

    await this.jobRepository.update(job);
    this.emit('webhookDeliveryFailed', { jobId: job.id, attempts, error: message });
  }

  /**
   * Record a delivery that was cut short because the service stopped. Attempts
   * may already have been made, but no further retry will happen, so the
   * outcome is persisted as `abandoned` instead of being silently dropped.
   */
  private async recordWebhookAbandoned(job: AsyncJob, attempts: number, reason: string): Promise<void> {
    const message =
      `Webhook delivery abandoned after ${attempts} attempt${attempts === 1 ? '' : 's'} ` +
      `because the service is stopping: ${reason}`;

    job.webhookDeliveryStatus = 'abandoned';
    job.webhookDeliveryError = message;

    await this.jobRepository.update(job);
    this.logger.warn('Webhook delivery abandoned on shutdown', {
      jobId: job.id,
      attempts,
      reason,
    });
    this.emit('webhookDeliveryAbandoned', { jobId: job.id, attempts, error: message });
  }

  /**
   * Wait out a backoff delay. The wait is cancellable: stop() resolves it, and
   * the delivery loop checks `running` before scheduling the next attempt.
   */
  private waitForBackoff(ms: number): Promise<void> {
    return new Promise<void>((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.pendingWebhookWaits.delete(finish);
        resolve();
      };
      const timer = setTimeout(finish, ms);
      this.pendingWebhookWaits.add(finish);
    });
  }
}
