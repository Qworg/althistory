import axios, { AxiosInstance } from 'axios';
import { IEngine } from './IEngine';
import {
  HealthInfo,
  GraphSummaryDto,
  EventDto,
  ArcDto,
  CausalRelationshipDto,
  IngestTextOptions,
  IngestUrlOptions,
  IngestWikidataOptions,
  IngestResultDto,
  GenerateTimelineOptions,
  GenerateBranchOptions,
  GenerateExpandOptions,
  GenerateSimulateOptions,
  GenerationResultDto,
  ValidationReportDto,
  ExportResultDto,
  ImportResultDto,
} from '../types';
import {
  ConnectionErrorCLI,
  AuthErrorCLI,
  NotFoundErrorCLI,
  ValidationErrorCLI,
  CLIError,
  ExitCode,
} from '../utils/exitCodes';
import { MS_PER_MONTH, toGenerationResultDto } from './simulationMapper';
import type { SimulationResult } from '@/services/SimulationService';

export class RemoteEngine implements IEngine {
  readonly mode = 'remote' as const;
  private client: AxiosInstance;
  private baseUrl: string;

  constructor(baseUrl: string = 'http://localhost:3000', apiKey?: string) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (apiKey) {
      headers['X-API-Key'] = apiKey;
      headers['Authorization'] = `Bearer ${apiKey}`;
    }

    this.client = axios.create({
      baseURL: this.baseUrl,
      headers,
      timeout: 10000,
    });
  }

  private handleError(error: unknown, context: string): never {
    if (axios.isAxiosError(error)) {
      if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
        throw new ConnectionErrorCLI(`Cannot connect to Althistory daemon at ${this.baseUrl} (${error.message})`);
      }
      const status = error.response?.status;
      const message = error.response?.data?.error || error.response?.data?.message || error.message;

      if (status === 401 || status === 403) {
        throw new AuthErrorCLI(`Authentication failed: ${message}`);
      }
      if (status === 404) {
        throw new NotFoundErrorCLI(`Resource not found: ${message}`);
      }
      if (status === 400 || status === 422) {
        throw new ValidationErrorCLI(`Validation error during ${context}: ${message}`, error.response?.data?.details);
      }
      throw new CLIError(`Remote request failed (${status || 'unknown'}): ${message}`, ExitCode.GENERAL_ERROR);
    }
    throw error as Error;
  }

  async shutdown(): Promise<void> {
    // No-op for remote HTTP client
  }

  async getHealth(): Promise<HealthInfo> {
    try {
      const res = await this.client.get('/health');
      return {
        status: res.data?.status === 'healthy' ? 'healthy' : 'degraded',
        mode: res.data?.database?.connected ? 'cloud' : 'local',
        executionMode: 'remote',
        uptimeSeconds: res.data?.uptime,
      };
    } catch (err) {
      return this.handleError(err, 'health check');
    }
  }

  async listGraphs(): Promise<GraphSummaryDto[]> {
    try {
      const res = await this.client.get('/api/graphs');
      const list = res.data?.graphs || res.data || [];
      return list.map((g: Record<string, unknown>) => ({
        id: String(g.id),
        name: String(g.name),
        description: g.description ? String(g.description) : undefined,
        currentVersion: String(g.currentVersion || g.version || 'v1'),
        parentGraphId: g.parentGraphId ? String(g.parentGraphId) : undefined,
        branchPointVersion: g.branchPointVersion ? String(g.branchPointVersion) : undefined,
        createdAt: String(g.createdAt || new Date().toISOString()),
        updatedAt: String(g.updatedAt || new Date().toISOString()),
      }));
    } catch (err) {
      return this.handleError(err, 'listing graphs');
    }
  }

  async createGraph(name: string, description?: string): Promise<GraphSummaryDto> {
    try {
      const res = await this.client.post('/api/graphs', { name, description });
      const g = res.data?.graph || res.data;
      return {
        id: g.id,
        name: g.name,
        description: g.description,
        currentVersion: g.currentVersion || 'v1',
        parentGraphId: g.parentGraphId,
        branchPointVersion: g.branchPointVersion,
        createdAt: g.createdAt || new Date().toISOString(),
        updatedAt: g.updatedAt || new Date().toISOString(),
      };
    } catch (err) {
      return this.handleError(err, 'creating graph');
    }
  }

  async getGraph(id: string): Promise<GraphSummaryDto> {
    try {
      const res = await this.client.get(`/api/graphs/${id}`);
      const g = res.data?.graph || res.data;
      return {
        id: g.id,
        name: g.name,
        description: g.description,
        currentVersion: g.currentVersion || 'v1',
        parentGraphId: g.parentGraphId,
        branchPointVersion: g.branchPointVersion,
        createdAt: g.createdAt || new Date().toISOString(),
        updatedAt: g.updatedAt || new Date().toISOString(),
      };
    } catch (err) {
      return this.handleError(err, `getting graph ${id}`);
    }
  }

  async branchGraph(id: string, name: string): Promise<GraphSummaryDto> {
    try {
      const res = await this.client.post(`/api/graphs/${id}/branch`, { name });
      const g = res.data?.graph || res.data;
      return {
        id: g.id,
        name: g.name,
        description: g.description,
        currentVersion: g.currentVersion || 'v1',
        parentGraphId: g.parentGraphId,
        branchPointVersion: g.branchPointVersion,
        createdAt: g.createdAt || new Date().toISOString(),
        updatedAt: g.updatedAt || new Date().toISOString(),
      };
    } catch (err) {
      return this.handleError(err, `branching graph ${id}`);
    }
  }

  async mergeGraph(sourceId: string, targetId: string, strategy: string = 'keep-source'): Promise<{ success: boolean; version?: string }> {
    try {
      const res = await this.client.post(`/api/graphs/${targetId}/merge`, {
        sourceGraphId: sourceId,
        strategy,
      });
      return {
        success: res.data?.success ?? true,
        version: res.data?.mergedVersion?.version,
      };
    } catch (err) {
      return this.handleError(err, `merging graphs ${sourceId} -> ${targetId}`);
    }
  }

  async diffGraph(sourceId: string, targetId: string): Promise<Record<string, unknown>> {
    try {
      const res = await this.client.get('/api/graphs/diff', {
        params: { sourceId, targetId },
      });
      return res.data;
    } catch (err) {
      return this.handleError(err, `diffing graphs ${sourceId} vs ${targetId}`);
    }
  }

  async rollbackGraph(id: string, version: string): Promise<{ success: boolean; currentVersion: string }> {
    try {
      const res = await this.client.post(`/api/graphs/${id}/rollback/${version}`);
      return {
        success: true,
        currentVersion: res.data?.currentVersion || version,
      };
    } catch (err) {
      return this.handleError(err, `rolling back graph ${id}`);
    }
  }

  async deleteGraph(id: string): Promise<void> {
    try {
      await this.client.delete(`/api/graphs/${id}`);
    } catch (err) {
      return this.handleError(err, `deleting graph ${id}`);
    }
  }

  async createEvent(
    graphId: string,
    data: { description: string; timestamp: string; actor?: string; target?: string; importance?: number; metadata?: Record<string, unknown> }
  ): Promise<EventDto> {
    try {
      const res = await this.client.post('/api/events', {
        ...data,
        graphId,
      });
      const e = res.data?.event || res.data;
      return {
        id: e.id,
        graphId,
        description: e.description,
        timestamp: e.timestamp,
        actor: e.actor,
        target: e.target,
      };
    } catch (err) {
      return this.handleError(err, 'creating event');
    }
  }

  async listEvents(graphId: string, filters?: { actor?: string; from?: string; to?: string }): Promise<EventDto[]> {
    try {
      const res = await this.client.get('/api/events', {
        params: {
          graphId,
          ...filters,
        },
      });
      const list = res.data?.events || res.data || [];
      return list.map((e: Record<string, unknown>) => ({
        id: String(e.id),
        graphId,
        description: String(e.description),
        timestamp: String(e.timestamp),
        actor: e.actor ? String(e.actor) : undefined,
        target: e.target ? String(e.target) : undefined,
      }));
    } catch (err) {
      return this.handleError(err, 'listing events');
    }
  }

  async getEvent(graphId: string, eventId: string): Promise<EventDto> {
    try {
      const res = await this.client.get(`/api/events/${eventId}`, {
        params: { graphId },
      });
      const e = res.data?.event || res.data;
      return {
        id: e.id,
        graphId,
        description: e.description,
        timestamp: e.timestamp,
        actor: e.actor,
        target: e.target,
      };
    } catch (err) {
      return this.handleError(err, `getting event ${eventId}`);
    }
  }

  async updateEvent(
    graphId: string,
    eventId: string,
    data: Partial<{ description: string; timestamp: string; actor?: string; target?: string }>
  ): Promise<EventDto> {
    try {
      const res = await this.client.put(`/api/events/${eventId}`, {
        ...data,
        graphId,
      });
      const e = res.data?.event || res.data;
      return {
        id: e.id,
        graphId,
        description: e.description,
        timestamp: e.timestamp,
        actor: e.actor,
        target: e.target,
      };
    } catch (err) {
      return this.handleError(err, `updating event ${eventId}`);
    }
  }

  async deleteEvent(graphId: string, eventId: string): Promise<void> {
    try {
      await this.client.delete(`/api/events/${eventId}`, {
        params: { graphId },
      });
    } catch (err) {
      return this.handleError(err, `deleting event ${eventId}`);
    }
  }

  async createArc(
    graphId: string,
    data: { name: string; startTime: string; endTime: string; description?: string; parentArcId?: string }
  ): Promise<ArcDto> {
    try {
      const res = await this.client.post('/api/arcs', {
        ...data,
        graphId,
      });
      const a = res.data?.arc || res.data;
      return {
        id: a.id,
        graphId,
        name: a.name,
        description: a.description,
        startTime: a.startTime || a.start_time,
        endTime: a.endTime || a.end_time,
        parentArcId: a.parentArcId || a.parent_arc_id,
      };
    } catch (err) {
      return this.handleError(err, 'creating arc');
    }
  }

  async listArcs(graphId: string): Promise<ArcDto[]> {
    try {
      const res = await this.client.get('/api/arcs', {
        params: { graphId },
      });
      const list = res.data?.arcs || res.data || [];
      return list.map((a: Record<string, unknown>) => ({
        id: String(a.id),
        graphId,
        name: String(a.name),
        description: a.description ? String(a.description) : undefined,
        startTime: String(a.startTime || a.start_time),
        endTime: String(a.endTime || a.end_time),
        parentArcId: a.parentArcId ? String(a.parentArcId) : a.parent_arc_id ? String(a.parent_arc_id) : undefined,
      }));
    } catch (err) {
      return this.handleError(err, 'listing arcs');
    }
  }

  async getArc(graphId: string, arcId: string): Promise<ArcDto> {
    try {
      const res = await this.client.get(`/api/arcs/${arcId}`, { params: { graphId } });
      const a = res.data?.arc || res.data;
      return {
        id: String(a.id),
        graphId,
        name: String(a.name),
        description: a.description ? String(a.description) : undefined,
        startTime: String(a.startTime || a.start_time),
        endTime: String(a.endTime || a.end_time),
        parentArcId: a.parentArcId ? String(a.parentArcId) : undefined,
      };
    } catch (err) {
      return this.handleError(err, `getting arc ${arcId}`);
    }
  }

  async deleteArc(graphId: string, arcId: string): Promise<void> {
    try {
      await this.client.delete(`/api/arcs/${arcId}`, { params: { graphId } });
    } catch (err) {
      return this.handleError(err, `deleting arc ${arcId}`);
    }
  }

  async createCausalLink(
    graphId: string,
    data: { causeId: string; effectId: string; weight?: number; type?: string; reasoning?: string }
  ): Promise<CausalRelationshipDto> {
    try {
      const res = await this.client.post('/api/causal', {
        ...data,
        graphId,
      });
      const r = res.data?.relationship || res.data;
      return {
        id: r.id,
        graphId,
        causeId: r.causeId,
        effectId: r.effectId,
        weight: r.weight,
        type: r.type,
        reasoning: r.reasoning,
      };
    } catch (err) {
      return this.handleError(err, 'creating causal link');
    }
  }

  async listCausalLinks(graphId: string): Promise<CausalRelationshipDto[]> {
    try {
      const res = await this.client.get('/api/causal', {
        params: { graphId },
      });
      const list = res.data?.relationships || res.data || [];
      return list.map((r: Record<string, unknown>) => ({
        id: String(r.id),
        graphId,
        causeId: String(r.causeId),
        effectId: String(r.effectId),
        weight: typeof r.weight === 'number' ? r.weight : undefined,
        type: r.type ? String(r.type) : undefined,
        reasoning: r.reasoning ? String(r.reasoning) : undefined,
      }));
    } catch (err) {
      return this.handleError(err, 'listing causal relationships');
    }
  }

  async deleteCausalLink(graphId: string, causeId: string, effectId: string): Promise<void> {
    try {
      await this.client.delete('/api/causal/links', {
        params: { graphId, causeId, effectId },
      });
    } catch (err) {
      return this.handleError(err, 'deleting causal link');
    }
  }

  async findCausalPaths(graphId: string, fromId: string, toId: string): Promise<{ paths: string[][]; count: number }> {
    try {
      const res = await this.client.get('/api/causal/paths', {
        params: { graphId, fromId, toId },
      });
      const paths = res.data?.paths || [];
      return { paths, count: paths.length };
    } catch (err) {
      return this.handleError(err, 'finding causal paths');
    }
  }

  async ingestText(graphId: string | undefined, text: string, options: IngestTextOptions): Promise<IngestResultDto> {
    try {
      const res = await this.client.post('/api/ingest/text', {
        text,
        graphId,
        ...options,
      });
      return res.data;
    } catch (err) {
      return this.handleError(err, 'ingesting text');
    }
  }

  async ingestUrl(graphId: string | undefined, url: string, options: IngestUrlOptions): Promise<IngestResultDto> {
    try {
      const res = await this.client.post('/api/ingest/url', {
        url,
        graphId,
        ...options,
      });
      return res.data;
    } catch (err) {
      return this.handleError(err, 'ingesting url');
    }
  }

  async ingestWikidata(graphId: string | undefined, options: IngestWikidataOptions): Promise<IngestResultDto> {
    try {
      const res = await this.client.post('/api/ingest/wikidata', {
        graphId,
        ...options,
      });
      return res.data;
    } catch (err) {
      return this.handleError(err, 'ingesting wikidata');
    }
  }

  async generateTimeline(options: GenerateTimelineOptions): Promise<GenerationResultDto> {
    try {
      const res = await this.client.post('/api/generate/timeline', options);
      return res.data;
    } catch (err) {
      return this.handleError(err, 'generating timeline');
    }
  }

  async generateBranch(options: GenerateBranchOptions): Promise<GenerationResultDto> {
    try {
      const res = await this.client.post('/api/generate/branch', options);
      return res.data;
    } catch (err) {
      return this.handleError(err, 'generating branch');
    }
  }

  async generateExpand(options: GenerateExpandOptions): Promise<GenerationResultDto> {
    try {
      const res = await this.client.post('/api/generate/expand', options);
      return res.data;
    } catch (err) {
      return this.handleError(err, 'expanding timeline');
    }
  }

  async generateSimulate(options: GenerateSimulateOptions): Promise<GenerationResultDto> {
    try {
      const res = await this.client.post<{ success: boolean; data: SimulationResult }>(
        '/api/inference/simulate',
        {
          steps: options.steps,
          stepDurationMs:
            options.timeAdvanceMonths !== undefined
              ? options.timeAdvanceMonths * MS_PER_MONTH
              : undefined,
          anchorEventId: options.anchorEventId,
          domain: options.domain,
          aggressiveness: options.aggressiveness,
          seedContext: options.seedContext,
          dryRun: options.dryRun,
        },
        { headers: { 'X-Graph-Id': options.graphId } }
      );
      return toGenerationResultDto(res.data.data, 'Forward Simulation');
    } catch (err) {
      return this.handleError(err, 'simulating timeline');
    }
  }

  async validateGraph(graphId: string, strict?: boolean, autoRepair?: boolean): Promise<ValidationReportDto> {
    try {
      const res = await this.client.post('/api/validate/graph', {
        graphId,
        strict,
        autoRepair,
      });
      return res.data;
    } catch (err) {
      return this.handleError(err, 'validating graph');
    }
  }

  async exportGraph(
    graphId: string,
    format: 'json' | 'markdown' | 'dot' = 'json',
    outputPath?: string
  ): Promise<ExportResultDto> {
    try {
      const res = await this.client.get('/api/export', {
        params: { graphId, format },
      });
      const content = typeof res.data === 'string' ? res.data : JSON.stringify(res.data, null, 2);
      if (outputPath) {
        const fs = await import('fs');
        const path = await import('path');
        const resolvedPath = path.resolve(outputPath);
        await fs.promises.mkdir(path.dirname(resolvedPath), { recursive: true });
        await fs.promises.writeFile(resolvedPath, content, 'utf8');
      }
      return {
        graphId,
        format,
        content,
        outputPath: outputPath ? (await import('path')).resolve(outputPath) : undefined,
      };
    } catch (err) {
      return this.handleError(err, 'exporting graph');
    }
  }

  async importGraph(
    contentOrPath: string,
    options?: { strategy?: 'skip' | 'overwrite' | 'rename'; graphId?: string }
  ): Promise<ImportResultDto> {
    try {
      const fs = await import('fs');
      let content = contentOrPath;
      if (fs.existsSync(contentOrPath)) {
        content = await fs.promises.readFile(contentOrPath, 'utf8');
      }
      const res = await this.client.post('/api/import', {
        data: JSON.parse(content),
        strategy: options?.strategy,
        graphId: options?.graphId,
      });
      return {
        graphId: res.data?.graphId || options?.graphId || 'imported',
        imported: res.data?.imported || { events: 0, arcs: 0, relationships: 0 },
        skipped: res.data?.skipped || { events: 0, arcs: 0, relationships: 0 },
        conflicts: res.data?.conflicts || 0,
        strategy: options?.strategy || 'skip',
      };
    } catch (err) {
      return this.handleError(err, 'importing graph');
    }
  }
}
