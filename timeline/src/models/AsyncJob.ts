/**
 * Async Job model for long-running operations like export, import, and ingestion
 */

export type JobType = 'export' | 'import' | 'ingest';
export type JobStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled';

/**
 * Delivery state of a job's webhook notification. This is deliberately
 * separate from the job's own `status`/`error`: a delivery failure does not
 * mean the job failed, so it must not be written into `error` (which the UI
 * only surfaces for failed jobs).
 *
 * - `delivered`: the endpoint accepted the payload.
 * - `failed`: delivery was attempted and gave up (attempts exhausted, or a
 *   non-retryable response such as a 4xx).
 * - `abandoned`: delivery was attempted but the service stopped before it could
 *   complete, so no further retry will be made.
 * - `undefined`: delivery has never been attempted (no webhook configured, or
 *   it has not started yet).
 */
export type WebhookDeliveryStatus = 'delivered' | 'failed' | 'abandoned';

export interface IAsyncJob {
  id: string;
  type: JobType;
  status: JobStatus;
  progress: number;
  progressMessage?: string;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  expiresAt: string;
  parameters: JobParameters;
  result?: JobResult;
  webhookUrl?: string;
  webhookSent?: boolean;
  webhookDeliveryStatus?: WebhookDeliveryStatus;
  webhookDeliveryError?: string;
  error?: string;
}

export type JobParameters = ExportJobParams | ImportJobParams | IngestJobParams;

export interface ExportJobParams {
  type: 'export';
  graphId: string;
  scope: 'full' | 'filtered';
  filters?: ExportFilters;
  includeProvenance: boolean;
}

export interface ExportFilters {
  timeRange?: { start: string; end: string };
  actors?: string[];
  targets?: string[];
  arcIds?: string[];
  eventIds?: string[];
}

export interface ImportJobParams {
  type: 'import';
  graphId: string;
  mode: 'merge' | 'replace' | 'create-new';
  conflictResolution: 'skip' | 'overwrite' | 'rename';
  dataChecksum: string;
}

export interface IngestJobParams {
  type: 'ingest';
  source: WikipediaIngestParams | WikidataIngestParams | TextIngestParams;
}

export interface WikipediaIngestParams {
  sourceType: 'wikipedia';
  url: string;
  followLinks: boolean;
  linkDepth: number;
  linkFilter?: string;
  maxPages: number;
}

export interface WikidataIngestParams {
  sourceType: 'wikidata';
  queryType: 'historical-events' | 'person-timeline' | 'custom';
  parameters: Record<string, string>;
  limit: number;
}

export interface TextIngestParams {
  sourceType: 'text';
  text: string;
  context?: ExtractionContext;
  useLLM: boolean;
}

export interface ExtractionContext {
  defaultTimeRange?: { start: string; end: string };
  defaultActors?: string[];
  knownEntities?: string[];
  locale?: string;
  instructions?: string;
}

/**
 * A job error or warning. Export and ingest jobs report plain strings; the
 * import job stores its own ImportResult here, whose errors and warnings carry
 * `path`, `message` and `code`.
 *
 * The value is passed through to API responses unchanged (see the export and
 * import routes, which return `job.result` verbatim), so this type describes
 * what is actually stored rather than forcing the import path into a lossy
 * string shape or lying about the runtime shape.
 */
export type JobErrorEntry = string | { path: string; message: string; code: string };
export type JobWarningEntry = string | { path: string; message: string; code: string };

export interface JobResult {
  outputPath?: string;
  summary?: Record<string, unknown>;
  errors?: JobErrorEntry[];
  warnings?: JobWarningEntry[];
}

/**
 * AsyncJob class with state management
 */
export class AsyncJob implements IAsyncJob {
  public readonly id: string;
  public readonly type: JobType;
  public status: JobStatus;
  public progress: number;
  public progressMessage?: string;
  public readonly createdAt: string;
  public startedAt?: string;
  public completedAt?: string;
  public readonly expiresAt: string;
  public readonly parameters: JobParameters;
  public result?: JobResult;
  public readonly webhookUrl?: string;
  public webhookSent: boolean;
  public webhookDeliveryStatus?: WebhookDeliveryStatus;
  public webhookDeliveryError?: string;
  public error?: string;

  constructor(data: CreateJobData) {
    this.id = data.id || this.generateId();
    this.type = data.type;
    this.status = data.status || 'pending';
    this.progress = 0;
    this.createdAt = new Date().toISOString();
    this.expiresAt = data.expiresAt || this.calculateExpiry();
    // SAFETY: Callers that omit `parameters` only supply a generic `metadata`
    // bag (see CreateJobData); the cast is the model's existing escape hatch
    // for that generic shape and is not used by the typed export/import/ingest
    // paths, which always pass a concrete JobParameters value.
    this.parameters = data.parameters || { type: data.type, metadata: data.metadata } as unknown as JobParameters;
    this.webhookUrl = data.webhookUrl;
    this.webhookSent = false;
  }

  /**
   * Start processing the job
   */
  start(): void {
    if (this.status !== 'pending') {
      throw new Error(`Cannot start job in ${this.status} status`);
    }
    this.status = 'processing';
    this.startedAt = new Date().toISOString();
  }

  /**
   * Update job progress
   */
  updateProgress(progress: number): void {
    if (this.status !== 'processing') {
      throw new Error(`Cannot update progress for job in ${this.status} status`);
    }
    this.progress = Math.max(0, Math.min(100, progress));
  }

  /**
   * Complete the job successfully
   */
  complete(result: JobResult): void {
    if (this.status !== 'processing') {
      throw new Error(`Cannot complete job in ${this.status} status`);
    }
    this.status = 'completed';
    this.progress = 100;
    this.completedAt = new Date().toISOString();
    this.result = result;
  }

  /**
   * Fail the job
   */
  fail(error: string): void {
    this.status = 'failed';
    this.completedAt = new Date().toISOString();
    this.error = error;
  }

  /**
   * Cancel the job
   */
  cancel(): void {
    if (this.status === 'completed' || this.status === 'failed') {
      throw new Error(`Cannot cancel job in ${this.status} status`);
    }
    this.status = 'cancelled';
    this.completedAt = new Date().toISOString();
  }

  /**
   * Mark webhook as sent
   */
  markWebhookSent(): void {
    this.webhookSent = true;
  }

  /**
   * Check if job has expired
   */
  isExpired(): boolean {
    return new Date() > new Date(this.expiresAt);
  }

  /**
   * Convert to plain object
   */
  toJSON(): IAsyncJob {
    return {
      id: this.id,
      type: this.type,
      status: this.status,
      progress: this.progress,
      progressMessage: this.progressMessage,
      createdAt: this.createdAt,
      startedAt: this.startedAt,
      completedAt: this.completedAt,
      expiresAt: this.expiresAt,
      parameters: this.parameters,
      result: this.result,
      webhookUrl: this.webhookUrl,
      webhookSent: this.webhookSent,
      webhookDeliveryStatus: this.webhookDeliveryStatus,
      webhookDeliveryError: this.webhookDeliveryError,
      error: this.error,
    };
  }

  /**
   * Create from plain object
   */
  static fromJSON(data: IAsyncJob): AsyncJob {
    const job = new AsyncJob({
      id: data.id,
      type: data.type,
      parameters: data.parameters,
      webhookUrl: data.webhookUrl,
      expiresAt: data.expiresAt,
    });
    job.status = data.status;
    job.progress = data.progress;
    job.progressMessage = data.progressMessage;
    job.startedAt = data.startedAt;
    job.completedAt = data.completedAt;
    job.result = data.result;
    job.webhookSent = data.webhookSent ?? false;
    job.webhookDeliveryStatus = data.webhookDeliveryStatus;
    job.webhookDeliveryError = data.webhookDeliveryError;
    job.error = data.error;
    return job;
  }

  private generateId(): string {
    return `job_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
  }

  private calculateExpiry(): string {
    // Default expiry: 24 hours from creation
    const expiry = new Date();
    expiry.setHours(expiry.getHours() + 24);
    return expiry.toISOString();
  }
}

export interface CreateJobData {
  id?: string;
  type: JobType;
  status?: JobStatus;
  parameters?: JobParameters;
  /** Generic metadata for jobs that don't fit standard parameters */
  metadata?: Record<string, unknown>;
  webhookUrl?: string;
  expiresAt?: string;
}

/**
 * API request/response types
 */
export interface CreateExportJobRequest {
  graphId: string;
  scope: 'full' | 'filtered';
  filters?: ExportFilters;
  includeProvenance?: boolean;
  webhook?: string;
}

export interface CreateExportJobResponse {
  jobId: string;
  estimatedSize?: number;
  estimatedTime?: number;
}

export interface JobStatusResponse {
  id: string;
  type: JobType;
  status: JobStatus;
  progress: number;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  result?: JobResult;
  error?: string;
}
