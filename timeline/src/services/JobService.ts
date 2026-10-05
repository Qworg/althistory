/**
 * Job Service for managing async operations (export, import, ingest)
 */

import { EventEmitter } from 'events';
import { 
  AsyncJob, 
  JobStatus,
  JobResult,
  ExportJobParams,
  ImportJobParams,
  IngestJobParams,
  CreateExportJobRequest,
  CreateExportJobResponse,
} from '../models/AsyncJob';
import { JobRepository, JobFilter, JobStats } from '../repositories/JobRepository';
import { ExportService, ExportOptions } from './ExportService';
import { GraphRepository } from '../repositories/GraphRepository';
import { createLogger, ILogger } from '../utils/logger';

export interface JobServiceConfig {
  dataDir: string;
  maxConcurrentJobs?: number;
  jobTimeoutMs?: number;
  pollIntervalMs?: number;
  appVersion?: string;
}

export interface JobProgress {
  jobId: string;
  progress: number;
  status: JobStatus;
  message?: string;
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

  constructor(config: JobServiceConfig) {
    super();
    this.dataDir = config.dataDir;
    this.maxConcurrentJobs = config.maxConcurrentJobs || 3;
    this.jobTimeoutMs = config.jobTimeoutMs || 30 * 60 * 1000; // 30 minutes
    this.pollIntervalMs = config.pollIntervalMs || 5000; // 5 seconds

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

    this.initialized = true;
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

    // Create job parameters
    const params: ExportJobParams = {
      type: 'export',
      graphId: request.graphId,
      scope: request.scope,
      filters: request.filters,
      includeProvenance: request.includeProvenance ?? false,
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
   * Create an import job (placeholder for Phase 2)
   */
  async createImportJob(params: Omit<ImportJobParams, 'type'>, webhookUrl?: string): Promise<string> {
    const job = await this.jobRepository.create({
      type: 'import',
      parameters: { type: 'import', ...params },
      webhookUrl,
    });

    this.emit('jobCreated', { jobId: job.id, type: 'import' });
    return job.id;
  }

  /**
   * Create an ingest job (placeholder for Phase 3)
   */
  async createIngestJob(params: Omit<IngestJobParams, 'type'>, webhookUrl?: string): Promise<string> {
    const job = await this.jobRepository.create({
      type: 'ingest',
      parameters: { type: 'ingest', ...params },
      webhookUrl,
    });

    this.emit('jobCreated', { jobId: job.id, type: 'ingest' });
    return job.id;
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
      const job = await this.jobRepository.getNextPending();
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
          result = await this.executeImportJob(job);
          break;
        case 'ingest':
          result = await this.executeIngestJob(job);
          break;
        default:
          throw new Error(`Unknown job type: ${job.type}`);
      }

      job.complete(result);
      await this.jobRepository.update(job);
      this.emit('jobCompleted', { jobId: job.id, result });

      // Send webhook if configured
      if (job.webhookUrl) {
        await this.sendWebhook(job);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      job.fail(errorMessage);
      await this.jobRepository.update(job);
      this.emit('jobFailed', { jobId: job.id, error: errorMessage });

      // Send webhook even on failure
      if (job.webhookUrl) {
        await this.sendWebhook(job);
      }
    }
  }

  private async executeExportJob(job: AsyncJob): Promise<JobResult> {
    const params = job.parameters as ExportJobParams;

    // Update progress: starting
    this.emitProgress(job.id, 10, 'Starting export...');

    const options: ExportOptions = {
      graphId: params.graphId,
      scope: params.scope,
      filters: params.filters,
      includeProvenance: params.includeProvenance,
    };

    // Update progress: exporting
    this.emitProgress(job.id, 50, 'Generating export file...');

    const filePath = await this.exportService.exportToFile(options);

    // Update progress: complete
    this.emitProgress(job.id, 100, 'Export complete');

    return {
      outputPath: filePath,
      summary: {
        graphId: params.graphId,
        scope: params.scope,
      },
    };
  }

  private async executeImportJob(_job: AsyncJob): Promise<JobResult> {
    // Placeholder for Phase 2
    throw new Error('Import jobs not yet implemented');
  }

  private async executeIngestJob(_job: AsyncJob): Promise<JobResult> {
    // Placeholder for Phase 3
    throw new Error('Ingest jobs not yet implemented');
  }

  private emitProgress(jobId: string, progress: number, message?: string): void {
    this.emit('jobProgress', {
      jobId,
      progress,
      status: 'processing' as JobStatus,
      message,
    } as JobProgress);
  }

  private async sendWebhook(job: AsyncJob): Promise<void> {
    if (!job.webhookUrl || job.webhookSent) return;

    // Create an AbortController for timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout

    try {
      const response = await fetch(job.webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          jobId: job.id,
          type: job.type,
          status: job.status,
          result: job.result,
          error: job.error,
          completedAt: job.completedAt,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (response.ok) {
        job.markWebhookSent();
        await this.jobRepository.update(job);
      } else {
        this.logger.error('Webhook request failed', undefined, {
          jobId: job.id,
          statusCode: response.status,
        });
      }
    } catch (error) {
      clearTimeout(timeoutId);
      if (error instanceof Error && error.name === 'AbortError') {
        this.logger.error('Webhook timeout exceeded', undefined, {
          jobId: job.id,
          timeoutSeconds: 30,
        });
      } else {
        this.logger.error('Webhook error', error, { jobId: job.id });
      }
    }
  }
}
