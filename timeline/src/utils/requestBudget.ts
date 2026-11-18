/**
 * The time budget of one HTTP request, and the cancellation it carries.
 *
 * `requestTimeout` answers 408 when a request passes its budget. A 408 must
 * mean "nothing was saved", so the work has to stop too, not just the reply.
 * The budget's `AbortSignal` fires just before the 408 goes out, and every
 * place that makes a change durable checks it first:
 *
 * - the Neo4j session (`DatabaseManager.getNeo4jSession`) runs a write in an
 *   explicit transaction and rolls it back when the signal fires;
 * - the local store (`LocalSession.run`) refuses a write once it has fired;
 * - the version store (`VersionRepository.commit`, `GraphRepository.commitChanges`)
 *   refuses to record a version once it has fired.
 *
 * The budget travels in an `AsyncLocalStorage`, so the services and
 * repositories need no new parameter: whatever runs under the request, however
 * deep, sees the request's signal through `currentSignal()` / `checkpoint()`.
 * Work outside a request (jobs, the CLI's direct engine, startup) has no
 * budget and is never cancelled.
 *
 * What keeps a 408 honest is the **point of no return**. A request is
 * cancellable until its first durable step (a Neo4j `COMMIT`, a local-store
 * write, the recording of a version); each of those runs in a `commitSection`,
 * which marks the request committed. From then on the budget is not enforced:
 * the timer only re-arms, and the request finishes with its real reply. The
 * rule is deliberate. A write that spans the live store and the version store
 * is two commits; cancelling between them would leave one without the other,
 * and undoing the first needs a write of its own that the same signal would
 * refuse. Not cancelling after the first commit gives "neither or both" without
 * any compensation: a request answered 408 never committed anything, and one
 * that committed is answered with its own result, late.
 */

import { AsyncLocalStorage } from 'node:async_hooks';

/** Thrown into the work of a request that ran out of budget. */
export class RequestCancelledError extends Error {
  readonly name = 'RequestCancelledError';
  constructor(message = 'The request ran out of time and was cancelled; nothing was saved') {
    super(message);
  }
}

/** A committed request that has run this many budgets is logged once (never answered 408). */
const OVERRUN_BUDGETS = 5;

export class RequestBudget {
  private readonly controller = new AbortController();
  private timer?: NodeJS.Timeout;
  private committed = false;
  private done = false;
  private rearms = 0;

  /**
   * @param ms       the budget
   * @param onExpire called once, just after the signal fired (sends the 408)
   * @param answered whether a reply has already started (a stream's headers are
   *                 out): there is no 408 to send, so the request is not cancelled
   * @param onOverrun called when a committed request has run past several budgets
   */
  constructor(
    private readonly ms: number,
    private readonly onExpire: () => void,
    private readonly answered: () => boolean = () => false,
    private readonly onOverrun: (budgets: number) => void = () => undefined
  ) {}

  get signal(): AbortSignal {
    return this.controller.signal;
  }

  start(): void {
    this.arm();
  }

  /** The request has been answered; nothing more to cancel. */
  dispose(): void {
    this.done = true;
    if (this.timer) clearTimeout(this.timer);
  }

  /** A durable step begins: the request is past the point of no return. */
  markCommitted(): void {
    this.committed = true;
  }

  private arm(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.expire(), this.ms);
  }

  private expire(): void {
    if (this.done || this.controller.signal.aborted) return;
    if (this.answered()) {
      // The reply is under way (a stream): cancelling now would cut it off
      // with no 408 to say so. Same as a committed request.
      this.committed = true;
    }
    if (this.committed) {
      // Past the point of no return: let the request finish with its real
      // reply, however long that takes; only say so, now and then.
      this.rearms++;
      if (this.rearms === OVERRUN_BUDGETS) this.onOverrun(this.rearms + 1);
      this.arm();
      return;
    }
    this.controller.abort(new RequestCancelledError());
    this.onExpire();
  }
}

const storage = new AsyncLocalStorage<RequestBudget>();

/** Run `fn` (and everything it awaits) under `budget`. */
export function runWithBudget<T>(budget: RequestBudget, fn: () => T): T {
  return storage.run(budget, fn);
}

/** Whether `error`, or anything it wraps, is the cancellation of a timed-out request. */
export function isCancellation(error: unknown): boolean {
  for (let depth = 0; depth < 6 && error instanceof Error; depth++) {
    if (error instanceof RequestCancelledError) return true;
    error = (error as { cause?: unknown }).cause;
  }
  return false;
}

export function currentBudget(): RequestBudget | null {
  return storage.getStore() ?? null;
}

/** The signal of the request this code runs under, if any. */
export function currentSignal(): AbortSignal | undefined {
  return currentBudget()?.signal;
}

/** Throw if the request has run out of budget. Call before making a change durable. */
export function checkpoint(): void {
  const signal = currentSignal();
  if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : new RequestCancelledError();
}

/**
 * The synchronous form of `commitSection`, for a mutation that is itself the
 * durable step (an in-memory store write): refuse it if the request is out of
 * time, otherwise mark the request committed. Nothing can interleave between
 * the check and the write, because the caller writes in the same turn.
 */
export function beginCommit(): void {
  checkpoint();
  currentBudget()?.markCommitted();
}

/** Run a durable step. The request is committed from here on: a timeout no longer cancels it. */
export async function commitSection<T>(fn: () => Promise<T>): Promise<T> {
  currentBudget()?.markCommitted();
  return fn();
}

/**
 * Reject as soon as `signal` fires, whichever comes first; `onAbort` runs once
 * if it does (to stop the work behind `promise`).
 */
export function raceAbort<T>(promise: Promise<T>, signal: AbortSignal, onAbort?: () => void): Promise<T> {
  if (signal.aborted) {
    onAbort?.();
    return Promise.reject(signal.reason ?? new RequestCancelledError());
  }
  return new Promise<T>((resolve, reject) => {
    const abort = (): void => {
      onAbort?.();
      reject(signal.reason ?? new RequestCancelledError());
    };
    signal.addEventListener('abort', abort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener('abort', abort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener('abort', abort);
        reject(error);
      }
    );
  });
}
