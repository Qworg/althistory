/**
 * Repository for managing async jobs (export, import, ingest).
 *
 * Jobs are persisted as one JSON file per job under `<dataDir>/jobs` in every
 * mode: the repository is constructed with `localExecution.dataDirectory` and
 * has no Redis/Neo4j backend. See `Container.initialize`.
 */

import * as fs from 'fs';
import * as path from 'path';
import { AsyncJob, IAsyncJob, JobType, JobStatus, CreateJobData } from '../models/AsyncJob';

export interface JobRepositoryConfig {
  dataDir: string;
  cleanupIntervalMs?: number;
}

export interface JobFilter {
  type?: JobType;
  status?: JobStatus | JobStatus[];
  createdAfter?: string;
  createdBefore?: string;
}

/**
 * Repository for persisting and managing async jobs
 */
export class JobRepository {
  private readonly dataDir: string;
  private readonly jobsDir: string;
  private jobs: Map<string, AsyncJob> = new Map();
  private initialized = false;
  private cleanupInterval?: NodeJS.Timeout;
  private readonly cleanupIntervalMs: number;

  constructor(config: JobRepositoryConfig) {
    this.dataDir = config.dataDir;
    this.jobsDir = path.join(config.dataDir, 'jobs');
    this.cleanupIntervalMs = config.cleanupIntervalMs || 60 * 60 * 1000; // 1 hour default
  }

  /**
   * Initialize the repository
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    // Ensure jobs directory exists
    await fs.promises.mkdir(this.jobsDir, { recursive: true });

    // Load existing jobs from disk
    await this.loadJobs();

    // Start cleanup interval
    this.cleanupInterval = setInterval(() => {
      this.cleanupExpiredJobs().catch(console.error);
    }, this.cleanupIntervalMs);

    this.initialized = true;
  }

  /**
   * Stop the repository (cleanup interval)
   */
  stop(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = undefined;
    }
  }

  /**
   * Create a new job
   */
  async create(data: CreateJobData): Promise<AsyncJob> {
    const job = new AsyncJob(data);
    this.jobs.set(job.id, job);
    await this.persistJob(job);
    return job;
  }

  /**
   * Find a job by ID
   */
  async findById(id: string): Promise<AsyncJob | null> {
    return this.jobs.get(id) || null;
  }

  /**
   * Find all jobs matching filter
   */
  async findAll(filter?: JobFilter): Promise<AsyncJob[]> {
    let jobs = Array.from(this.jobs.values());

    if (filter) {
      jobs = jobs.filter(job => {
        if (filter.type && job.type !== filter.type) return false;
        
        if (filter.status) {
          const statuses = Array.isArray(filter.status) ? filter.status : [filter.status];
          if (!statuses.includes(job.status)) return false;
        }
        
        if (filter.createdAfter && job.createdAt < filter.createdAfter) return false;
        if (filter.createdBefore && job.createdAt > filter.createdBefore) return false;
        
        return true;
      });
    }

    // Sort by createdAt descending (newest first)
    jobs.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    
    return jobs;
  }

  /**
   * Update a job
   */
  async update(job: AsyncJob): Promise<AsyncJob> {
    if (!this.jobs.has(job.id)) {
      throw new Error(`Job not found: ${job.id}`);
    }
    this.jobs.set(job.id, job);
    await this.persistJob(job);
    return job;
  }

  /**
   * Delete a job
   */
  async delete(id: string): Promise<boolean> {
    const job = this.jobs.get(id);
    if (!job) return false;

    this.jobs.delete(id);
    
    const jobPath = path.join(this.jobsDir, `${id}.json`);
    try {
      await fs.promises.unlink(jobPath);
    } catch {
      // File may not exist
    }

    return true;
  }

  /**
   * Get next pending job for processing
   */
  async getNextPending(type?: JobType): Promise<AsyncJob | null> {
    const jobs = await this.findAll({
      type,
      status: 'pending',
    });

    // Return oldest pending job
    return jobs.length > 0 ? jobs[jobs.length - 1] : null;
  }

  /**
   * Get job statistics
   */
  async getStats(): Promise<JobStats> {
    const jobs = Array.from(this.jobs.values());
    
    const stats: JobStats = {
      total: jobs.length,
      byStatus: {
        pending: 0,
        processing: 0,
        completed: 0,
        failed: 0,
        cancelled: 0,
      },
      byType: {
        export: 0,
        import: 0,
        ingest: 0,
      },
    };

    for (const job of jobs) {
      stats.byStatus[job.status]++;
      stats.byType[job.type]++;
    }

    return stats;
  }

  /**
   * Cleanup expired jobs and their associated output files
   */
  async cleanupExpiredJobs(): Promise<number> {
    const now = new Date().toISOString();
    let count = 0;

    const jobs = Array.from(this.jobs.values());
    for (const job of jobs) {
      if (job.expiresAt < now && (job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled')) {
        const outputPath = job.result?.outputPath;
        if (typeof outputPath === 'string' && outputPath.length > 0) {
          try {
            await fs.promises.unlink(outputPath);
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
              console.warn(`Failed to delete expired job output file ${outputPath}:`, error);
            }
          }
        }
        await this.delete(job.id);
        count++;
      }
    }

    return count;
  }

  /**
   * Find stalled jobs (processing for too long)
   */
  async findStalledJobs(maxProcessingMs: number = 30 * 60 * 1000): Promise<AsyncJob[]> {
    const jobs = await this.findAll({ status: 'processing' });
    const cutoff = new Date(Date.now() - maxProcessingMs).toISOString();
    
    return jobs.filter(job => job.startedAt && job.startedAt < cutoff);
  }

  /**
   * Mark stalled jobs as failed
   */
  async recoverStalledJobs(maxProcessingMs?: number): Promise<number> {
    const stalledJobs = await this.findStalledJobs(maxProcessingMs);
    
    for (const job of stalledJobs) {
      job.fail('Job stalled - exceeded maximum processing time');
      await this.update(job);
    }

    return stalledJobs.length;
  }

  // Private methods

  private async loadJobs(): Promise<void> {
    try {
      const files = await fs.promises.readdir(this.jobsDir);
      
      for (const file of files) {
        if (!file.endsWith('.json')) continue;
        
        try {
          const content = await fs.promises.readFile(
            path.join(this.jobsDir, file),
            'utf8'
          );
          const data = JSON.parse(content) as IAsyncJob;
          const job = AsyncJob.fromJSON(data);
          this.jobs.set(job.id, job);
        } catch (err) {
          console.error(`Failed to load job from ${file}:`, err);
        }
      }
    } catch (err) {
      // Directory may not exist yet
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw err;
      }
    }
  }

  private async persistJob(job: AsyncJob): Promise<void> {
    const jobPath = path.join(this.jobsDir, `${job.id}.json`);
    await fs.promises.writeFile(
      jobPath,
      JSON.stringify(job.toJSON(), null, 2),
      'utf8'
    );
  }
}

export interface JobStats {
  total: number;
  byStatus: Record<JobStatus, number>;
  byType: Record<JobType, number>;
}
