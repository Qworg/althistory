import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { JobService, JobProgress, JobServiceConfig } from './JobService';
import { JobRepository, JobStats } from '../repositories/JobRepository';
import { GraphRepository } from '../repositories/GraphRepository';
import { ExportService } from './ExportService';
import { AsyncJob, IAsyncJob } from '../models/AsyncJob';
import { Graph, IGraph } from '../models/Graph';
import { ValidationError } from '../utils/errors';

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
    getVersion: ReturnType<typeof vi.fn>;
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
      findAll: vi.fn().mockResolvedValue([]),
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
      getVersion: vi.fn().mockResolvedValue({ version: 0 }),
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

  describe('jobs left by a previous process', () => {
    it.each(['pending', 'processing'] as const)(
      'fails a %s import job that no in-process owner will adopt',
      async (status) => {
      const orphan = createMockJob({
        type: 'import',
        status,
        parameters: {
          type: 'import',
          graphId: 'graph_123',
          mode: 'merge',
          conflictResolution: 'skip',
          dataChecksum: 'abc123',
        },
      });
      mockJobRepository.findAll.mockResolvedValue([orphan]);

      await jobService.initialize();

      expect(mockJobRepository.update).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'job_123', status: 'failed' })
      );
      expect(orphan.error).toContain('previous process');
      }
    );

    it('re-queues an export left processing by a previous process', async () => {
      const stuck = createMockJob({
        status: 'processing',
        startedAt: '2024-01-01T00:00:00.000Z',
        progress: 50,
      });
      mockJobRepository.findAll.mockImplementation(async (filter?: { status?: unknown }) =>
        Array.isArray(filter?.status) ? [] : [stuck]
      );

      await jobService.initialize();

      expect(stuck.status).toBe('pending');
      expect(stuck.progress).toBe(0);
      expect(mockJobRepository.update).toHaveBeenCalledWith(stuck);
    });

    it('asks only for rows that need recovering', async () => {
      await jobService.initialize();

      expect(mockJobRepository.findAll).toHaveBeenCalledWith({ status: ['pending', 'processing'] });
      expect(mockJobRepository.findAll).toHaveBeenCalledWith({
        type: 'export',
        status: 'processing',
      });
    });

    it('leaves a pending export job for the worker', async () => {
      const pendingExport = createMockJob({ status: 'pending' });
      // The sweep asks for a status array; the interrupted-export recovery asks
      // for `processing` exports. A pending export appears in the first only.
      mockJobRepository.findAll.mockImplementation(async (filter?: { status?: unknown }) =>
        Array.isArray(filter?.status) ? [pendingExport] : []
      );

      await jobService.initialize();

      expect(pendingExport.status).toBe('pending');
      expect(mockJobRepository.update).not.toHaveBeenCalled();
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

    it('carries a pinned version into the job parameters', async () => {
      mockGraphRepository.findById.mockResolvedValue(createMockGraph());
      mockGraphRepository.getVersion.mockResolvedValue({ version: 7 });
      mockJobRepository.create.mockResolvedValue(createMockJob());
      mockExportService.estimateExportSize.mockResolvedValue(1000);

      await jobService.createExportJob({
        graphId: 'graph_123',
        scope: 'full',
        version: 7,
      });

      expect(mockJobRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          parameters: expect.objectContaining({ version: 7 }),
        })
      );
    });

    it('rejects a pinned version that does not exist', async () => {
      mockGraphRepository.findById.mockResolvedValue(createMockGraph());
      mockGraphRepository.getVersion.mockResolvedValue(null);

      await expect(
        jobService.createExportJob({ graphId: 'graph_123', scope: 'full', version: 99 })
      ).rejects.toMatchObject({ name: 'NotFoundError' });

      expect(mockJobRepository.create).not.toHaveBeenCalled();
    });

    it('rejects a webhook target that is not publicly routable', async () => {
      mockGraphRepository.findById.mockResolvedValue(createMockGraph());

      await expect(
        jobService.createExportJob({
          graphId: 'graph_123',
          scope: 'full',
          webhook: 'http://127.0.0.1:9000/hook',
        })
      ).rejects.toBeInstanceOf(ValidationError);

      expect(mockJobRepository.create).not.toHaveBeenCalled();
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

    it('should only claim export jobs from the queue', async () => {
      mockJobRepository.getNextPending.mockResolvedValue(null);

      await jobService.initialize();
      jobService.start();

      // Give the immediate first poll a tick to run.
      await new Promise(resolve => setTimeout(resolve, 20));
      jobService.stop();

      // ImportService writes `type: 'import'` jobs into the same store and
      // executes them itself; claiming them here failed an import that was
      // still running under its real owner.
      expect(mockJobRepository.getNextPending).toHaveBeenCalledWith('export');
      expect(mockJobRepository.getNextPending).not.toHaveBeenCalledWith();
    });

    it.each([
      ['import', { type: 'import', graphId: 'graph_123', mode: 'merge', conflictResolution: 'skip', dataChecksum: 'abc123' }],
      ['ingest', { type: 'ingest', source: { sourceType: 'wikipedia', url: 'https://example.com', followLinks: false, linkDepth: 0, maxPages: 1 } }],
    ] as const)(
      'fails a %s job the repository should not have handed over, naming its owner',
      async (jobType, parameters) => {
        const mockJob = createMockJob({
          type: jobType,
          status: 'pending',
          parameters,
        });
        // A correct repository filters by type; this asserts the defensive
        // branch for one that does not.
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

        expect(event.error).toContain(`Job type '${jobType}' is not executed by JobService`);
      }
    );
  });

  describe('pinned export jobs', () => {
    it('passes the job\'s version to the exporter when it runs', async () => {
      const mockJob = createMockJob({
        status: 'pending',
        parameters: {
          type: 'export',
          graphId: 'graph_123',
          scope: 'full',
          includeProvenance: false,
          version: 0,
        },
      });
      mockJobRepository.getNextPending
        .mockResolvedValueOnce(mockJob)
        .mockResolvedValue(null);
      mockJobRepository.update.mockResolvedValue(mockJob);
      mockExportService.exportToFile.mockResolvedValue('/path/to/export.json');

      const completed = new Promise(resolve => jobService.once('jobCompleted', resolve));

      await jobService.initialize();
      jobService.start();
      await completed;
      jobService.stop();

      // Removing `version: params.version` from executeExportJob would make
      // this a head export, which is the original async-path bug.
      expect(mockExportService.exportToFile).toHaveBeenCalledWith(
        expect.objectContaining({ version: 0 })
      );
    });
  });

  describe('progress reporting', () => {
    it('persists progress instead of only emitting it', async () => {
      const mockJob = createMockJob({ status: 'pending' });
      mockJobRepository.getNextPending
        .mockResolvedValueOnce(mockJob)
        .mockResolvedValue(null);
      // The job object is mutated as it advances, so record the progress value
      // at call time rather than inspecting the (later) mutated reference.
      const persistedProgress: number[] = [];
      mockJobRepository.update.mockImplementation(async (job: AsyncJob) => {
        persistedProgress.push(job.progress);
      });
      mockExportService.exportToFile.mockResolvedValue('/path/to/export.json');

      const completed = new Promise(resolve => jobService.once('jobCompleted', resolve));

      await jobService.initialize();
      jobService.start();
      await completed;
      jobService.stop();

      // GET /export/jobs/:id serves the stored job, so the intermediate values
      // have to reach the repository, not only the event bus.
      expect(persistedProgress).toContain(10);
      expect(persistedProgress).toContain(50);
      expect(persistedProgress).toContain(100);
    });
  });

  describe('webhook notifications', () => {
    it('does not POST to a stored webhook target that fails validation', async () => {
      // A job created before validation existed, or by a direct repository
      // write, can still carry an unusable URL; delivery must refuse it without
      // making the request.
      const mockJob = createMockJob({
        status: 'pending',
        webhookUrl: 'http://127.0.0.1:9000/hook',
      });
      mockJobRepository.getNextPending
        .mockResolvedValueOnce(mockJob)
        .mockResolvedValue(null);
      mockJobRepository.update.mockResolvedValue(mockJob);
      mockExportService.exportToFile.mockResolvedValue('/path/to/export.json');

      const mockFetch = vi.fn().mockResolvedValue({ ok: true });
      global.fetch = mockFetch;

      const failed = new Promise<{ error: string }>(resolve => {
        jobService.once('webhookDeliveryFailed', resolve);
      });

      await jobService.initialize();
      jobService.start();
      const event = await failed;
      jobService.stop();

      expect(mockFetch).not.toHaveBeenCalled();
      expect(event.error).toContain('private or loopback');
    });

    it('refuses to follow a redirect', async () => {
      const mockJob = createMockJob({
        status: 'pending',
        webhookUrl: 'https://example.com/webhook',
      });
      mockJobRepository.getNextPending
        .mockResolvedValueOnce(mockJob)
        .mockResolvedValue(null);
      mockJobRepository.update.mockResolvedValue(mockJob);
      mockExportService.exportToFile.mockResolvedValue('/path/to/export.json');

      const mockFetch = vi.fn().mockResolvedValue({ ok: false, status: 302 });
      global.fetch = mockFetch;

      const failed = new Promise<{ error: string }>(resolve => {
        jobService.once('webhookDeliveryFailed', resolve);
      });

      await jobService.initialize();
      jobService.start();
      const event = await failed;
      jobService.stop();

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockFetch.mock.calls[0][1]).toEqual(
        expect.objectContaining({ redirect: 'manual' })
      );
      expect(event.error).toContain('HTTP 302');
    });


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

  describe('webhook retry and delivery status', () => {
    const startServiceWithWebhook = async (
      job: AsyncJob,
      config: Partial<JobServiceConfig> = {}
    ): Promise<void> => {
      jobService = new JobService({
        dataDir: './test-data',
        webhookMaxAttempts: 4,
        webhookInitialBackoffMs: 100,
        webhookTimeoutMs: 1000,
        ...config,
      });
      mockJobRepository.getNextPending.mockResolvedValueOnce(job).mockResolvedValue(null);
      mockJobRepository.update.mockResolvedValue(job);
      mockExportService.exportToFile.mockResolvedValue('/path/to/export.json');

      await jobService.initialize();
      jobService.start();
    };

    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      jobService.stop();
      vi.useRealTimers();
    });

    it('retries a failing endpoint and delivers once it succeeds', async () => {
      const job = createMockJob({
        status: 'pending',
        webhookUrl: 'https://example.com/webhook',
      });
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce({ ok: false, status: 500 })
        .mockResolvedValueOnce({ ok: true });
      global.fetch = fetchMock;

      await startServiceWithWebhook(job);

      await vi.advanceTimersByTimeAsync(0);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(job.webhookSent).toBe(false);

      await vi.advanceTimersByTimeAsync(100);
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(job.webhookSent).toBe(true);
    });

    it('gives up after the configured attempts and records the failure on the job', async () => {
      const job = createMockJob({
        status: 'pending',
        webhookUrl: 'https://example.com/webhook',
      });
      const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 503 });
      global.fetch = fetchMock;

      await startServiceWithWebhook(job);
      await vi.advanceTimersByTimeAsync(0);

      // Capture what would be written to disk once delivery is given up on.
      const persisted: IAsyncJob[] = [];
      mockJobRepository.update.mockImplementation(async (updated: AsyncJob) => {
        persisted.push(updated.toJSON());
        return updated;
      });

      await vi.advanceTimersByTimeAsync(1000);

      expect(fetchMock).toHaveBeenCalledTimes(4);
      expect(job.webhookSent).toBe(false);
      // The delivery outcome lives in the dedicated fields; a completed job's
      // `error` must stay untouched by a delivery failure.
      expect(job.webhookDeliveryStatus).toBe('failed');
      expect(job.webhookDeliveryError).toContain('Webhook delivery failed after 4 attempts');
      expect(job.error).toBeUndefined();
      expect(persisted.some((entry) => entry.webhookDeliveryStatus === 'failed')).toBe(true);
      expect(persisted.some((entry) => entry.webhookDeliveryError?.includes('Webhook delivery failed'))).toBe(true);
    });

    it('does not retry a non-retryable 4xx response', async () => {
      const job = createMockJob({
        status: 'pending',
        webhookUrl: 'https://example.com/webhook',
      });
      const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 400 });
      global.fetch = fetchMock;

      await startServiceWithWebhook(job);
      await vi.advanceTimersByTimeAsync(5000);

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(job.webhookSent).toBe(false);
      expect(job.webhookDeliveryStatus).toBe('failed');
      expect(job.webhookDeliveryError).toContain('Webhook delivery failed after 1 attempt');
      expect(job.error).toBeUndefined();
    });

    it('grows the delay between attempts exponentially', async () => {
      const job = createMockJob({
        status: 'pending',
        webhookUrl: 'https://example.com/webhook',
      });
      const attemptTimes: number[] = [];
      const fetchMock = vi.fn().mockImplementation(() => {
        attemptTimes.push(Date.now());
        return Promise.resolve({ ok: false, status: 500 });
      });
      global.fetch = fetchMock;

      await startServiceWithWebhook(job);
      await vi.advanceTimersByTimeAsync(1000);

      expect(attemptTimes).toHaveLength(4);
      expect([
        attemptTimes[1] - attemptTimes[0],
        attemptTimes[2] - attemptTimes[1],
        attemptTimes[3] - attemptTimes[2],
      ]).toEqual([100, 200, 400]);
    });

    it('retries a request that times out and reports the timeout reason', async () => {
      const job = createMockJob({
        status: 'pending',
        webhookUrl: 'https://example.com/webhook',
      });
      // Never settles on its own: each attempt only rejects when its own
      // AbortController fires, which is exactly what a timeout does to fetch.
      const fetchMock = vi.fn().mockImplementation(
        (_url: string, init: RequestInit) =>
          new Promise<never>((_resolve, reject) => {
            init.signal?.addEventListener('abort', () => {
              const error = new Error('The operation was aborted');
              error.name = 'AbortError';
              reject(error);
            });
          })
      );
      global.fetch = fetchMock;

      await startServiceWithWebhook(job, {
        webhookMaxAttempts: 3,
        webhookInitialBackoffMs: 100,
        webhookTimeoutMs: 1000,
      });
      await vi.advanceTimersByTimeAsync(10000);

      // Each timeout is retryable, so all three attempts are made, and the
      // recorded reason is the timeout rather than the raw AbortError text.
      expect(fetchMock).toHaveBeenCalledTimes(3);
      expect(job.webhookSent).toBe(false);
      expect(job.webhookDeliveryStatus).toBe('failed');
      expect(job.webhookDeliveryError).toContain('timeout after 1000ms');
    });

    it('retries a thrown connection error and delivers once the endpoint recovers', async () => {
      const job = createMockJob({
        status: 'pending',
        webhookUrl: 'https://example.com/webhook',
      });
      const fetchMock = vi
        .fn()
        .mockRejectedValueOnce(new TypeError('fetch failed'))
        .mockResolvedValueOnce({ ok: true });
      global.fetch = fetchMock;

      await startServiceWithWebhook(job, {
        webhookMaxAttempts: 4,
        webhookInitialBackoffMs: 100,
      });
      await vi.advanceTimersByTimeAsync(0);

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(job.webhookDeliveryStatus).toBeUndefined();

      await vi.advanceTimersByTimeAsync(100);

      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(job.webhookSent).toBe(true);
      expect(job.webhookDeliveryStatus).toBe('delivered');
    });

    it('caps the retry backoff at webhookMaxBackoffMs', async () => {
      const job = createMockJob({
        status: 'pending',
        webhookUrl: 'https://example.com/webhook',
      });
      const attemptTimes: number[] = [];
      const fetchMock = vi.fn().mockImplementation(() => {
        attemptTimes.push(Date.now());
        return Promise.resolve({ ok: false, status: 500 });
      });
      global.fetch = fetchMock;

      await startServiceWithWebhook(job, {
        webhookMaxAttempts: 4,
        webhookInitialBackoffMs: 10000,
        webhookMaxBackoffMs: 15000,
      });
      await vi.advanceTimersByTimeAsync(60000);

      expect(attemptTimes).toHaveLength(4);
      // Un-capped exponential growth would be [10000, 20000, 40000].
      expect([
        attemptTimes[1] - attemptTimes[0],
        attemptTimes[2] - attemptTimes[1],
        attemptTimes[3] - attemptTimes[2],
      ]).toEqual([10000, 15000, 15000]);
    });

    it('does not block job completion or the next job on webhook delivery', async () => {
      const webhookJob = createMockJob({
        id: 'job_webhook',
        status: 'pending',
        webhookUrl: 'https://example.com/webhook',
      });
      const secondJob = createMockJob({ id: 'job_second', status: 'pending' });

      jobService = new JobService({
        dataDir: './test-data',
        maxConcurrentJobs: 1,
        pollIntervalMs: 5000,
        webhookMaxAttempts: 4,
        webhookInitialBackoffMs: 100,
        webhookTimeoutMs: 60000,
      });
      mockJobRepository.getNextPending
        .mockResolvedValueOnce(webhookJob)
        .mockResolvedValueOnce(secondJob)
        .mockResolvedValue(null);
      mockJobRepository.update.mockResolvedValue(webhookJob);
      mockExportService.exportToFile.mockResolvedValue('/path/to/export.json');

      let resolveFetch: ((value: { ok: boolean }) => void) | undefined;
      const fetchMock = vi.fn().mockImplementation(
        () =>
          new Promise<{ ok: boolean }>((resolve) => {
            resolveFetch = resolve;
          })
      );
      global.fetch = fetchMock;

      await jobService.initialize();
      jobService.start();

      // The export finishes and the webhook starts, but delivery is still
      // pending: the job is complete and its worker slot is free.
      await vi.advanceTimersByTimeAsync(0);
      expect(webhookJob.status).toBe('completed');
      expect(webhookJob.webhookDeliveryStatus).toBeUndefined();
      expect(fetchMock).toHaveBeenCalledTimes(1);

      // The next poll processes job 2 while delivery is still outstanding. If
      // job processing awaited the webhook, the single worker slot would still
      // be held and job 2 would stay pending.
      await vi.advanceTimersByTimeAsync(5000);
      expect(secondJob.status).toBe('completed');

      resolveFetch?.({ ok: true });
      await vi.advanceTimersByTimeAsync(0);
      expect(webhookJob.webhookDeliveryStatus).toBe('delivered');
    });

    it('records an abandoned delivery instead of dropping it when stopped during a retry wait', async () => {
      const job = createMockJob({
        status: 'pending',
        webhookUrl: 'https://example.com/webhook',
      });
      const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 503 });
      global.fetch = fetchMock;

      await startServiceWithWebhook(job);
      await vi.advanceTimersByTimeAsync(0);
      expect(fetchMock).toHaveBeenCalledTimes(1);

      const persisted: IAsyncJob[] = [];
      mockJobRepository.update.mockImplementation(async (updated: AsyncJob) => {
        persisted.push(updated.toJSON());
        return updated;
      });

      jobService.stop();
      await vi.advanceTimersByTimeAsync(60000);

      // No further attempt is made, but the interrupted delivery is visible.
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(job.webhookSent).toBe(false);
      expect(job.webhookDeliveryStatus).toBe('abandoned');
      expect(job.error).toBeUndefined();
      expect(persisted.some((entry) => entry.webhookDeliveryStatus === 'abandoned')).toBe(true);
    });

    it('records an abandoned delivery when shutdown aborts an in-flight request', async () => {
      const job = createMockJob({
        status: 'pending',
        webhookUrl: 'https://example.com/webhook',
      });
      const fetchMock = vi.fn().mockImplementation(
        (_url: string, init: RequestInit) =>
          new Promise<never>((_resolve, reject) => {
            init.signal?.addEventListener('abort', () => {
              const error = new Error('The operation was aborted');
              error.name = 'AbortError';
              reject(error);
            });
          })
      );
      global.fetch = fetchMock;

      await startServiceWithWebhook(job, { webhookTimeoutMs: 60000 });
      await vi.advanceTimersByTimeAsync(0);
      expect(fetchMock).toHaveBeenCalledTimes(1);

      jobService.stop();
      await vi.advanceTimersByTimeAsync(0);

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(job.webhookSent).toBe(false);
      expect(job.webhookDeliveryStatus).toBe('abandoned');
      expect(job.error).toBeUndefined();
    });

    it('cancels a pending retry and its timers when the service stops', async () => {
      const job = createMockJob({
        status: 'pending',
        webhookUrl: 'https://example.com/webhook',
      });
      const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 503 });
      global.fetch = fetchMock;

      await startServiceWithWebhook(job);
      await vi.advanceTimersByTimeAsync(0);

      expect(fetchMock).toHaveBeenCalledTimes(1);
      // The job poll interval is running and a backoff retry is scheduled.
      expect(vi.getTimerCount()).toBeGreaterThanOrEqual(2);

      jobService.stop();

      expect(vi.getTimerCount()).toBe(0);
      await vi.advanceTimersByTimeAsync(60000);
      expect(fetchMock).toHaveBeenCalledTimes(1);
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
