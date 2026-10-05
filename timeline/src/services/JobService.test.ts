import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { JobService, JobProgress } from './JobService';
import { JobRepository, JobStats } from '../repositories/JobRepository';
import { GraphRepository } from '../repositories/GraphRepository';
import { ExportService } from './ExportService';
import { AsyncJob, IAsyncJob } from '../models/AsyncJob';
import { Graph, IGraph } from '../models/Graph';

// Mock repositories and services
vi.mock('../repositories/JobRepository');
vi.mock('../repositories/GraphRepository');
vi.mock('./ExportService');

describe('JobService', () => {
  let jobService: JobService;
  let mockJobRepository: {
    initialize: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    findById: ReturnType<typeof vi.fn>;
    findAll: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
    getNextPending: ReturnType<typeof vi.fn>;
    getStats: ReturnType<typeof vi.fn>;
    recoverStalledJobs: ReturnType<typeof vi.fn>;
    stop: ReturnType<typeof vi.fn>;
  };
  let mockGraphRepository: {
    initialize: ReturnType<typeof vi.fn>;
    findById: ReturnType<typeof vi.fn>;
  };
  let mockExportService: {
    initialize: ReturnType<typeof vi.fn>;
    estimateExportSize: ReturnType<typeof vi.fn>;
    exportToFile: ReturnType<typeof vi.fn>;
  };

  const createMockGraph = (): Graph => {
    const graphData: IGraph = {
      id: 'graph_123',
      name: 'Test Graph',
      description: 'A test graph',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
      version: 1,
      status: 'active',
      metadata: {
        eventCount: 10,
        arcCount: 3,
        relationshipCount: 5,
        pressureCount: 2,
      },
    };
    return new Graph(graphData);
  };

  const createMockJob = (overrides: Partial<IAsyncJob> = {}): AsyncJob => {
    const jobData: IAsyncJob = {
      id: 'job_123',
      type: 'export',
      status: 'pending',
      progress: 0,
      createdAt: '2024-01-01T00:00:00.000Z',
      expiresAt: '2024-01-02T00:00:00.000Z',
      parameters: {
        type: 'export',
        graphId: 'graph_123',
        scope: 'full',
        includeProvenance: false,
      },
      ...overrides,
    };
    return AsyncJob.fromJSON(jobData);
  };

  beforeEach(() => {
    mockJobRepository = {
      initialize: vi.fn().mockResolvedValue(undefined),
      create: vi.fn(),
      findById: vi.fn(),
      findAll: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      getNextPending: vi.fn(),
      getStats: vi.fn(),
      recoverStalledJobs: vi.fn().mockResolvedValue(0),
      stop: vi.fn(),
    };

    mockGraphRepository = {
      initialize: vi.fn().mockResolvedValue(undefined),
      findById: vi.fn(),
    };

    mockExportService = {
      initialize: vi.fn().mockResolvedValue(undefined),
      estimateExportSize: vi.fn(),
      exportToFile: vi.fn(),
    };

    vi.mocked(JobRepository).mockImplementation(() => mockJobRepository as unknown as JobRepository);
    vi.mocked(GraphRepository).mockImplementation(() => mockGraphRepository as unknown as GraphRepository);
    vi.mocked(ExportService).mockImplementation(() => mockExportService as unknown as ExportService);

    jobService = new JobService({ dataDir: './test-data' });
  });

  afterEach(() => {
    jobService.stop();
    vi.clearAllMocks();
  });

  describe('initialize', () => {
    it('should initialize all repositories and services', async () => {
      await jobService.initialize();

      expect(mockJobRepository.initialize).toHaveBeenCalled();
      expect(mockExportService.initialize).toHaveBeenCalled();
      expect(mockGraphRepository.initialize).toHaveBeenCalled();
    });

    it('should recover stalled jobs', async () => {
      mockJobRepository.recoverStalledJobs.mockResolvedValue(3);

      await jobService.initialize();

      expect(mockJobRepository.recoverStalledJobs).toHaveBeenCalled();
    });

    it('should not initialize twice', async () => {
      await jobService.initialize();
      await jobService.initialize();

      expect(mockJobRepository.initialize).toHaveBeenCalledTimes(1);
    });
  });

  describe('start/stop', () => {
    it('should start the job processing loop', async () => {
      await jobService.initialize();
      
      jobService.start();
      // Give it a moment to process
      await new Promise(resolve => setTimeout(resolve, 10));
      
      jobService.stop();
      
      expect(mockJobRepository.stop).toHaveBeenCalled();
    });

    it('should not start twice', async () => {
      await jobService.initialize();
      mockJobRepository.getNextPending.mockResolvedValue(null);
      
      jobService.start();
      jobService.start();
      
      await new Promise(resolve => setTimeout(resolve, 10));
      jobService.stop();
    });
  });

  describe('createExportJob', () => {
    it('should create an export job successfully', async () => {
      const mockJob = createMockJob();
      const mockGraph = createMockGraph();
      mockGraphRepository.findById.mockResolvedValue(mockGraph);
      mockJobRepository.create.mockResolvedValue(mockJob);
      mockExportService.estimateExportSize.mockResolvedValue(50000);

      const result = await jobService.createExportJob({
        graphId: 'graph_123',
        scope: 'full',
        includeProvenance: false,
      });

      expect(result.jobId).toBe('job_123');
      expect(result.estimatedSize).toBe(50000);
      expect(result.estimatedTime).toBeGreaterThan(0);
    });

    it('should throw error when graph not found', async () => {
      mockGraphRepository.findById.mockResolvedValue(null);

      await expect(jobService.createExportJob({
        graphId: 'nonexistent',
        scope: 'full',
      })).rejects.toThrow('Graph not found: nonexistent');
    });

    it('should pass filters to job parameters', async () => {
      const mockJob = createMockJob();
      const mockGraph = createMockGraph();
      mockGraphRepository.findById.mockResolvedValue(mockGraph);
      mockJobRepository.create.mockResolvedValue(mockJob);
      mockExportService.estimateExportSize.mockResolvedValue(10000);

      const filters = {
        timeRange: { start: '2024-01-01', end: '2024-12-31' },
        actors: ['Napoleon'],
      };

      await jobService.createExportJob({
        graphId: 'graph_123',
        scope: 'filtered',
        filters,
      });

      expect(mockJobRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'export',
          parameters: expect.objectContaining({
            scope: 'filtered',
            filters,
          }),
        })
      );
    });

    it('should set webhook URL when provided', async () => {
      const mockJob = createMockJob();
      const mockGraph = createMockGraph();
      mockGraphRepository.findById.mockResolvedValue(mockGraph);
      mockJobRepository.create.mockResolvedValue(mockJob);
      mockExportService.estimateExportSize.mockResolvedValue(10000);

      await jobService.createExportJob({
        graphId: 'graph_123',
        scope: 'full',
        webhook: 'https://example.com/webhook',
      });

      expect(mockJobRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          webhookUrl: 'https://example.com/webhook',
        })
      );
    });

    it('should emit jobCreated event', async () => {
      const mockJob = createMockJob();
      const mockGraph = createMockGraph();
      mockGraphRepository.findById.mockResolvedValue(mockGraph);
      mockJobRepository.create.mockResolvedValue(mockJob);
      mockExportService.estimateExportSize.mockResolvedValue(10000);

      const eventPromise = new Promise<{ jobId: string; type: string }>(resolve => {
        jobService.once('jobCreated', resolve);
      });

      await jobService.createExportJob({
        graphId: 'graph_123',
        scope: 'full',
      });

      const event = await eventPromise;
      expect(event.jobId).toBe('job_123');
      expect(event.type).toBe('export');
    });

    it('should default includeProvenance to false', async () => {
      const mockJob = createMockJob();
      const mockGraph = createMockGraph();
      mockGraphRepository.findById.mockResolvedValue(mockGraph);
      mockJobRepository.create.mockResolvedValue(mockJob);
      mockExportService.estimateExportSize.mockResolvedValue(10000);

      await jobService.createExportJob({
        graphId: 'graph_123',
        scope: 'full',
      });

      expect(mockJobRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          parameters: expect.objectContaining({
            includeProvenance: false,
          }),
        })
      );
    });
  });

  describe('createImportJob', () => {
    it('should create an import job', async () => {
      const mockJob = createMockJob({ type: 'import' });
      mockJobRepository.create.mockResolvedValue(mockJob);

      const jobId = await jobService.createImportJob({
        graphId: 'graph_123',
        mode: 'merge',
        conflictResolution: 'skip',
        dataChecksum: 'abc123',
      });

      expect(jobId).toBe('job_123');
      expect(mockJobRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'import',
        })
      );
    });

    it('should emit jobCreated event', async () => {
      const mockJob = createMockJob({ type: 'import' });
      mockJobRepository.create.mockResolvedValue(mockJob);

      const eventPromise = new Promise<{ jobId: string; type: string }>(resolve => {
        jobService.once('jobCreated', resolve);
      });

      await jobService.createImportJob({
        graphId: 'graph_123',
        mode: 'merge',
        conflictResolution: 'skip',
        dataChecksum: 'abc123',
      });

      const event = await eventPromise;
      expect(event.type).toBe('import');
    });
  });

  describe('createIngestJob', () => {
    it('should create an ingest job', async () => {
      const mockJob = createMockJob({ type: 'ingest' });
      mockJobRepository.create.mockResolvedValue(mockJob);

      const jobId = await jobService.createIngestJob({
        source: {
          sourceType: 'wikipedia',
          url: 'https://en.wikipedia.org/wiki/Test',
          followLinks: false,
          linkDepth: 0,
          maxPages: 1,
        },
      });

      expect(jobId).toBe('job_123');
      expect(mockJobRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'ingest',
        })
      );
    });
  });

  describe('getJob', () => {
    it('should return job when found', async () => {
      const mockJob = createMockJob();
      mockJobRepository.findById.mockResolvedValue(mockJob);

      const result = await jobService.getJob('job_123');

      expect(result).toBeDefined();
      expect(result?.id).toBe('job_123');
    });

    it('should return null when job not found', async () => {
      mockJobRepository.findById.mockResolvedValue(null);

      const result = await jobService.getJob('nonexistent');

      expect(result).toBeNull();
    });
  });

  describe('getJobs', () => {
    it('should return all jobs', async () => {
      const mockJobs = [createMockJob(), createMockJob({ id: 'job_456' })];
      mockJobRepository.findAll.mockResolvedValue(mockJobs);

      const result = await jobService.getJobs();

      expect(result).toHaveLength(2);
    });

    it('should pass filter to repository', async () => {
      mockJobRepository.findAll.mockResolvedValue([]);

      await jobService.getJobs({ type: 'export', status: 'completed' });

      expect(mockJobRepository.findAll).toHaveBeenCalledWith({
        type: 'export',
        status: 'completed',
      });
    });
  });

  describe('getStats', () => {
    it('should return job statistics', async () => {
      const mockStats: JobStats = {
        total: 10,
        byStatus: { pending: 2, processing: 1, completed: 5, failed: 1, cancelled: 1 },
        byType: { export: 6, import: 3, ingest: 1 },
      };
      mockJobRepository.getStats.mockResolvedValue(mockStats);

      const result = await jobService.getStats();

      expect(result.total).toBe(10);
      expect(result.byStatus.completed).toBe(5);
      expect(result.byType.export).toBe(6);
    });
  });

  describe('cancelJob', () => {
    it('should cancel a pending job', async () => {
      const mockJob = createMockJob({ status: 'pending' });
      mockJobRepository.findById.mockResolvedValue(mockJob);
      mockJobRepository.update.mockResolvedValue(mockJob);

      const result = await jobService.cancelJob('job_123');

      expect(result).toBe(true);
      expect(mockJobRepository.update).toHaveBeenCalled();
    });

    it('should cancel a processing job', async () => {
      const mockJob = createMockJob({ status: 'processing' });
      mockJobRepository.findById.mockResolvedValue(mockJob);
      mockJobRepository.update.mockResolvedValue(mockJob);

      const result = await jobService.cancelJob('job_123');

      expect(result).toBe(true);
    });

    it('should return false when job not found', async () => {
      mockJobRepository.findById.mockResolvedValue(null);

      const result = await jobService.cancelJob('nonexistent');

      expect(result).toBe(false);
    });

    it('should return false when trying to cancel completed job', async () => {
      const mockJob = createMockJob({ status: 'completed' });
      mockJobRepository.findById.mockResolvedValue(mockJob);

      const result = await jobService.cancelJob('job_123');

      expect(result).toBe(false);
    });

    it('should return false when trying to cancel failed job', async () => {
      const mockJob = createMockJob({ status: 'failed' });
      mockJobRepository.findById.mockResolvedValue(mockJob);

      const result = await jobService.cancelJob('job_123');

      expect(result).toBe(false);
    });

    it('should emit jobCancelled event', async () => {
      const mockJob = createMockJob({ status: 'pending' });
      mockJobRepository.findById.mockResolvedValue(mockJob);
      mockJobRepository.update.mockResolvedValue(mockJob);

      const eventPromise = new Promise<{ jobId: string }>(resolve => {
        jobService.once('jobCancelled', resolve);
      });

      await jobService.cancelJob('job_123');

      const event = await eventPromise;
      expect(event.jobId).toBe('job_123');
    });
  });

  describe('deleteJob', () => {
    it('should delete a completed job', async () => {
      const mockJob = createMockJob({ status: 'completed' });
      mockJobRepository.findById.mockResolvedValue(mockJob);
      mockJobRepository.delete.mockResolvedValue(true);

      const result = await jobService.deleteJob('job_123');

      expect(result).toBe(true);
      expect(mockJobRepository.delete).toHaveBeenCalledWith('job_123');
    });

    it('should delete a failed job', async () => {
      const mockJob = createMockJob({ status: 'failed' });
      mockJobRepository.findById.mockResolvedValue(mockJob);
      mockJobRepository.delete.mockResolvedValue(true);

      const result = await jobService.deleteJob('job_123');

      expect(result).toBe(true);
    });

    it('should delete a cancelled job', async () => {
      const mockJob = createMockJob({ status: 'cancelled' });
      mockJobRepository.findById.mockResolvedValue(mockJob);
      mockJobRepository.delete.mockResolvedValue(true);

      const result = await jobService.deleteJob('job_123');

      expect(result).toBe(true);
    });

    it('should return false when job not found', async () => {
      mockJobRepository.findById.mockResolvedValue(null);

      const result = await jobService.deleteJob('nonexistent');

      expect(result).toBe(false);
    });

    it('should throw error when trying to delete pending job', async () => {
      const mockJob = createMockJob({ status: 'pending' });
      mockJobRepository.findById.mockResolvedValue(mockJob);

      await expect(jobService.deleteJob('job_123'))
        .rejects.toThrow('Cannot delete a pending or processing job');
    });

    it('should throw error when trying to delete processing job', async () => {
      const mockJob = createMockJob({ status: 'processing' });
      mockJobRepository.findById.mockResolvedValue(mockJob);

      await expect(jobService.deleteJob('job_123'))
        .rejects.toThrow('Cannot delete a pending or processing job');
    });
  });

  describe('getExportFilePath', () => {
    it('should return file path for completed export job', async () => {
      const mockJob = createMockJob({
        status: 'completed',
        result: { outputPath: '/path/to/export.json' },
      });
      mockJobRepository.findById.mockResolvedValue(mockJob);

      const result = await jobService.getExportFilePath('job_123');

      expect(result).toBe('/path/to/export.json');
    });

    it('should return null when job not found', async () => {
      mockJobRepository.findById.mockResolvedValue(null);

      const result = await jobService.getExportFilePath('nonexistent');

      expect(result).toBeNull();
    });

    it('should return null when job is not an export', async () => {
      const mockJob = createMockJob({ type: 'import', status: 'completed' });
      mockJobRepository.findById.mockResolvedValue(mockJob);

      const result = await jobService.getExportFilePath('job_123');

      expect(result).toBeNull();
    });

    it('should return null when job is not completed', async () => {
      const mockJob = createMockJob({ status: 'pending' });
      mockJobRepository.findById.mockResolvedValue(mockJob);

      const result = await jobService.getExportFilePath('job_123');

      expect(result).toBeNull();
    });

    it('should return null when result has no outputPath', async () => {
      const mockJob = createMockJob({
        status: 'completed',
        result: { summary: {} },
      });
      mockJobRepository.findById.mockResolvedValue(mockJob);

      const result = await jobService.getExportFilePath('job_123');

      expect(result).toBeNull();
    });
  });

  describe('processNextJobs', () => {
    it('should process pending jobs when started', async () => {
      const mockJob = createMockJob({ status: 'pending' });
      mockJobRepository.getNextPending
        .mockResolvedValueOnce(mockJob)
        .mockResolvedValue(null);
      mockJobRepository.update.mockResolvedValue(mockJob);
      mockExportService.exportToFile.mockResolvedValue('/path/to/export.json');

      await jobService.initialize();
      jobService.start();

      // Wait for processing
      await new Promise(resolve => setTimeout(resolve, 100));

      jobService.stop();

      expect(mockJobRepository.getNextPending).toHaveBeenCalled();
    });

    it('should emit jobStarted event when job starts', async () => {
      const mockJob = createMockJob({ status: 'pending' });
      mockJobRepository.getNextPending
        .mockResolvedValueOnce(mockJob)
        .mockResolvedValue(null);
      mockJobRepository.update.mockResolvedValue(mockJob);
      mockExportService.exportToFile.mockResolvedValue('/path/to/export.json');

      const eventPromise = new Promise<{ jobId: string }>(resolve => {
        jobService.once('jobStarted', resolve);
      });

      await jobService.initialize();
      jobService.start();

      const event = await eventPromise;
      jobService.stop();

      expect(event.jobId).toBe('job_123');
    });

    it('should emit jobCompleted event on success', async () => {
      const mockJob = createMockJob({ status: 'pending' });
      mockJobRepository.getNextPending
        .mockResolvedValueOnce(mockJob)
        .mockResolvedValue(null);
      mockJobRepository.update.mockResolvedValue(mockJob);
      mockExportService.exportToFile.mockResolvedValue('/path/to/export.json');

      const eventPromise = new Promise<{ jobId: string; result: unknown }>(resolve => {
        jobService.once('jobCompleted', resolve);
      });

      await jobService.initialize();
      jobService.start();

      const event = await eventPromise;
      jobService.stop();

      expect(event.jobId).toBe('job_123');
      expect(event.result).toBeDefined();
    });

    it('should emit jobFailed event on error', async () => {
      const mockJob = createMockJob({ status: 'pending' });
      mockJobRepository.getNextPending
        .mockResolvedValueOnce(mockJob)
        .mockResolvedValue(null);
      mockJobRepository.update.mockResolvedValue(mockJob);
      mockExportService.exportToFile.mockRejectedValue(new Error('Export failed'));

      const eventPromise = new Promise<{ jobId: string; error: string }>(resolve => {
        jobService.once('jobFailed', resolve);
      });

      await jobService.initialize();
      jobService.start();

      const event = await eventPromise;
      jobService.stop();

      expect(event.jobId).toBe('job_123');
      expect(event.error).toBe('Export failed');
    });

    it('should emit jobProgress events during processing', async () => {
      const mockJob = createMockJob({ status: 'pending' });
      mockJobRepository.getNextPending
        .mockResolvedValueOnce(mockJob)
        .mockResolvedValue(null);
      mockJobRepository.update.mockResolvedValue(mockJob);
      mockExportService.exportToFile.mockResolvedValue('/path/to/export.json');

      const progressEvents: JobProgress[] = [];
      jobService.on('jobProgress', (progress: JobProgress) => {
        progressEvents.push(progress);
      });

      await jobService.initialize();
      jobService.start();

      // Wait for processing
      await new Promise(resolve => setTimeout(resolve, 100));
      jobService.stop();

      expect(progressEvents.length).toBeGreaterThan(0);
      expect(progressEvents.some(p => p.progress === 10)).toBe(true);
      expect(progressEvents.some(p => p.progress === 50)).toBe(true);
      expect(progressEvents.some(p => p.progress === 100)).toBe(true);
    });

    it('should respect maxConcurrentJobs limit', async () => {
      const jobService2 = new JobService({ dataDir: './test-data', maxConcurrentJobs: 1 });
      
      const mockJob1 = createMockJob({ id: 'job_1', status: 'pending' });
      const mockJob2 = createMockJob({ id: 'job_2', status: 'pending' });
      
      let callCount = 0;
      mockJobRepository.getNextPending.mockImplementation(async () => {
        callCount++;
        if (callCount === 1) return mockJob1;
        if (callCount === 2) return mockJob2;
        return null;
      });
      mockJobRepository.update.mockResolvedValue(mockJob1);
      
      // Make export slow
      mockExportService.exportToFile.mockImplementation(async () => {
        await new Promise(resolve => setTimeout(resolve, 50));
        return '/path/to/export.json';
      });

      await jobService2.initialize();
      jobService2.start();

      await new Promise(resolve => setTimeout(resolve, 100));
      jobService2.stop();
    });

    it('should handle import job type (throws not implemented)', async () => {
      const mockJob = createMockJob({
        type: 'import',
        status: 'pending',
        parameters: {
          type: 'import',
          graphId: 'graph_123',
          mode: 'merge',
          conflictResolution: 'skip',
          dataChecksum: 'abc123',
        },
      });
      mockJobRepository.getNextPending
        .mockResolvedValueOnce(mockJob)
        .mockResolvedValue(null);
      mockJobRepository.update.mockResolvedValue(mockJob);

      const eventPromise = new Promise<{ error: string }>(resolve => {
        jobService.once('jobFailed', resolve);
      });

      await jobService.initialize();
      jobService.start();

      const event = await eventPromise;
      jobService.stop();

      expect(event.error).toContain('Import jobs not yet implemented');
    });

    it('should handle ingest job type (throws not implemented)', async () => {
      const mockJob = createMockJob({
        type: 'ingest',
        status: 'pending',
        parameters: {
          type: 'ingest',
          source: {
            sourceType: 'wikipedia',
            url: 'https://example.com',
            followLinks: false,
            linkDepth: 0,
            maxPages: 1,
          },
        },
      });
      mockJobRepository.getNextPending
        .mockResolvedValueOnce(mockJob)
        .mockResolvedValue(null);
      mockJobRepository.update.mockResolvedValue(mockJob);

      const eventPromise = new Promise<{ error: string }>(resolve => {
        jobService.once('jobFailed', resolve);
      });

      await jobService.initialize();
      jobService.start();

      const event = await eventPromise;
      jobService.stop();

      expect(event.error).toContain('Ingest jobs not yet implemented');
    });
  });

  describe('webhook notifications', () => {
    it('should send webhook on job completion', async () => {
      const mockJob = createMockJob({
        status: 'pending',
        webhookUrl: 'https://example.com/webhook',
      });
      mockJobRepository.getNextPending
        .mockResolvedValueOnce(mockJob)
        .mockResolvedValue(null);
      mockJobRepository.update.mockResolvedValue(mockJob);
      mockExportService.exportToFile.mockResolvedValue('/path/to/export.json');

      // Mock fetch
      const mockFetch = vi.fn().mockResolvedValue({ ok: true });
      global.fetch = mockFetch;

      await jobService.initialize();
      jobService.start();

      await new Promise(resolve => setTimeout(resolve, 100));
      jobService.stop();

      expect(mockFetch).toHaveBeenCalledWith(
        'https://example.com/webhook',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        })
      );
    });

    it('should send webhook on job failure', async () => {
      const mockJob = createMockJob({
        status: 'pending',
        webhookUrl: 'https://example.com/webhook',
      });
      mockJobRepository.getNextPending
        .mockResolvedValueOnce(mockJob)
        .mockResolvedValue(null);
      mockJobRepository.update.mockResolvedValue(mockJob);
      mockExportService.exportToFile.mockRejectedValue(new Error('Export failed'));

      const mockFetch = vi.fn().mockResolvedValue({ ok: true });
      global.fetch = mockFetch;

      await jobService.initialize();
      jobService.start();

      await new Promise(resolve => setTimeout(resolve, 100));
      jobService.stop();

      expect(mockFetch).toHaveBeenCalled();
    });

    it('should handle webhook failure gracefully', async () => {
      const mockJob = createMockJob({
        status: 'pending',
        webhookUrl: 'https://example.com/webhook',
      });
      mockJobRepository.getNextPending
        .mockResolvedValueOnce(mockJob)
        .mockResolvedValue(null);
      mockJobRepository.update.mockResolvedValue(mockJob);
      mockExportService.exportToFile.mockResolvedValue('/path/to/export.json');

      const mockFetch = vi.fn().mockResolvedValue({ ok: false, status: 500 });
      global.fetch = mockFetch;

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      await jobService.initialize();
      jobService.start();

      await new Promise(resolve => setTimeout(resolve, 100));
      jobService.stop();

      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it('should handle webhook network error gracefully', async () => {
      const mockJob = createMockJob({
        status: 'pending',
        webhookUrl: 'https://example.com/webhook',
      });
      mockJobRepository.getNextPending
        .mockResolvedValueOnce(mockJob)
        .mockResolvedValue(null);
      mockJobRepository.update.mockResolvedValue(mockJob);
      mockExportService.exportToFile.mockResolvedValue('/path/to/export.json');

      const mockFetch = vi.fn().mockRejectedValue(new Error('Network error'));
      global.fetch = mockFetch;

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      await jobService.initialize();
      jobService.start();

      await new Promise(resolve => setTimeout(resolve, 100));
      jobService.stop();

      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it('should not send webhook if already sent', async () => {
      const mockJob = createMockJob({
        status: 'pending',
        webhookUrl: 'https://example.com/webhook',
        webhookSent: true,
      });
      mockJobRepository.getNextPending
        .mockResolvedValueOnce(mockJob)
        .mockResolvedValue(null);
      mockJobRepository.update.mockResolvedValue(mockJob);
      mockExportService.exportToFile.mockResolvedValue('/path/to/export.json');

      const mockFetch = vi.fn().mockResolvedValue({ ok: true });
      global.fetch = mockFetch;

      await jobService.initialize();
      jobService.start();

      await new Promise(resolve => setTimeout(resolve, 100));
      jobService.stop();

      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe('configuration', () => {
    it('should use default configuration values', () => {
      const service = new JobService({ dataDir: './test' });
      // Service created with defaults
      expect(service).toBeDefined();
    });

    it('should accept custom configuration', () => {
      const service = new JobService({
        dataDir: './test',
        maxConcurrentJobs: 5,
        jobTimeoutMs: 60000,
        pollIntervalMs: 1000,
        appVersion: '2.0.0',
      });
      expect(service).toBeDefined();
    });
  });
});
