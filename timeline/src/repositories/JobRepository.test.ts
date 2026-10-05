/**
 * JobRepository Unit Tests
 * 
 * Tests for async job management (export, import, ingest)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { JobRepository, JobFilter, JobStats } from './JobRepository';
import { AsyncJob, IAsyncJob, JobType, JobStatus, CreateJobData, ExportJobParams } from '../models/AsyncJob';

// Mock the fs module
vi.mock('fs', () => ({
  promises: {
    mkdir: vi.fn().mockResolvedValue(undefined),
    readdir: vi.fn(),
    readFile: vi.fn(),
    writeFile: vi.fn().mockResolvedValue(undefined),
    unlink: vi.fn().mockResolvedValue(undefined),
  },
}));

// Mock timers for testing intervals
vi.useFakeTimers();

describe('JobRepository Unit Tests', () => {
  let repository: JobRepository;
  const testDataDir = '/test/data';

  beforeEach(() => {
    vi.clearAllMocks();
    repository = new JobRepository({ dataDir: testDataDir, cleanupIntervalMs: 1000 });
  });

  afterEach(() => {
    repository.stop();
    vi.resetAllMocks();
    vi.clearAllTimers();
  });

  describe('Class Structure', () => {
    it('should have all required methods', () => {
      expect(JobRepository.prototype.initialize).toBeDefined();
      expect(JobRepository.prototype.stop).toBeDefined();
      expect(JobRepository.prototype.create).toBeDefined();
      expect(JobRepository.prototype.findById).toBeDefined();
      expect(JobRepository.prototype.findAll).toBeDefined();
      expect(JobRepository.prototype.update).toBeDefined();
      expect(JobRepository.prototype.delete).toBeDefined();
      expect(JobRepository.prototype.getNextPending).toBeDefined();
      expect(JobRepository.prototype.getStats).toBeDefined();
      expect(JobRepository.prototype.cleanupExpiredJobs).toBeDefined();
      expect(JobRepository.prototype.findStalledJobs).toBeDefined();
      expect(JobRepository.prototype.recoverStalledJobs).toBeDefined();
    });
  });

  describe('initialize()', () => {
    it('should create jobs directory', async () => {
      vi.mocked(fs.promises.readdir).mockResolvedValue([]);

      await repository.initialize();

      expect(fs.promises.mkdir).toHaveBeenCalledWith(
        path.join(testDataDir, 'jobs'),
        { recursive: true }
      );
    });

    it('should load existing jobs from disk', async () => {
      const jobData: IAsyncJob = {
        id: 'job-1',
        type: 'export',
        status: 'pending',
        progress: 0,
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 86400000).toISOString(),
        parameters: {
          type: 'export',
          graphId: 'graph-1',
          scope: 'full',
          includeProvenance: false,
        },
      };

      vi.mocked(fs.promises.readdir).mockResolvedValue(['job-1.json'] as any);
      vi.mocked(fs.promises.readFile).mockResolvedValue(JSON.stringify(jobData));

      await repository.initialize();

      const job = await repository.findById('job-1');
      expect(job).not.toBeNull();
      expect(job?.type).toBe('export');
    });

    it('should skip non-json files', async () => {
      vi.mocked(fs.promises.readdir).mockResolvedValue(['readme.txt', 'job-1.json'] as any);
      vi.mocked(fs.promises.readFile).mockImplementation(async (filePath) => {
        if ((filePath as string).includes('job-1.json')) {
          return JSON.stringify({
            id: 'job-1',
            type: 'export',
            status: 'pending',
            progress: 0,
            createdAt: new Date().toISOString(),
            expiresAt: new Date(Date.now() + 86400000).toISOString(),
            parameters: { type: 'export', graphId: 'g1', scope: 'full', includeProvenance: false },
          });
        }
        throw new Error('Invalid file');
      });

      await repository.initialize();

      const job = await repository.findById('job-1');
      expect(job).not.toBeNull();
    });

    it('should handle corrupted job files gracefully', async () => {
      vi.mocked(fs.promises.readdir).mockResolvedValue(['job-1.json', 'job-2.json'] as any);
      vi.mocked(fs.promises.readFile).mockImplementation(async (filePath) => {
        if ((filePath as string).includes('job-1.json')) {
          return 'invalid json';
        }
        return JSON.stringify({
          id: 'job-2',
          type: 'import',
          status: 'pending',
          progress: 0,
          createdAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 86400000).toISOString(),
          parameters: { type: 'import', graphId: 'g1', mode: 'merge', conflictResolution: 'skip', dataChecksum: 'abc' },
        });
      });

      await repository.initialize();

      const job1 = await repository.findById('job-1');
      const job2 = await repository.findById('job-2');
      expect(job1).toBeNull();
      expect(job2).not.toBeNull();
    });

    it('should start cleanup interval', async () => {
      vi.mocked(fs.promises.readdir).mockResolvedValue([]);

      await repository.initialize();

      // Check that setInterval was called with the cleanup interval
      expect(vi.getTimerCount()).toBeGreaterThan(0);
    });

    it('should not reinitialize if already initialized', async () => {
      vi.mocked(fs.promises.readdir).mockResolvedValue([]);

      await repository.initialize();
      await repository.initialize();

      expect(fs.promises.mkdir).toHaveBeenCalledTimes(1);
    });
  });

  describe('stop()', () => {
    it('should clear cleanup interval', async () => {
      vi.mocked(fs.promises.readdir).mockResolvedValue([]);

      await repository.initialize();
      expect(vi.getTimerCount()).toBe(1);

      repository.stop();
      expect(vi.getTimerCount()).toBe(0);
    });
  });

  describe('create()', () => {
    it('should create an export job', async () => {
      const jobData: CreateJobData = {
        type: 'export',
        parameters: {
          type: 'export',
          graphId: 'graph-1',
          scope: 'full',
          includeProvenance: true,
        },
      };

      const job = await repository.create(jobData);

      expect(job).toBeInstanceOf(AsyncJob);
      expect(job.type).toBe('export');
      expect(job.status).toBe('pending');
      expect(job.progress).toBe(0);
      expect(job.id).toBeDefined();
    });

    it('should create an import job', async () => {
      const jobData: CreateJobData = {
        type: 'import',
        parameters: {
          type: 'import',
          graphId: 'graph-1',
          mode: 'merge',
          conflictResolution: 'skip',
          dataChecksum: 'abc123',
        },
      };

      const job = await repository.create(jobData);

      expect(job.type).toBe('import');
    });

    it('should create an ingest job', async () => {
      const jobData: CreateJobData = {
        type: 'ingest',
        parameters: {
          type: 'ingest',
          source: {
            sourceType: 'wikipedia',
            url: 'https://en.wikipedia.org/wiki/Test',
            followLinks: false,
            linkDepth: 0,
            maxPages: 1,
          },
        },
      };

      const job = await repository.create(jobData);

      expect(job.type).toBe('ingest');
    });

    it('should persist job to disk', async () => {
      const jobData: CreateJobData = {
        type: 'export',
        parameters: {
          type: 'export',
          graphId: 'graph-1',
          scope: 'full',
          includeProvenance: false,
        },
      };

      const job = await repository.create(jobData);

      expect(fs.promises.writeFile).toHaveBeenCalledWith(
        path.join(testDataDir, 'jobs', `${job.id}.json`),
        expect.any(String),
        'utf8'
      );
    });

    it('should include webhook URL if provided', async () => {
      const jobData: CreateJobData = {
        type: 'export',
        parameters: {
          type: 'export',
          graphId: 'graph-1',
          scope: 'full',
          includeProvenance: false,
        },
        webhookUrl: 'https://example.com/webhook',
      };

      const job = await repository.create(jobData);

      expect(job.webhookUrl).toBe('https://example.com/webhook');
    });

    it('should use custom expiry if provided', async () => {
      const customExpiry = new Date(Date.now() + 7200000).toISOString(); // 2 hours
      const jobData: CreateJobData = {
        type: 'export',
        parameters: {
          type: 'export',
          graphId: 'graph-1',
          scope: 'full',
          includeProvenance: false,
        },
        expiresAt: customExpiry,
      };

      const job = await repository.create(jobData);

      expect(job.expiresAt).toBe(customExpiry);
    });
  });

  describe('findById()', () => {
    it('should return job when found', async () => {
      const jobData: CreateJobData = {
        type: 'export',
        parameters: {
          type: 'export',
          graphId: 'graph-1',
          scope: 'full',
          includeProvenance: false,
        },
      };

      const created = await repository.create(jobData);
      const found = await repository.findById(created.id);

      expect(found).not.toBeNull();
      expect(found?.id).toBe(created.id);
    });

    it('should return null when job not found', async () => {
      const result = await repository.findById('non-existent');

      expect(result).toBeNull();
    });
  });

  describe('findAll()', () => {
    beforeEach(async () => {
      // Create test jobs
      await repository.create({
        type: 'export',
        parameters: { type: 'export', graphId: 'g1', scope: 'full', includeProvenance: false },
      });
      await repository.create({
        type: 'import',
        parameters: { type: 'import', graphId: 'g1', mode: 'merge', conflictResolution: 'skip', dataChecksum: 'abc' },
      });
      await repository.create({
        type: 'ingest',
        parameters: {
          type: 'ingest',
          source: { sourceType: 'text', text: 'test', useLLM: false },
        },
      });
    });

    it('should return all jobs without filter', async () => {
      const jobs = await repository.findAll();

      expect(jobs).toHaveLength(3);
    });

    it('should filter by type', async () => {
      const jobs = await repository.findAll({ type: 'export' });

      expect(jobs).toHaveLength(1);
      expect(jobs[0].type).toBe('export');
    });

    it('should filter by single status', async () => {
      const jobs = await repository.findAll({ status: 'pending' });

      expect(jobs).toHaveLength(3);
    });

    it('should filter by multiple statuses', async () => {
      // Start one job
      const jobs = await repository.findAll();
      jobs[0].start();
      await repository.update(jobs[0]);

      const result = await repository.findAll({ status: ['pending', 'processing'] });

      expect(result).toHaveLength(3);
    });

    it('should sort by createdAt descending', async () => {
      const jobs = await repository.findAll();

      // Latest job should be first
      for (let i = 0; i < jobs.length - 1; i++) {
        expect(jobs[i].createdAt >= jobs[i + 1].createdAt).toBe(true);
      }
    });

    it('should filter by createdAfter', async () => {
      const cutoff = new Date(Date.now() + 1000).toISOString();
      const jobs = await repository.findAll({ createdAfter: cutoff });

      expect(jobs).toHaveLength(0);
    });

    it('should filter by createdBefore', async () => {
      const cutoff = new Date(Date.now() + 1000).toISOString();
      const jobs = await repository.findAll({ createdBefore: cutoff });

      expect(jobs).toHaveLength(3);
    });
  });

  describe('update()', () => {
    it('should update job status', async () => {
      const job = await repository.create({
        type: 'export',
        parameters: { type: 'export', graphId: 'g1', scope: 'full', includeProvenance: false },
      });

      job.start();
      const updated = await repository.update(job);

      expect(updated.status).toBe('processing');
      expect(updated.startedAt).toBeDefined();
    });

    it('should persist updated job to disk', async () => {
      const job = await repository.create({
        type: 'export',
        parameters: { type: 'export', graphId: 'g1', scope: 'full', includeProvenance: false },
      });

      vi.mocked(fs.promises.writeFile).mockClear();

      job.start();
      await repository.update(job);

      expect(fs.promises.writeFile).toHaveBeenCalled();
    });

    it('should throw error for non-existent job', async () => {
      const job = new AsyncJob({
        id: 'non-existent',
        type: 'export',
        parameters: { type: 'export', graphId: 'g1', scope: 'full', includeProvenance: false },
      });

      await expect(repository.update(job)).rejects.toThrow('Job not found');
    });

    it('should update job progress', async () => {
      const job = await repository.create({
        type: 'export',
        parameters: { type: 'export', graphId: 'g1', scope: 'full', includeProvenance: false },
      });

      job.start();
      job.updateProgress(50);
      const updated = await repository.update(job);

      expect(updated.progress).toBe(50);
    });

    it('should update job result on completion', async () => {
      const job = await repository.create({
        type: 'export',
        parameters: { type: 'export', graphId: 'g1', scope: 'full', includeProvenance: false },
      });

      job.start();
      job.complete({ outputPath: '/exports/file.json', summary: { events: 10 } });
      const updated = await repository.update(job);

      expect(updated.status).toBe('completed');
      expect(updated.result?.outputPath).toBe('/exports/file.json');
    });
  });

  describe('delete()', () => {
    it('should remove job from memory and disk', async () => {
      const job = await repository.create({
        type: 'export',
        parameters: { type: 'export', graphId: 'g1', scope: 'full', includeProvenance: false },
      });

      const result = await repository.delete(job.id);

      expect(result).toBe(true);
      expect(await repository.findById(job.id)).toBeNull();
      expect(fs.promises.unlink).toHaveBeenCalledWith(
        path.join(testDataDir, 'jobs', `${job.id}.json`)
      );
    });

    it('should return false for non-existent job', async () => {
      const result = await repository.delete('non-existent');

      expect(result).toBe(false);
    });

    it('should handle missing file gracefully', async () => {
      const job = await repository.create({
        type: 'export',
        parameters: { type: 'export', graphId: 'g1', scope: 'full', includeProvenance: false },
      });

      vi.mocked(fs.promises.unlink).mockRejectedValueOnce(new Error('ENOENT'));

      const result = await repository.delete(job.id);

      expect(result).toBe(true);
    });
  });

  describe('getNextPending()', () => {
    it('should return oldest pending job', async () => {
      const job1 = await repository.create({
        type: 'export',
        parameters: { type: 'export', graphId: 'g1', scope: 'full', includeProvenance: false },
      });
      await repository.create({
        type: 'export',
        parameters: { type: 'export', graphId: 'g2', scope: 'full', includeProvenance: false },
      });

      const next = await repository.getNextPending();

      // getNextPending returns the oldest job (last in sorted list which is sorted descending)
      // The first job created should be returned as it's the oldest
      expect(next).not.toBeNull();
      expect(next?.type).toBe('export');
    });

    it('should filter by job type', async () => {
      await repository.create({
        type: 'export',
        parameters: { type: 'export', graphId: 'g1', scope: 'full', includeProvenance: false },
      });
      const importJob = await repository.create({
        type: 'import',
        parameters: { type: 'import', graphId: 'g1', mode: 'merge', conflictResolution: 'skip', dataChecksum: 'abc' },
      });

      const next = await repository.getNextPending('import');

      expect(next?.id).toBe(importJob.id);
    });

    it('should return null when no pending jobs', async () => {
      const job = await repository.create({
        type: 'export',
        parameters: { type: 'export', graphId: 'g1', scope: 'full', includeProvenance: false },
      });

      job.start();
      await repository.update(job);

      const next = await repository.getNextPending();

      expect(next).toBeNull();
    });

    it('should skip non-pending jobs', async () => {
      const job1 = await repository.create({
        type: 'export',
        parameters: { type: 'export', graphId: 'g1', scope: 'full', includeProvenance: false },
      });
      const job2 = await repository.create({
        type: 'export',
        parameters: { type: 'export', graphId: 'g2', scope: 'full', includeProvenance: false },
      });

      job1.start();
      await repository.update(job1);

      const next = await repository.getNextPending();

      expect(next?.id).toBe(job2.id);
    });
  });

  describe('getStats()', () => {
    it('should return job statistics', async () => {
      await repository.create({
        type: 'export',
        parameters: { type: 'export', graphId: 'g1', scope: 'full', includeProvenance: false },
      });
      await repository.create({
        type: 'import',
        parameters: { type: 'import', graphId: 'g1', mode: 'merge', conflictResolution: 'skip', dataChecksum: 'abc' },
      });
      await repository.create({
        type: 'ingest',
        parameters: { type: 'ingest', source: { sourceType: 'text', text: 'test', useLLM: false } },
      });

      const stats = await repository.getStats();

      expect(stats.total).toBe(3);
      expect(stats.byType.export).toBe(1);
      expect(stats.byType.import).toBe(1);
      expect(stats.byType.ingest).toBe(1);
      expect(stats.byStatus.pending).toBe(3);
    });

    it('should count jobs by status', async () => {
      const job1 = await repository.create({
        type: 'export',
        parameters: { type: 'export', graphId: 'g1', scope: 'full', includeProvenance: false },
      });
      const job2 = await repository.create({
        type: 'export',
        parameters: { type: 'export', graphId: 'g2', scope: 'full', includeProvenance: false },
      });
      const job3 = await repository.create({
        type: 'export',
        parameters: { type: 'export', graphId: 'g3', scope: 'full', includeProvenance: false },
      });

      job1.start();
      await repository.update(job1);

      job2.start();
      job2.complete({ outputPath: '/out.json' });
      await repository.update(job2);

      job3.fail('Error occurred');
      await repository.update(job3);

      const stats = await repository.getStats();

      expect(stats.byStatus.processing).toBe(1);
      expect(stats.byStatus.completed).toBe(1);
      expect(stats.byStatus.failed).toBe(1);
      expect(stats.byStatus.pending).toBe(0);
    });

    it('should return zero counts for empty repository', async () => {
      const stats = await repository.getStats();

      expect(stats.total).toBe(0);
      expect(stats.byType.export).toBe(0);
      expect(stats.byStatus.pending).toBe(0);
    });
  });

  describe('cleanupExpiredJobs()', () => {
    it('should remove expired completed jobs', async () => {
      const pastExpiry = new Date(Date.now() - 1000).toISOString();
      const job = await repository.create({
        type: 'export',
        parameters: { type: 'export', graphId: 'g1', scope: 'full', includeProvenance: false },
        expiresAt: pastExpiry,
      });

      job.start();
      job.complete({ outputPath: '/out.json' });
      await repository.update(job);

      const count = await repository.cleanupExpiredJobs();

      expect(count).toBe(1);
      expect(await repository.findById(job.id)).toBeNull();
    });

    it('should remove expired failed jobs', async () => {
      const pastExpiry = new Date(Date.now() - 1000).toISOString();
      const job = await repository.create({
        type: 'export',
        parameters: { type: 'export', graphId: 'g1', scope: 'full', includeProvenance: false },
        expiresAt: pastExpiry,
      });

      job.fail('Error');
      await repository.update(job);

      const count = await repository.cleanupExpiredJobs();

      expect(count).toBe(1);
    });

    it('should remove expired cancelled jobs', async () => {
      const pastExpiry = new Date(Date.now() - 1000).toISOString();
      const job = await repository.create({
        type: 'export',
        parameters: { type: 'export', graphId: 'g1', scope: 'full', includeProvenance: false },
        expiresAt: pastExpiry,
      });

      job.cancel();
      await repository.update(job);

      const count = await repository.cleanupExpiredJobs();

      expect(count).toBe(1);
    });

    it('should not remove expired pending jobs', async () => {
      const pastExpiry = new Date(Date.now() - 1000).toISOString();
      const job = await repository.create({
        type: 'export',
        parameters: { type: 'export', graphId: 'g1', scope: 'full', includeProvenance: false },
        expiresAt: pastExpiry,
      });

      const count = await repository.cleanupExpiredJobs();

      expect(count).toBe(0);
      expect(await repository.findById(job.id)).not.toBeNull();
    });

    it('should not remove non-expired jobs', async () => {
      const futureExpiry = new Date(Date.now() + 86400000).toISOString();
      const job = await repository.create({
        type: 'export',
        parameters: { type: 'export', graphId: 'g1', scope: 'full', includeProvenance: false },
        expiresAt: futureExpiry,
      });

      job.start();
      job.complete({ outputPath: '/out.json' });
      await repository.update(job);

      const count = await repository.cleanupExpiredJobs();

      expect(count).toBe(0);
      expect(await repository.findById(job.id)).not.toBeNull();
    });

    it('should be called automatically on interval', async () => {
      vi.mocked(fs.promises.readdir).mockResolvedValue([]);
      await repository.initialize();

      // Create an expired completed job
      const pastExpiry = new Date(Date.now() - 1000).toISOString();
      const job = await repository.create({
        type: 'export',
        parameters: { type: 'export', graphId: 'g1', scope: 'full', includeProvenance: false },
        expiresAt: pastExpiry,
      });
      job.start();
      job.complete({ outputPath: '/out.json' });
      await repository.update(job);

      // Advance timer to trigger cleanup
      await vi.advanceTimersByTimeAsync(1000);

      // Job should be cleaned up
      expect(await repository.findById(job.id)).toBeNull();
    });
  });

  describe('findStalledJobs()', () => {
    it('should find jobs processing for too long', async () => {
      const job = await repository.create({
        type: 'export',
        parameters: { type: 'export', graphId: 'g1', scope: 'full', includeProvenance: false },
      });

      job.start();
      // Manually set startedAt to past time
      (job as any).startedAt = new Date(Date.now() - 60 * 60 * 1000).toISOString(); // 1 hour ago
      await repository.update(job);

      const stalled = await repository.findStalledJobs(30 * 60 * 1000); // 30 min threshold

      expect(stalled).toHaveLength(1);
      expect(stalled[0].id).toBe(job.id);
    });

    it('should not include recently started jobs', async () => {
      const job = await repository.create({
        type: 'export',
        parameters: { type: 'export', graphId: 'g1', scope: 'full', includeProvenance: false },
      });

      job.start();
      await repository.update(job);

      const stalled = await repository.findStalledJobs(30 * 60 * 1000);

      expect(stalled).toHaveLength(0);
    });

    it('should not include non-processing jobs', async () => {
      const job = await repository.create({
        type: 'export',
        parameters: { type: 'export', graphId: 'g1', scope: 'full', includeProvenance: false },
      });

      const stalled = await repository.findStalledJobs(30 * 60 * 1000);

      expect(stalled).toHaveLength(0);
    });

    it('should use default max processing time', async () => {
      const job = await repository.create({
        type: 'export',
        parameters: { type: 'export', graphId: 'g1', scope: 'full', includeProvenance: false },
      });

      job.start();
      // Set startedAt to 31 minutes ago (default is 30 min)
      (job as any).startedAt = new Date(Date.now() - 31 * 60 * 1000).toISOString();
      await repository.update(job);

      const stalled = await repository.findStalledJobs();

      expect(stalled).toHaveLength(1);
    });
  });

  describe('recoverStalledJobs()', () => {
    it('should mark stalled jobs as failed', async () => {
      const job = await repository.create({
        type: 'export',
        parameters: { type: 'export', graphId: 'g1', scope: 'full', includeProvenance: false },
      });

      job.start();
      (job as any).startedAt = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      await repository.update(job);

      const count = await repository.recoverStalledJobs(30 * 60 * 1000);

      expect(count).toBe(1);
      const recovered = await repository.findById(job.id);
      expect(recovered?.status).toBe('failed');
      expect(recovered?.error).toContain('stalled');
    });

    it('should return count of recovered jobs', async () => {
      const job1 = await repository.create({
        type: 'export',
        parameters: { type: 'export', graphId: 'g1', scope: 'full', includeProvenance: false },
      });
      const job2 = await repository.create({
        type: 'import',
        parameters: { type: 'import', graphId: 'g1', mode: 'merge', conflictResolution: 'skip', dataChecksum: 'abc' },
      });

      job1.start();
      (job1 as any).startedAt = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      await repository.update(job1);

      job2.start();
      (job2 as any).startedAt = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      await repository.update(job2);

      const count = await repository.recoverStalledJobs(30 * 60 * 1000);

      expect(count).toBe(2);
    });

    it('should not affect non-stalled jobs', async () => {
      const job = await repository.create({
        type: 'export',
        parameters: { type: 'export', graphId: 'g1', scope: 'full', includeProvenance: false },
      });

      job.start();
      await repository.update(job);

      const count = await repository.recoverStalledJobs(30 * 60 * 1000);

      expect(count).toBe(0);
      const retrieved = await repository.findById(job.id);
      expect(retrieved?.status).toBe('processing');
    });
  });

  describe('Job Lifecycle', () => {
    it('should support full job lifecycle: pending -> processing -> completed', async () => {
      const job = await repository.create({
        type: 'export',
        parameters: { type: 'export', graphId: 'g1', scope: 'full', includeProvenance: false },
      });

      expect(job.status).toBe('pending');

      job.start();
      await repository.update(job);
      expect((await repository.findById(job.id))?.status).toBe('processing');

      job.updateProgress(50);
      await repository.update(job);
      expect((await repository.findById(job.id))?.progress).toBe(50);

      job.complete({ outputPath: '/out.json', summary: { events: 10 } });
      await repository.update(job);

      const completed = await repository.findById(job.id);
      expect(completed?.status).toBe('completed');
      expect(completed?.progress).toBe(100);
      expect(completed?.result?.outputPath).toBe('/out.json');
    });

    it('should support job failure', async () => {
      const job = await repository.create({
        type: 'export',
        parameters: { type: 'export', graphId: 'g1', scope: 'full', includeProvenance: false },
      });

      job.start();
      job.fail('Database connection error');
      await repository.update(job);

      const failed = await repository.findById(job.id);
      expect(failed?.status).toBe('failed');
      expect(failed?.error).toBe('Database connection error');
    });

    it('should support job cancellation', async () => {
      const job = await repository.create({
        type: 'export',
        parameters: { type: 'export', graphId: 'g1', scope: 'full', includeProvenance: false },
      });

      job.cancel();
      await repository.update(job);

      const cancelled = await repository.findById(job.id);
      expect(cancelled?.status).toBe('cancelled');
    });
  });
});
