/**
 * Export API Routes
 * 
 * Endpoints for exporting graph data and managing export jobs.
 */

import { Router, Response, NextFunction } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import { RequestWithContainer } from '../middleware';
import { 
  CreateExportJobRequest, 
  JobStatusResponse,
  ExportFilters,
} from '../../models/AsyncJob';
import { JobService } from '../../services/JobService';
import { ExportService, AlthistoryExport } from '../../services/ExportService';
import { ValidationError, NotFoundError } from '../../utils/errors';
import { AppConfig } from '../../utils/config';

export const exportRoutes = Router();

// Service instances (initialized lazily)
let jobService: JobService | null = null;
let exportService: ExportService | null = null;

function getJobService(config: AppConfig): JobService {
  if (!jobService) {
    jobService = new JobService({
      dataDir: config.localExecution.dataDirectory,
      appVersion: '1.0.0',
    });
    // Initialize and start in background
    jobService.initialize().then(() => {
      jobService!.start();
    }).catch(console.error);
  }
  return jobService;
}

function getExportService(config: AppConfig): ExportService {
  if (!exportService) {
    exportService = new ExportService({
      dataDir: config.localExecution.dataDirectory,
      appVersion: '1.0.0',
    });
    exportService.initialize().catch(console.error);
  }
  return exportService;
}

/**
 * POST /export/jobs - Create a new export job
 */
exportRoutes.post('/jobs', async (req: RequestWithContainer, res: Response, next: NextFunction) => {
  try {
    const service = getJobService(req.container.config);
    await service.initialize();

    const request: CreateExportJobRequest = req.body;

    // Validate request
    if (!request.graphId || request.graphId.trim().length === 0) {
      throw new ValidationError('Graph ID is required', 'graphId');
    }

    if (!request.scope || !['full', 'filtered'].includes(request.scope)) {
      throw new ValidationError('Scope must be "full" or "filtered"', 'scope', request.scope);
    }

    if (request.scope === 'filtered' && !request.filters) {
      throw new ValidationError('Filters are required when scope is "filtered"', 'filters');
    }

    // Validate filters if provided
    if (request.filters) {
      validateFilters(request.filters);
    }

    const result = await service.createExportJob(request);

    res.status(202).json({
      success: true,
      data: result,
      message: 'Export job created',
      requestId: req.requestId,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /export/jobs - List export jobs
 */
exportRoutes.get('/jobs', async (req: RequestWithContainer, res: Response, next: NextFunction) => {
  try {
    const service = getJobService(req.container.config);
    await service.initialize();

    const { status, limit = '50', offset = '0' } = req.query;

    const parsedLimit = Math.min(parseInt(limit as string, 10) || 50, 100);
    const parsedOffset = parseInt(offset as string, 10) || 0;

    let statusFilter = status as string | undefined;
    if (statusFilter && !['pending', 'processing', 'completed', 'failed', 'cancelled'].includes(statusFilter)) {
      statusFilter = undefined;
    }

    const jobs = await service.getJobs({
      type: 'export',
      status: statusFilter as 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled' | undefined,
    });

    // Apply pagination
    const paginatedJobs = jobs.slice(parsedOffset, parsedOffset + parsedLimit);
    const responseJobs: JobStatusResponse[] = paginatedJobs.map(job => ({
      id: job.id,
      type: job.type,
      status: job.status,
      progress: job.progress,
      createdAt: job.createdAt,
      startedAt: job.startedAt,
      completedAt: job.completedAt,
      result: job.result,
      error: job.error,
    }));

    res.json({
      success: true,
      data: responseJobs,
      pagination: {
        total: jobs.length,
        limit: parsedLimit,
        offset: parsedOffset,
        hasMore: parsedOffset + paginatedJobs.length < jobs.length,
      },
      requestId: req.requestId,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /export/jobs/:jobId - Get export job status
 */
exportRoutes.get('/jobs/:jobId', async (req: RequestWithContainer, res: Response, next: NextFunction) => {
  try {
    const service = getJobService(req.container.config);
    await service.initialize();

    const { jobId } = req.params;
    const job = await service.getJob(jobId);

    if (!job) {
      throw new NotFoundError('Export job not found', 'Job', jobId);
    }

    const response: JobStatusResponse = {
      id: job.id,
      type: job.type,
      status: job.status,
      progress: job.progress,
      createdAt: job.createdAt,
      startedAt: job.startedAt,
      completedAt: job.completedAt,
      result: job.result,
      error: job.error,
    };

    res.json({
      success: true,
      data: response,
      requestId: req.requestId,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * DELETE /export/jobs/:jobId - Cancel or delete an export job
 */
exportRoutes.delete('/jobs/:jobId', async (req: RequestWithContainer, res: Response, next: NextFunction) => {
  try {
    const service = getJobService(req.container.config);
    await service.initialize();

    const { jobId } = req.params;
    const job = await service.getJob(jobId);

    if (!job) {
      throw new NotFoundError('Export job not found', 'Job', jobId);
    }

    // If pending/processing, cancel it; otherwise delete it
    if (job.status === 'pending' || job.status === 'processing') {
      await service.cancelJob(jobId);
      res.json({
        success: true,
        message: 'Export job cancelled',
        requestId: req.requestId,
      });
    } else {
      await service.deleteJob(jobId);
      res.json({
        success: true,
        message: 'Export job deleted',
        requestId: req.requestId,
      });
    }
  } catch (error) {
    next(error);
  }
});

/**
 * GET /export/jobs/:jobId/download - Download the export file
 */
exportRoutes.get('/jobs/:jobId/download', async (req: RequestWithContainer, res: Response, next: NextFunction) => {
  try {
    const service = getJobService(req.container.config);
    await service.initialize();

    const { jobId } = req.params;
    const job = await service.getJob(jobId);

    if (!job) {
      throw new NotFoundError('Export job not found', 'Job', jobId);
    }

    if (job.status !== 'completed') {
      throw new ValidationError(`Export job is not completed (status: ${job.status})`, 'status', job.status);
    }

    const filePath = await service.getExportFilePath(jobId);
    if (!filePath) {
      throw new NotFoundError('Export file not found', 'File', jobId);
    }

    // Check file exists
    try {
      await fs.promises.access(filePath);
    } catch {
      throw new NotFoundError('Export file not found', 'File', filePath);
    }

    // Get filename for download
    const filename = path.basename(filePath);

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    
    const stream = fs.createReadStream(filePath);
    stream.pipe(res);
  } catch (error) {
    next(error);
  }
});

/**
 * POST /export/sync - Synchronous export for small graphs
 * Returns the export data directly instead of creating a job
 */
exportRoutes.post('/sync', async (req: RequestWithContainer, res: Response, next: NextFunction) => {
  try {
    const service = getExportService(req.container.config);
    await service.initialize();

    const request: CreateExportJobRequest = req.body;

    // Validate request
    if (!request.graphId || request.graphId.trim().length === 0) {
      throw new ValidationError('Graph ID is required', 'graphId');
    }

    if (!request.scope || !['full', 'filtered'].includes(request.scope)) {
      throw new ValidationError('Scope must be "full" or "filtered"', 'scope', request.scope);
    }

    // Validate filters if provided
    if (request.filters) {
      validateFilters(request.filters);
    }

    // Check estimated size - only allow sync for small exports
    const estimatedSize = await service.estimateExportSize({
      graphId: request.graphId,
      scope: request.scope,
      filters: request.filters,
      includeProvenance: request.includeProvenance ?? false,
    });

    const maxSyncSize = 5 * 1024 * 1024; // 5MB
    if (estimatedSize > maxSyncSize) {
      throw new ValidationError(
        `Export too large for synchronous export (${Math.round(estimatedSize / 1024)}KB). Use async job endpoint instead.`,
        'size',
        estimatedSize
      );
    }

    const result = await service.exportGraph({
      graphId: request.graphId,
      scope: request.scope,
      filters: request.filters,
      includeProvenance: request.includeProvenance ?? false,
    });

    res.json({
      success: true,
      data: result.export,
      size: result.size,
      requestId: req.requestId,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /export/validate - Validate an export file
 */
exportRoutes.post('/validate', async (req: RequestWithContainer, res: Response, next: NextFunction) => {
  try {
    const service = getExportService(req.container.config);
    await service.initialize();

    const exportData = req.body as AlthistoryExport;

    if (!exportData || typeof exportData !== 'object') {
      throw new ValidationError('Request body must be a valid export object', 'body');
    }

    const result = service.validateExport(exportData);

    res.json({
      success: true,
      data: result,
      requestId: req.requestId,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /export/stats - Get export job statistics
 */
exportRoutes.get('/stats', async (req: RequestWithContainer, res: Response, next: NextFunction) => {
  try {
    const service = getJobService(req.container.config);
    await service.initialize();

    const stats = await service.getStats();

    res.json({
      success: true,
      data: {
        export: {
          total: stats.byType.export,
          pending: stats.byStatus.pending,
          processing: stats.byStatus.processing,
          completed: stats.byStatus.completed,
          failed: stats.byStatus.failed,
        },
      },
      requestId: req.requestId,
    });
  } catch (error) {
    next(error);
  }
});

// Helper functions

function validateFilters(filters: ExportFilters): void {
  if (filters.timeRange) {
    const start = new Date(filters.timeRange.start);
    const end = new Date(filters.timeRange.end);
    
    if (isNaN(start.getTime())) {
      throw new ValidationError('Invalid start date in timeRange', 'filters.timeRange.start', filters.timeRange.start);
    }
    if (isNaN(end.getTime())) {
      throw new ValidationError('Invalid end date in timeRange', 'filters.timeRange.end', filters.timeRange.end);
    }
    if (start > end) {
      throw new ValidationError('Start date must be before end date', 'filters.timeRange');
    }
  }

  if (filters.actors && !Array.isArray(filters.actors)) {
    throw new ValidationError('Actors must be an array', 'filters.actors');
  }

  if (filters.targets && !Array.isArray(filters.targets)) {
    throw new ValidationError('Targets must be an array', 'filters.targets');
  }

  if (filters.arcIds && !Array.isArray(filters.arcIds)) {
    throw new ValidationError('Arc IDs must be an array', 'filters.arcIds');
  }

  if (filters.eventIds && !Array.isArray(filters.eventIds)) {
    throw new ValidationError('Event IDs must be an array', 'filters.eventIds');
  }
}
