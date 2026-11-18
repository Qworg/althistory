/**
 * The Neo4j session a request runs under (`cancellableSession`): a write goes
 * through `executeWrite`, so a transient failure (a deadlock between two
 * writers) is retried by the driver, but never past the request's deadline and
 * never marking the request committed more than once.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import type { Session } from 'neo4j-driver';
import { cancellableSession } from './database';
import { RequestBudget, RequestCancelledError, runWithBudget } from './requestBudget';

const transient = (): Error => Object.assign(new Error('DeadlockDetected'), { retriable: true });

/** Stands in for the driver's managed transaction: run the work again while it fails with a retriable error. */
function fakeSession(run: (query: string) => Promise<unknown>): { session: Session; attempts: () => number } {
  let attempts = 0;
  const raw = {
    run: vi.fn(),
    close: vi.fn(),
    executeWrite: async (work: (tx: { run: (q: string) => Promise<unknown> }) => Promise<unknown>) => {
      for (;;) {
        attempts++;
        try {
          return await work({ run });
        } catch (error) {
          if (!(error as { retriable?: boolean }).retriable) throw error;
        }
      }
    },
  };
  return { session: raw as unknown as Session, attempts: () => attempts };
}

describe('cancellableSession writes', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('retries a transient failure and marks the request committed once', async () => {
    const marked = vi.spyOn(RequestBudget.prototype, 'markCommitted');
    let calls = 0;
    const { session, attempts } = fakeSession(async () => {
      calls++;
      if (calls === 1) throw transient();
      return { records: [{ id: 'written' }] };
    });
    const budget = new RequestBudget(60_000, () => undefined);
    budget.start();
    const result = await runWithBudget(budget, () => cancellableSession(session).run('CREATE (n:X)'));
    budget.dispose();

    expect(result).toEqual({ records: [{ id: 'written' }] });
    expect(attempts()).toBe(2);
    expect(calls).toBe(2);
    expect(marked).toHaveBeenCalledTimes(1);
  });

  it('does not retry once the request is past its deadline, and never commits', async () => {
    const marked = vi.spyOn(RequestBudget.prototype, 'markCommitted');
    let calls = 0;
    const { session, attempts } = fakeSession(async () => {
      calls++;
      await new Promise((resolve) => setTimeout(resolve, 80));
      throw transient();
    });
    const budget = new RequestBudget(10, () => undefined);
    budget.start();
    const outcome = await runWithBudget(budget, () => cancellableSession(session).run('CREATE (n:X)')).catch((e: unknown) => e);
    budget.dispose();

    expect(outcome).toBeInstanceOf(RequestCancelledError);
    expect(attempts()).toBe(1);
    expect(calls).toBe(1);
    expect(marked).not.toHaveBeenCalled();
  });
});
