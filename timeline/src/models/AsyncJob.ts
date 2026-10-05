/**
 * Async Job model for long-running operations like export, import, and ingestion
 */

export type JobType = 'export' | 'import' | 'ingest';
export type JobStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled';

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

export interface JobResult {
  outputPath?: string;
  summary?: Record<string, unknown>;
  errors?: string[];
  warnings?: string[];
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
  public error?: string;

  constructor(data: CreateJobData) {
    this.id = data.id || this.generateId();
    this.type = data.type;
    this.status = data.status || 'pending';
    this.progress = 0;
    this.createdAt = new Date().toISOString();
    this.expiresAt = data.expiresAt || this.calculateExpiry();
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
