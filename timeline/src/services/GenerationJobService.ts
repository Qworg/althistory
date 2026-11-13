/**
 * Generation jobs: `generate timeline`, `branch` and `expand` run by the app as
 * cancellable jobs with progress.
 *
 * A model call takes seconds to minutes, so a generation request starts a job
 * and returns its id; the caller polls the job (or watches the graph on the
 * live change feed) and may cancel it. The job runs the same `TimelineGenerator`
 * the CLI runs in process, against the app's own container, so the app stays the
 * one writer of its graphs.
 *
 * What a job does while it runs:
 *
 *   - It writes as it goes: the graph and its calendar, then the arcs, then the
 *     events, then the causal links. Each write is announced on the change feed
 *     by the versioning bridge like any other write, and the job adds its own
 *     `generation` progress messages, so a person watching the graph sees it
 *     fill in.
 *   - It is attributed to `generation` on the feed, naming the key that asked.
 *   - It reports `source`: `model` when a language model wrote the events,
 *     `template` when the app has no model key (or the model's answer could not
 *     be used) and a template did. A template is a skeleton to rewrite.
 *
 * Cancelling. A cancelled job stops before its next write. What it had already
 * written stays in the graph, and the job says how much that is: a run is a
 * sequence of ordinary writes, not a transaction, so there is nothing to roll
 * back to, and a half-written draft can be finished, edited or deleted like any
 * other graph. A model call already in flight is not interrupted; the run stops
 * when it returns, before writing its answer.
 *
 * Cost. Every job can spend the app's model key, so three limits apply to the
 * key that asks: how many of its jobs run at once, how many it may start per
 * hour, and (app-wide) how many run at once. A refused request says when to
 * retry. The generator also clamps the number of events a job may ask for.
 * Whether to confirm before starting is the client's call: the app offers
 * `dryRun`, which drafts a preview and writes nothing, but still calls the model.
 *
 * Jobs are in memory. A restart forgets them (a job that was running is gone
 * with the process, and whatever it wrote stays); the app is one process, as
 * the change feed is.
 */

import { randomUUID } from 'crypto';
import type { Container } from '@/container';
import { createLLMClient } from '@/services/llm';
import type { LLMClient } from '@/services/llm/LLMClient';
import {
  GenerationCancelledError,
  type GenerationProgress,
  type GenerationWritten,
} from '@/cli/generator/GenerationHooks';
import { TimelineGenerator } from '@/cli/generator/TimelineGenerator';
import type {
  GenerateBranchOptions,
  GenerateExpandOptions,
  GenerateTimelineOptions,
  GenerationResultDto,
} from '@/cli/types';
import { runWithChangeContext } from '@/utils/ChangeContext';
import { createLogger, type ILogger } from '@/utils/logger';
import type { ChangeFeedService, GenerationStatus } from './ChangeFeedService';

export type GenerationKind = 'timeline' | 'branch' | 'expand';

export type GenerationRequest =
  | { kind: 'timeline'; options: GenerateTimelineOptions }
  | { kind: 'branch'; options: GenerateBranchOptions }
  | { kind: 'expand'; options: GenerateExpandOptions };

/** The model a request asked for; the key itself is the app's, never the request's. */
export interface ModelChoice {
  provider?: 'openai' | 'anthropic';
  model?: string;
  temperature?: number;
}

/** Who asked: the API key a job is owned by, and shown under. */
export interface GenerationOwner {
  keyId: string;
  name?: string;
}

export interface GenerationJobView {
  id: string;
  kind: GenerationKind;
  status: GenerationStatus;
  /** 0 to 100. */
  progress: number;
  phase: string;
  /** One line a person can read. */
  message: string;
  dryRun: boolean;
  /** The graph being written: the new graph of a timeline or branch, the graph an expansion extends. */
  graphId?: string;
  /** Who wrote the events, once known. */
  source?: 'model' | 'template';
  /** What has been written so far. */
  written: GenerationWritten;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  /** Set when the job failed. */
  error?: string;
  /** Set when the job completed. */
  result?: GenerationResultDto;
}

export interface GenerationLimits {
  /** Jobs one key may have running at once. Defaults to 2. */
  maxRunningPerKey: number;
  /** Jobs running at once, all keys. Defaults to 4. */
  maxRunningTotal: number;
  /** Jobs one key may start in an hour. Defaults to 30. */
  maxPerKeyPerHour: number;
  /** How long a finished job is kept for reading. Defaults to 24 hours. */
  retentionMs: number;
  /** How many jobs are kept in all. Defaults to 200. */
  maxJobs: number;
}

export const DEFAULT_GENERATION_LIMITS: GenerationLimits = {
  maxRunningPerKey: 2,
  maxRunningTotal: 4,
  maxPerKeyPerHour: 30,
  retentionMs: 24 * 60 * 60 * 1000,
  maxJobs: 200,
};

/** A request refused because a limit is reached. */
export class GenerationLimitError extends Error {
  constructor(
    message: string,
    /** Seconds until a retry could succeed. */
    public readonly retryAfterSeconds: number
  ) {
    super(message);
    this.name = 'GenerationLimitError';
  }
}

export interface GenerationJobServiceConfig {
  /** The app's container, resolved when a job starts (it is built after this service). */
  container: () => Container;
  changeFeed?: Pick<ChangeFeedService, 'publish'>;
  limits?: Partial<GenerationLimits>;
  /** Builds the model client for a job; a test seam. Defaults to the factory reading the app's keys. */
  llmClient?: (choice: ModelChoice) => LLMClient | null;
  /** Fewest milliseconds between two progress messages on the feed. Defaults to 250. */
  progressIntervalMs?: number;
  logger?: ILogger;
  now?: () => number;
}

interface JobRecord {
  view: GenerationJobView;
  ownerKeyId: string;
  ownerName?: string;
  controller: AbortController;
  /** The graph's `generation` messages were last published at this time. */
  lastPublishedAt: number;
  lastPhase?: string;
}

const TERMINAL: ReadonlySet<GenerationStatus> = new Set(['completed', 'failed', 'cancelled']);

function labelOf(kind: GenerationKind): string {
  return kind === 'timeline' ? 'Timeline generation' : kind === 'branch' ? 'Branch generation' : 'Expansion';
}

export class GenerationJobService {
  private readonly config: GenerationJobServiceConfig;
  private readonly limits: GenerationLimits;
  private readonly logger: ILogger;
  private readonly now: () => number;
  private readonly progressIntervalMs: number;
  private readonly jobs = new Map<string, JobRecord>();
  /** When each key started its jobs in the last hour, oldest first. */
  private readonly starts = new Map<string, number[]>();
  private readonly running = new Map<string, Promise<void>>();
  /** Set by `shutdown`: the app is stopping and takes no more jobs. */
  private closed = false;

  constructor(config: GenerationJobServiceConfig) {
    this.config = config;
    this.limits = { ...DEFAULT_GENERATION_LIMITS, ...config.limits };
    this.logger = config.logger ?? createLogger('GenerationJobService');
    this.now = config.now ?? Date.now;
    this.progressIntervalMs = config.progressIntervalMs ?? 250;
  }

  /**
   * Start a job and return it, running. Throws `GenerationLimitError` when the
   * key, or the app, is at a limit.
   */
  start(request: GenerationRequest, owner: GenerationOwner, model: ModelChoice = {}): GenerationJobView {
    if (this.closed) throw new GenerationLimitError('The app is shutting down and is not starting generation jobs', 15);
    this.prune();
    this.enforceLimits(owner.keyId);

    const at = new Date(this.now()).toISOString();
    const dryRun = request.options.dryRun === true;
    const record: JobRecord = {
      view: {
        id: `gen_${randomUUID()}`,
        kind: request.kind,
        status: 'running',
        progress: 0,
        phase: 'planning',
        message: 'Starting',
        dryRun,
        written: { events: 0, arcs: 0, relationships: 0 },
        createdAt: at,
        updatedAt: at,
        // An expansion extends a graph that already exists.
        ...(request.kind === 'expand' ? { graphId: request.options.graphId } : {}),
      },
      ownerKeyId: owner.keyId,
      ownerName: owner.name,
      controller: new AbortController(),
      lastPublishedAt: 0,
    };
    this.jobs.set(record.view.id, record);
    const startedAt = this.starts.get(owner.keyId) ?? [];
    startedAt.push(this.now());
    this.starts.set(owner.keyId, startedAt);

    // Detached: the request that started the job has already been answered.
    const run = this.run(record, request, model).finally(() => {
      this.running.delete(record.view.id);
    });
    this.running.set(record.view.id, run);
    return this.viewOf(record);
  }

  /** A job the key owns, or undefined (a job of another key is not distinguishable from none). */
  get(id: string, ownerKeyId: string): GenerationJobView | undefined {
    const record = this.jobs.get(id);
    return record && record.ownerKeyId === ownerKeyId ? this.viewOf(record) : undefined;
  }

  /** The key's jobs, newest first, without their results. */
  list(ownerKeyId: string): GenerationJobView[] {
    this.prune();
    return Array.from(this.jobs.values())
      .filter((record) => record.ownerKeyId === ownerKeyId)
      .sort((a, b) => b.view.createdAt.localeCompare(a.view.createdAt))
      .map((record) => ({ ...this.viewOf(record), result: undefined }));
  }

  /**
   * Cancel a job the key owns. A job that already finished is returned as it
   * is. The job is `cancelled` at once; its run stops at its next write.
   */
  cancel(id: string, ownerKeyId: string): GenerationJobView | undefined {
    const record = this.jobs.get(id);
    if (!record || record.ownerKeyId !== ownerKeyId) return undefined;
    if (TERMINAL.has(record.view.status)) return this.viewOf(record);
    record.controller.abort();
    this.finish(record, 'cancelled', {
      message: `Cancelled; ${describeWritten(record.view.written)} stays in the graph`,
    });
    return this.viewOf(record);
  }

  /**
   * Stop every job (the app is shutting down) and wait for their runs to unwind,
   * for at most `graceMs` (a model call that never returns must not hold the
   * shutdown; an aborted run writes nothing more once its call does return).
   * Afterwards no job can be started.
   */
  async shutdown(graceMs = 10_000): Promise<void> {
    this.closed = true;
    for (const record of this.jobs.values()) {
      if (!TERMINAL.has(record.view.status)) {
        record.controller.abort();
        this.finish(record, 'cancelled', { message: 'The app stopped' });
      }
    }
    let timer: NodeJS.Timeout | undefined;
    const grace = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, graceMs);
    });
    try {
      await Promise.race([this.idle(), grace]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /** Resolves once no run is still unwinding: a cancelled job stops at its next write, not at once. */
  async idle(): Promise<void> {
    await Promise.allSettled(Array.from(this.running.values()));
  }

  /** How many jobs are running; for tests and diagnostics. */
  get runningCount(): number {
    return Array.from(this.jobs.values()).filter((record) => record.view.status === 'running').length;
  }

  private viewOf(record: JobRecord): GenerationJobView {
    return { ...record.view, written: { ...record.view.written } };
  }

  private enforceLimits(keyId: string): void {
    // A cancelled job still holds its slot until its run has unwound: its model
    // call is not interrupted, so it is still spending the key. Counting only
    // `running` would let a key start, cancel and start again past every limit.
    const records = Array.from(this.jobs.values()).filter(
      (record) => record.view.status === 'running' || this.running.has(record.view.id)
    );
    const total = records.length;
    const own = records.filter((record) => record.ownerKeyId === keyId).length;
    if (own >= this.limits.maxRunningPerKey) {
      throw new GenerationLimitError(
        `This key already has ${own} generation job${own === 1 ? '' : 's'} running (the limit is ${this.limits.maxRunningPerKey}); wait for one to finish or cancel it`,
        15
      );
    }
    if (total >= this.limits.maxRunningTotal) {
      throw new GenerationLimitError(
        `The app is running ${total} generation jobs, its limit; try again shortly`,
        15
      );
    }
    const hourAgo = this.now() - 60 * 60 * 1000;
    const recent = (this.starts.get(keyId) ?? []).filter((at) => at > hourAgo);
    this.starts.set(keyId, recent);
    if (recent.length >= this.limits.maxPerKeyPerHour) {
      const retry = Math.max(1, Math.ceil((recent[0] + 60 * 60 * 1000 - this.now()) / 1000));
      throw new GenerationLimitError(
        `This key has started ${recent.length} generation jobs in the last hour, its limit`,
        retry
      );
    }
  }

  /** Forget old finished jobs, and the oldest finished ones beyond the cap. */
  private prune(): void {
    const cutoff = this.now() - this.limits.retentionMs;
    const finished = Array.from(this.jobs.values())
      .filter((record) => TERMINAL.has(record.view.status))
      .sort((a, b) => a.view.updatedAt.localeCompare(b.view.updatedAt));
    for (const record of finished) {
      if (Date.parse(record.view.updatedAt) < cutoff) this.jobs.delete(record.view.id);
    }
    let over = this.jobs.size - this.limits.maxJobs;
    for (const record of finished) {
      if (over <= 0) break;
      if (this.jobs.delete(record.view.id)) over -= 1;
    }
  }

  private async run(record: JobRecord, request: GenerationRequest, model: ModelChoice): Promise<void> {
    const actorName = `${labelOf(request.kind)}${record.ownerName ? ` by ${record.ownerName}` : ''}`;
    await runWithChangeContext(
      { actor: { kind: 'generation', name: actorName, keyId: record.ownerKeyId } },
      async () => {
        try {
          const container = this.config.container();
          const llm = (this.config.llmClient ?? defaultLlm)(model);
          const generator = new TimelineGenerator({ llmClient: llm });
          const hooks = {
            signal: record.controller.signal,
            onProgress: (progress: GenerationProgress) => this.onProgress(record, progress),
          };
          let result: GenerationResultDto;
          if (request.kind === 'timeline') {
            result = await generator.generateTimeline(request.options, container, hooks);
          } else if (request.kind === 'branch') {
            result = await generator.generateBranch(request.options, container, hooks);
          } else {
            result = await generator.generateExpand(request.options, container, hooks);
          }
          if (record.view.status !== 'running') {
            // Cancelled while the last write finished: the graph holds all of it.
            if (record.view.status === 'cancelled') {
              record.view.written = {
                events: result.eventCount,
                arcs: result.arcCount,
                relationships: result.relationshipCount,
              };
              record.view.message = `Cancelled; ${describeWritten(record.view.written)} stays in the graph`;
            }
            return;
          }
          record.view.result = result;
          record.view.graphId = result.graphId;
          record.view.source = result.source ?? record.view.source;
          record.view.written = {
            events: result.eventCount,
            arcs: result.arcCount,
            relationships: result.relationshipCount,
          };
          this.finish(record, 'completed', {
            message: record.view.dryRun
              ? `Drafted a preview of ${describeWritten(record.view.written)}; nothing was written`
              : `Wrote ${describeWritten(record.view.written)}`,
          });
        } catch (error) {
          if (error instanceof GenerationCancelledError) {
            // `cancel` has normally finished the job already; a cancel that came from the abort alone ends it here.
            if (record.view.status === 'running') {
              this.finish(record, 'cancelled', {
                message: `Cancelled; ${describeWritten(error.written)} stays in the graph`,
              });
            } else {
              // The run stopped a write after the cancel: the count is now exact.
              record.view.written = { ...error.written };
              if (record.view.status === 'cancelled') {
                record.view.message = `Cancelled; ${describeWritten(error.written)} stays in the graph`;
              }
            }
            return;
          }
          if (record.view.status !== 'running') return;
          const message = error instanceof Error ? error.message : String(error);
          this.logger.warn('A generation job failed', { jobId: record.view.id, error: message });
          this.finish(record, 'failed', { message, error: message });
        }
      }
    );
  }

  private onProgress(record: JobRecord, progress: GenerationProgress): void {
    if (record.view.status !== 'running') return;
    const view = record.view;
    view.phase = progress.phase;
    view.message = progress.message;
    // A run is not complete until the job says so, whatever the generator reports.
    view.progress = Math.min(99, Math.round(progress.fraction * 100));
    view.written = { ...progress.written };
    if (progress.graphId !== undefined) view.graphId = progress.graphId;
    if (progress.source !== undefined) view.source = progress.source;
    view.updatedAt = new Date(this.now()).toISOString();

    const phaseChanged = progress.phase !== record.lastPhase;
    record.lastPhase = progress.phase;
    if (phaseChanged || this.now() - record.lastPublishedAt >= this.progressIntervalMs) {
      this.publish(record);
    }
  }

  private finish(
    record: JobRecord,
    status: 'completed' | 'failed' | 'cancelled',
    details: { message: string; error?: string }
  ): void {
    const view = record.view;
    view.status = status;
    view.message = details.message;
    if (details.error !== undefined) view.error = details.error;
    if (status === 'completed') view.progress = 100;
    view.phase = status === 'completed' ? 'done' : view.phase;
    const at = new Date(this.now()).toISOString();
    view.updatedAt = at;
    view.completedAt = at;
    this.publish(record);
  }

  /** Tell whoever watches the job's graph how it is going. */
  private publish(record: JobRecord): void {
    const view = record.view;
    record.lastPublishedAt = this.now();
    // A dry run writes no graph; a timeline has none until it is made.
    if (!view.graphId || view.dryRun) return;
    const actorName = `${labelOf(view.kind)}${record.ownerName ? ` by ${record.ownerName}` : ''}`;
    try {
      this.config.changeFeed?.publish(
        view.graphId,
        {
          kind: 'generation',
          jobId: view.id,
          status: view.status,
          phase: view.phase,
          progress: view.progress,
          message: view.message,
          ...(view.source ? { source: view.source } : {}),
          written: { ...view.written },
          summary: view.status === 'running' ? `${labelOf(view.kind)}: ${view.message}` : view.message,
        },
        { actor: { kind: 'generation', name: actorName, keyId: record.ownerKeyId } }
      );
    } catch (error) {
      this.logger.warn('Could not announce a generation job', {
        jobId: view.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

function defaultLlm(choice: ModelChoice): LLMClient | null {
  return createLLMClient({ provider: choice.provider, model: choice.model, temperature: choice.temperature });
}

function describeWritten(written: GenerationWritten): string {
  const part = (n: number, noun: string): string => `${n} ${noun}${n === 1 ? '' : 's'}`;
  return `${part(written.events, 'event')}, ${part(written.arcs, 'arc')} and ${part(written.relationships, 'link')}`;
}
