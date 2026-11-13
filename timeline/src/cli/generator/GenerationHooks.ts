/**
 * What a caller can ask of a generation run: to be told how it is going, and
 * to be able to stop it.
 *
 * The CLI's in-process engine passes neither (a run is one command), and the
 * app's generation jobs (`services/GenerationJobService`) pass both: progress
 * for the job's status and the live change feed, and an abort signal for
 * cancelling it.
 *
 * A run writes as it goes -- the graph and its calendar, then the arcs, then
 * the events, then the causal links -- so what has been written when a run is
 * cancelled stays written. The progress says what that is.
 */

export type GenerationPhase =
  | 'planning'
  | 'drafting'
  | 'graph'
  | 'arcs'
  | 'events'
  | 'links'
  | 'done';

/** Who wrote the events: a model, or the template used when there was no model key or answer. */
export type GenerationSourceKind = 'model' | 'template';

/** How many of each kind of entity a run has written so far. */
export interface GenerationWritten {
  events: number;
  arcs: number;
  relationships: number;
}

export interface GenerationProgress {
  phase: GenerationPhase;
  /** One line a person can read: "Writing events (3 of 8)". */
  message: string;
  /** How far along the run is, from 0 to 1. */
  fraction: number;
  /** The graph being written, once it exists. */
  graphId?: string;
  /** Who wrote the events, once the draft is in. */
  source?: GenerationSourceKind;
  written: GenerationWritten;
}

export interface GenerationHooks {
  /** Called as the run moves; it must not throw into the run, and a throw is ignored. */
  onProgress?: (progress: GenerationProgress) => void;
  /** Aborting stops the run before its next write. */
  signal?: AbortSignal;
}

/** Raised inside a run that was cancelled; what was written before stays. */
export class GenerationCancelledError extends Error {
  readonly code = 'GENERATION_CANCELLED';

  constructor(public readonly written: GenerationWritten) {
    super('Generation was cancelled');
    this.name = 'GenerationCancelledError';
  }
}

/**
 * Bookkeeping for one run: counts what was written, reports it, and stops at a
 * checkpoint once the signal has been aborted. Inert without hooks.
 */
export class GenerationRun {
  readonly written: GenerationWritten = { events: 0, arcs: 0, relationships: 0 };
  private planned: GenerationWritten = { events: 0, arcs: 0, relationships: 0 };
  private graphId?: string;
  private source?: GenerationSourceKind;

  constructor(private readonly hooks: GenerationHooks = {}) {}

  /** Throws `GenerationCancelledError` when the run has been cancelled. */
  checkpoint(): void {
    if (this.hooks.signal?.aborted) {
      throw new GenerationCancelledError({ ...this.written });
    }
  }

  /** What the writes will come to, so the fraction can be measured against it. */
  plan(planned: GenerationWritten): void {
    this.planned = { ...planned };
  }

  /** The graph the run is writing, and who wrote its events. */
  target(graphId: string | undefined, source: GenerationSourceKind | undefined): void {
    if (graphId !== undefined) this.graphId = graphId;
    if (source !== undefined) this.source = source;
  }

  /** The share of the run done: the draft is a tenth, the writes the rest. */
  private fraction(phase: GenerationPhase): number {
    if (phase === 'planning') return 0;
    if (phase === 'drafting') return 0.05;
    if (phase === 'done') return 1;
    const total = this.planned.events + this.planned.arcs + this.planned.relationships;
    const done = this.written.events + this.written.arcs + this.written.relationships;
    return total === 0 ? 0.1 : 0.1 + 0.9 * Math.min(1, done / total);
  }

  report(phase: GenerationPhase, message: string): void {
    const onProgress = this.hooks.onProgress;
    if (!onProgress) return;
    try {
      onProgress({
        phase,
        message,
        fraction: this.fraction(phase),
        ...(this.graphId !== undefined ? { graphId: this.graphId } : {}),
        ...(this.source !== undefined ? { source: this.source } : {}),
        written: { ...this.written },
      });
    } catch {
      // A listener's failure must not stop the run it is watching.
    }
  }
}
