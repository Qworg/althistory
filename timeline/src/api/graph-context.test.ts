import { describe, it, expect } from 'vitest';
import request from 'supertest';
import express, { Express, Request, Response, NextFunction } from 'express';
import { errorHandler, resolveGraphContext, GraphLookup } from '@/api/middleware';

/**
 * A small in-memory stand-in for the two GraphRepository lookups that graph
 * resolution needs. The counters are the point: they let a test prove which
 * lookup was consulted, so "did not fall back to the active graph" is an
 * assertion about behaviour rather than an absence of an assertion.
 */
class FakeGraphLookup implements GraphLookup {
  findByIdCalls: string[] = [];
  getActiveGraphCalls = 0;

  constructor(
    private readonly graphs: Map<string, { id: string }>,
    private readonly active: { id: string } | null
  ) {}

  async findById(id: string): Promise<{ id: string } | null> {
    this.findByIdCalls.push(id);
    return this.graphs.get(id) ?? null;
  }

  async getActiveGraph(): Promise<{ id: string } | null> {
    this.getActiveGraphCalls += 1;
    return this.active;
  }
}

/**
 * Compile-time proof that `req.graphId` is exactly `string`, not
 * `string | undefined`. If the Express augmentation ever became optional this
 * assignment would fail to type-check, and `npx tsc --noEmit` (a required gate)
 * would fail with it.
 */
type IsExactlyString<T> = [T] extends [string] ? ([string] extends [T] ? true : false) : false;
const graphIdIsNonOptionalString: IsExactlyString<Request['graphId']> = true;

function buildApp(lookup: GraphLookup): { app: Express; handlerCalls: string[] } {
  const app = express();
  app.use(express.json());

  // The real chain provides these via injectContainer; the resolver's error path
  // and errorHandler read them, so mirror that without booting the container.
  app.use((req: Request, _res: Response, next: NextFunction) => {
    req.requestId = 'test-request-id';
    req.startTime = Date.now();
    next();
  });

  app.use(resolveGraphContext(() => lookup));

  const handlerCalls: string[] = [];
  app.get('/scoped', (req: Request, res: Response) => {
    // Declaring this as `string` (rather than letting inference see
    // `string | undefined`) is the downstream-facing half of the non-optional
    // guarantee: a handler that demands a graph id must still compile.
    const graphId: string = req.graphId;
    handlerCalls.push(graphId);
    res.json({ graphId });
  });

  app.use(errorHandler);
  return { app, handlerCalls };
}

describe('resolveGraphContext', () => {
  it('exposes the resolved id to downstream handlers as a non-optional string', () => {
    expect(graphIdIsNonOptionalString).toBe(true);
  });

  it('uses a valid X-Graph-Id header and never consults the active graph', async () => {
    const lookup = new FakeGraphLookup(
      new Map([['graph-a', { id: 'graph-a' }]]),
      { id: 'active-graph' }
    );
    const { app, handlerCalls } = buildApp(lookup);

    const response = await request(app).get('/scoped').set('X-Graph-Id', 'graph-a').expect(200);

    expect(response.body).toEqual({ graphId: 'graph-a' });
    expect(handlerCalls).toEqual(['graph-a']);
    expect(lookup.findByIdCalls).toEqual(['graph-a']);
    expect(lookup.getActiveGraphCalls).toBe(0);
  });

  it('falls back to the active graph when no header is present', async () => {
    const lookup = new FakeGraphLookup(
      new Map([['active-graph', { id: 'active-graph' }]]),
      { id: 'active-graph' }
    );
    const { app, handlerCalls } = buildApp(lookup);

    const response = await request(app).get('/scoped').expect(200);

    expect(response.body).toEqual({ graphId: 'active-graph' });
    expect(handlerCalls).toEqual(['active-graph']);
    expect(lookup.getActiveGraphCalls).toBe(1);
    expect(lookup.findByIdCalls).toEqual([]);
  });

  describe('malformed header', () => {
    const malformedGraphIds: Array<[string, string]> = [
      ['path traversal', '../../etc/passwd'],
      ['path separator', 'a/b'],
      ['empty string', ''],
      ['over the 128 character limit', 'a'.repeat(129)],
      ['interior whitespace', 'graph a'],
    ];

    it.each(malformedGraphIds)(
      'rejects %s with 400 and does not fall back to the active graph',
      async (_label, headerValue) => {
        const lookup = new FakeGraphLookup(
          new Map([['active-graph', { id: 'active-graph' }]]),
          { id: 'active-graph' }
        );
        const { app, handlerCalls } = buildApp(lookup);

        const response = await request(app)
          .get('/scoped')
          .set('X-Graph-Id', headerValue)
          .expect(400);

        expect(response.body.error.message).toMatch(/Unsafe graph id/);
        expect(handlerCalls).toEqual([]);
        // The active graph was available and would have resolved; the header
        // error must short-circuit, not be quietly discarded.
        expect(lookup.getActiveGraphCalls).toBe(0);
        expect(lookup.findByIdCalls).toEqual([]);
      }
    );
  });

  it('returns 404 for a well-formed header naming a missing graph and does not fall back', async () => {
    const lookup = new FakeGraphLookup(
      new Map([['active-graph', { id: 'active-graph' }]]),
      { id: 'active-graph' }
    );
    const { app, handlerCalls } = buildApp(lookup);

    const response = await request(app).get('/scoped').set('X-Graph-Id', 'ghost-graph').expect(404);

    expect(response.body.error.message).toBe("Graph 'ghost-graph' not found");
    expect(handlerCalls).toEqual([]);
    expect(lookup.findByIdCalls).toEqual(['ghost-graph']);
    expect(lookup.getActiveGraphCalls).toBe(0);
  });

  it('returns 404 when there is no header and no active graph', async () => {
    const lookup = new FakeGraphLookup(new Map(), null);
    const { app, handlerCalls } = buildApp(lookup);

    const response = await request(app).get('/scoped').expect(404);

    expect(response.body.error.message).toMatch(/No graph context available/);
    expect(handlerCalls).toEqual([]);
    expect(lookup.getActiveGraphCalls).toBe(1);
    expect(lookup.findByIdCalls).toEqual([]);
  });

  it('renders resolution failures through the shared error shape', async () => {
    const lookup = new FakeGraphLookup(new Map(), null);
    const { app } = buildApp(lookup);

    const response = await request(app).get('/scoped').expect(404);

    expect(response.body).toMatchObject({
      error: {
        message: expect.any(String),
        requestId: 'test-request-id',
        path: '/scoped',
      },
    });
  });
});
