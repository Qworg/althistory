/**
 * The live change feed: one in-process bus every committed change to a graph is
 * announced on, whoever made it.
 *
 * Why a bus and not the `onHeadReplaced` hook. That hook (typed in
 * `LiveStoreSyncService`) is called by the four operations that replace a
 * graph's version head (branch, rollback, merge, import), so it can say "the
 * whole graph changed" and nothing finer. An agent adding one event goes
 * through none of them. The bus is written to at every place a change commits:
 *
 *   - the versioning bridge, after each entity write (`entities`);
 *   - the live-store sync, once a replaced head is in the live store, which is
 *     what `onHeadReplaced` triggers (`replaced`);
 *   - the graph service, for a graph made, renamed, given a calendar or
 *     deleted (`graph`);
 *   - the batch routes, which write the live store without a version;
 *   - a generation job, as it moves (`generation`).
 *
 * A message is published only after the change is in the live store, which is
 * what the app reads: a watcher that refetches on it sees the change.
 *
 * Catch-up. The feed counts every message it publishes, across all graphs, and
 * each graph keeps a ring of its last messages. A client that was disconnected
 * says the last `seq` it saw (and the `epoch` of the process it saw it from);
 * the feed replays what it missed, or says it cannot -- the ring has moved
 * past it, or the process restarted -- and the client refetches. A sequence
 * number is used instead of a version number because not every change makes a
 * version: a graph's name, a generation's progress and a batch write do not.
 * The counter is shared by the graphs so that a graph whose ring was dropped
 * and later rebuilt cannot be mistaken for the one the client last saw.
 *
 * One process. The bus, the counters and the rings live in memory, which is
 * what cloud mode's single replica (`CLOUD_SINGLE_REPLICA_STATE`) allows. A
 * second replica would not hear the first's writes: scaling out needs this
 * class's `publish` to go through a shared channel (Redis pub/sub, with the
 * ring and the counter kept in Redis streams), and the socket handler to
 * subscribe to that. The seam is `publish`/`subscribe`/`replay`; nothing else
 * reads the rings.
 */

import { randomUUID } from 'crypto';
import { createLogger, type ILogger } from '@/utils/logger';
import { currentChangeContext, type ChangeActor, type ChangeContext } from '@/utils/ChangeContext';

export type ChangedEntityType = 'event' | 'arc' | 'relationship' | 'pressure';
export type ChangeOperation = 'create' | 'update' | 'delete';

export interface ChangedEntity {
  type: ChangedEntityType;
  id: string;
}

/** Why a graph's head was replaced as a whole. */
export type ReplacedReason = 'rollback' | 'branch' | 'merge' | 'import' | 'commit' | 'sync';

/** What a replaced head is called to a person. */
export function replacedSummary(reason: ReplacedReason): string {
  switch (reason) {
    case 'rollback':
      return 'Rolled the graph back to an earlier version';
    case 'branch':
      return 'Branched the graph';
    case 'merge':
      return 'Merged another graph into this one';
    case 'import':
      return 'Imported entities into the graph';
    case 'commit':
      return 'Committed changes to the graph';
    default:
      return 'The graph was rebuilt from its history';
  }
}

export type GenerationStatus = 'running' | 'completed' | 'failed' | 'cancelled';

/** What changed. The envelope (graph, sequence, time, author) is added on publish. */
export type ChangeBody =
  | {
      kind: 'entities';
      operation: ChangeOperation;
      entities: ChangedEntity[];
      /** One line for a person: "Added event “Census of 1851”". */
      summary: string;
    }
  | {
      kind: 'replaced';
      reason: ReplacedReason;
      summary: string;
      /** What the graph holds now. */
      counts?: { events: number; arcs: number; relationships: number };
    }
  | {
      kind: 'graph';
      operation: ChangeOperation;
      /** Which fields changed, for an update: name, description, status, calendar. */
      fields?: string[];
      name?: string;
      summary: string;
    }
  | {
      kind: 'generation';
      jobId: string;
      status: GenerationStatus;
      phase?: string;
      /** 0 to 100. */
      progress: number;
      message: string;
      /** Who wrote the events, once known. */
      source?: 'model' | 'template';
      written?: { events: number; arcs: number; relationships: number };
      summary: string;
    };

export type ChangeRecord = ChangeBody & {
  graphId: string;
  /** From 1, increasing across every graph; only meaningful with the feed's `epoch`. */
  seq: number;
  at: string;
  actor: ChangeActor;
  /** The tab that made the change, when it said. */
  origin?: string;
};

export type ChangeListener = (record: ChangeRecord) => void;

export type ReplayResult =
  | { ok: true; records: ChangeRecord[] }
  | { ok: false; reason: 'gap' | 'epoch' };

export interface ChangeFeedOptions {
  /** How many messages one graph keeps for catch-up. Defaults to 500. */
  bufferSize?: number;
  /** How many graphs keep a ring; the least recently changed is dropped. Defaults to 500. */
  maxGraphs?: number;
  logger?: ILogger;
  now?: () => Date;
}

export const DEFAULT_FEED_BUFFER_SIZE = 500;
export const DEFAULT_FEED_MAX_GRAPHS = 500;

interface Ring {
  records: ChangeRecord[];
  /** The highest `seq` this ring has dropped; a client behind it has missed messages. */
  trimmedThrough: number;
}

const SYSTEM_ACTOR: ChangeActor = { kind: 'system' };

export class ChangeFeedService {
  /** Names this process's counters: a client holding another epoch's `seq` must refetch. */
  readonly epoch: string;
  private readonly bufferSize: number;
  private readonly maxGraphs: number;
  private readonly logger: ILogger;
  private readonly now: () => Date;
  private readonly rings = new Map<string, Ring>();
  /** The last `seq` handed out. */
  private counter = 0;
  /** The `seq` at the latest time a whole ring was dropped; a client behind it must refetch. */
  private evictedThrough = 0;
  private readonly listeners = new Set<ChangeListener>();

  constructor(options: ChangeFeedOptions = {}) {
    this.epoch = randomUUID();
    this.bufferSize = Math.max(1, Math.floor(options.bufferSize ?? DEFAULT_FEED_BUFFER_SIZE));
    this.maxGraphs = Math.max(1, Math.floor(options.maxGraphs ?? DEFAULT_FEED_MAX_GRAPHS));
    this.logger = options.logger ?? createLogger('ChangeFeedService');
    this.now = options.now ?? (() => new Date());
  }

  /**
   * Announce a committed change. The author is the open change context's
   * (`utils/ChangeContext`) unless one is passed; with neither it is `system`.
   * Never throws: a failing listener must not fail the write it reports.
   */
  publish(graphId: string, body: ChangeBody, context?: ChangeContext): ChangeRecord {
    const author = context ?? currentChangeContext();
    const ring = this.ringFor(graphId);
    this.counter += 1;
    const record = {
      ...body,
      graphId,
      seq: this.counter,
      at: this.now().toISOString(),
      actor: author?.actor ?? SYSTEM_ACTOR,
      ...(author?.origin !== undefined ? { origin: author.origin } : {}),
    } as ChangeRecord;
    ring.records.push(record);
    if (ring.records.length > this.bufferSize) {
      const dropped = ring.records.splice(0, ring.records.length - this.bufferSize);
      ring.trimmedThrough = dropped[dropped.length - 1].seq;
    }
    for (const listener of Array.from(this.listeners)) {
      try {
        listener(record);
      } catch (error) {
        this.logger.warn('A change feed listener failed', {
          graphId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return record;
  }

  /** Hear every change to every graph. Returns the function that stops listening. */
  subscribe(listener: ChangeListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Where the feed is now: the `seq` of the latest message it published. A
   * client that has just subscribed holds this, and has seen everything up to it.
   */
  get cursor(): number {
    return this.counter;
  }

  /**
   * The messages for a graph after `since`, in order -- or why they cannot be
   * given: the client's epoch is not this process's (`epoch`: a restart), or
   * the feed no longer holds everything after `since` (`gap`: the ring moved
   * on, was dropped, or `since` is not a position this feed ever reached).
   */
  replay(graphId: string, epoch: string | undefined, since: number): ReplayResult {
    if (epoch !== this.epoch) return { ok: false, reason: 'epoch' };
    if (!Number.isInteger(since) || since < 0 || since > this.counter) return { ok: false, reason: 'gap' };
    if (since < this.evictedThrough) return { ok: false, reason: 'gap' };
    const ring = this.rings.get(graphId);
    if (!ring) return { ok: true, records: [] };
    if (since < ring.trimmedThrough) return { ok: false, reason: 'gap' };
    return { ok: true, records: ring.records.filter((record) => record.seq > since) };
  }

  /** Drop a graph's ring (the graph is gone). A client behind this point refetches. */
  forget(graphId: string): void {
    if (this.rings.delete(graphId)) this.evictedThrough = this.counter;
  }

  /** How many graphs hold a ring; for tests and diagnostics. */
  get graphCount(): number {
    return this.rings.size;
  }

  private ringFor(graphId: string): Ring {
    let ring = this.rings.get(graphId);
    if (ring) {
      // Most recently changed last, so the oldest is the one dropped.
      this.rings.delete(graphId);
    } else {
      ring = { records: [], trimmedThrough: 0 };
    }
    this.rings.set(graphId, ring);
    while (this.rings.size > this.maxGraphs) {
      const oldest = this.rings.keys().next().value;
      if (oldest === undefined) break;
      this.rings.delete(oldest);
      this.evictedThrough = this.counter;
    }
    return ring;
  }
}
