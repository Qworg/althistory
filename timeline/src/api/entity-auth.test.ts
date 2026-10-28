/**
 * The entity routes require an API key when `API_AUTH_REQUIRED` says so, and
 * the OpenAPI document has to say the same thing.
 *
 * `/api/events`, `/api/arcs`, `/api/causal`, `/api/temporal` and
 * `/api/inference` were mounted with only `resolveGraphContext`: no
 * authentication, no permission check, no rate limit. Anyone who could reach
 * the port could rewrite a timeline, while the document called those operations
 * `auth: optional`. This file is the drift check for the fix, run with the
 * switch ON so the guard is actually mounted.
 *
 * WHY THE IMPORTS ARE DYNAMIC: the mount decision is taken once per process
 * (`api/entityAuth.ts`), when the routers and the operation table are first
 * imported. `API_AUTH_REQUIRED` is therefore set in `beforeAll` and the modules
 * are loaded afterwards, with `await import()`. A static import would be hoisted
 * above the assignment and the suite would quietly test the local-execution
 * default instead -- which is covered by `openapi.test.ts`.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import express from 'express';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { loadConfig } from '@/utils/config';
import { initializeDatabaseManager } from '@/utils/database';
import { initializeContainer, cleanupContainer } from '@/container';
import type { Container } from '@/container';
import { errorHandler, injectContainer } from '@/api/middleware';
import type { RouteEntry } from '@/api/openapi/routeInventory';
import type { Response as SupertestResponse } from 'supertest';
import type { OperationSpec } from '@/api/openapi/operations';

/** The raw admin key, so a request can authenticate from the first test. */
const ADMIN_KEY = 'ak_entity_auth_suite_admin_key';

/** The groups this file is about. */
const ENTITY_PREFIXES = [
  '/api/events',
  '/api/arcs',
  '/api/causal',
  '/api/temporal',
  '/api/inference',
];

let routes: RouteEntry[] = [];
let operations: Record<string, OperationSpec> = {};
let container: Container;
let app: express.Express;
let testDataDir: string;

function routeKey(route: RouteEntry): string {
  return `${route.method} ${route.path}`;
}

/**
 * The error message a refusal carries.
 *
 * The middleware differ in what they say -- `requireAuth` answers "API key is
 * required", `authorize` answers "Authentication required" -- which is how a
 * test can tell the guard from the permission check.
 */
function refusalMessage(response: SupertestResponse): string {
  const body = response.body as { error?: { message?: unknown } } | undefined;
  const message = body?.error?.message;
  return typeof message === 'string' ? message : '';
}

/** Whether a mounted path belongs to one of the five entity groups. */
function isEntityPath(routePath: string): boolean {
  return ENTITY_PREFIXES.some(
    (prefix) => routePath === prefix || routePath.startsWith(`${prefix}/`)
  );
}

/**
 * A request that reaches the middleware chain.
 *
 * Path parameters get a placeholder, and a non-GET request gets an empty JSON
 * body: the point is to see whether the auth middleware answers before the
 * handler does, not to make the handler succeed.
 */
function probe(route: RouteEntry, apiKey?: string): request.Test {
  const target = route.path.replace(/:[A-Za-z0-9_]+/g, 'test-id');
  const method = route.method.toLowerCase() as 'get';
  const pending = request(app)[method](target).set('Content-Type', 'application/json');

  if (apiKey !== undefined) {
    pending.set('X-API-Key', apiKey);
  }
  if (method !== 'get' && method !== 'delete') {
    pending.send({});
  }
  return pending;
}

describe('the entity routes with API_AUTH_REQUIRED=true', () => {
  beforeAll(async () => {
    testDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'entity-auth-'));
    process.env.API_AUTH_REQUIRED = 'true';
    process.env.LOCAL_EXECUTION_ENABLED = 'true';
    process.env.LOCAL_DATA_DIR = testDataDir;
    process.env.LOCAL_GRAPH_FILE = 'entity-auth-graph.json';
    process.env.LOCAL_BACKUP_ENABLED = 'false';
    process.env.LOCAL_MAX_MEMORY_MB = '64';
    // Seeded by `ApiKeyRepository.ensureAdminKey`, so the graph used by the
    // permission tests can be created without going through a key first.
    process.env.ADMIN_API_KEY = ADMIN_KEY;

    // Loaded only now, so the one decision they take sees the environment
    // above. `Promise.all` because they import each other; the order between
    // them does not matter, only that none ran earlier.
    const [routesModule, inventoryModule, operationsModule] = await Promise.all([
      import('@/api/routes'),
      import('@/api/openapi/routeInventory'),
      import('@/api/openapi/operations'),
    ]);

    routes = inventoryModule.uniqueRoutes(routesModule.apiRouter, '/api');
    operations = operationsModule.OPERATIONS;

    const config = loadConfig();
    expect(config.apiAuth.required).toBe(true);

    const dbManager = initializeDatabaseManager(config.database);
    container = initializeContainer(dbManager, config);
    await container.initialize();

    app = express();
    app.use(express.json());
    app.use(injectContainer);
    app.use('/api', routesModule.apiRouter);
    app.use(errorHandler);
  });

  afterAll(async () => {
    await cleanupContainer();
    await fs.rm(testDataDir, { recursive: true, force: true });
    delete process.env.ADMIN_API_KEY;
    delete process.env.API_AUTH_REQUIRED;
  });

  it('documents a key for exactly the operations that refuse a keyless request', async () => {
    // The drift check the bug was missing. The document's `auth` marker is a
    // claim about the mounted chain; a keyless request is the only evidence
    // that matters. Both directions are checked, so a route that is documented
    // optional but mounted strict fails, and so does the reverse.
    const mismatches: string[] = [];

    for (const route of routes) {
      const spec = operations[routeKey(route)];
      if (!spec) continue;

      const response = await probe(route);
      const refused = response.status === 401 || response.status === 403;

      if (spec.auth === 'required' && !refused) {
        mismatches.push(
          `${routeKey(route)}: documented as requiring a key, but answered ${response.status}`
        );
      }
      if (spec.auth === 'optional' && refused) {
        mismatches.push(
          `${routeKey(route)}: documented as needing no key, but answered ${response.status}`
        );
      }

      // A refusal alone does not prove the guard is mounted: `authorize` also
      // answers 401 when nothing has authenticated the request. The *reason*
      // does, and the two differ -- `requireAuth` says the key is required,
      // `authorize` says authentication is required. Checking it is what makes
      // removing `mountEntityAccessGuard` fail here instead of passing.
      //
      // Only for the entity groups: other authenticated groups (import, export)
      // refuse keyless callers from middleware whose body this test has no
      // business pinning.
      if (spec.auth === 'required' && isEntityPath(route.path)) {
        const message = refusalMessage(response);
        if (!/API key is required/i.test(message)) {
          mismatches.push(
            `${routeKey(route)}: refused without the key guard's message (got "${message}")`
          );
        }
      }
    }

    expect(mismatches).toEqual([]);
  });

  it('requires a key on every entity operation, and documents that it does', () => {
    const entityRoutes = routes.filter((route) => isEntityPath(route.path));
    // A guard against the filter silently matching nothing, which would make
    // the loop below assert nothing at all.
    expect(entityRoutes.length).toBeGreaterThan(30);

    const unguarded = entityRoutes
      .filter((route) => operations[routeKey(route)]?.auth !== 'required')
      .map(routeKey);
    expect(unguarded).toEqual([]);
  });

  it('refuses a keyless request to an entity route before it resolves a graph', async () => {
    // The guard is mounted ahead of `resolveGraphContext`, so an anonymous
    // caller cannot tell an existing graph from a missing one: both are 401,
    // and neither is the graph lookup's 404.
    await request(app)
      .get('/api/events')
      .set('X-Graph-Id', 'no-such-graph')
      .expect(401);

    await request(app).get('/api/events').expect(401);
  });

  it('refuses a key it cannot verify', async () => {
    await request(app)
      .get('/api/events')
      .set('X-API-Key', 'ak_not_a_real_key')
      .expect(401);
  });

  it('publishes the same requirement in the document it serves', async () => {
    // The table and the served document are different objects: the document is
    // built from `OPERATIONS`, so this catches a marker that never reaches the
    // `security` field.
    const response = await request(app).get('/api/openapi.json').expect(200);
    const paths = response.body.paths as Record<string, Record<string, Record<string, unknown>>>;

    const unsecured = routes
      .filter((route) => isEntityPath(route.path))
      .filter((route) => {
        const templated = route.path.replace(/:([A-Za-z0-9_]+)/g, '{$1}');
        const operation = paths[templated]?.[route.method.toLowerCase()];
        const security = operation?.security as unknown[] | undefined;
        return !Array.isArray(security) || security.length === 0;
      })
      .map(routeKey);

    expect(unsecured).toEqual([]);
  });

  it('lets a read:events key read, and refuses it a write', async () => {
    await request(app)
      .post('/api/graphs')
      .set('X-API-Key', ADMIN_KEY)
      .send({ name: 'Entity auth suite' });

    const readOnly = await container.authService.createApiKey({
      name: 'entity-auth-read-only',
      permissions: ['read:events'],
    });

    await request(app)
      .get('/api/events')
      .set('X-API-Key', readOnly.key)
      .expect(200);

    const refused = await request(app)
      .post('/api/events')
      .set('X-API-Key', readOnly.key)
      .send({
        description: 'Should not be written',
        actor: 'actor',
        target: 'target',
        timestamp: '2020-01-01T00:00:00.000Z',
      })
      .expect(403);

    expect(refused.body.error.message).toContain('write:events');
  });

  it('lets a write:events key write, and refuses it a read', async () => {
    const writeOnly = await container.authService.createApiKey({
      name: 'entity-auth-write-only',
      permissions: ['write:events'],
    });

    await request(app)
      .post('/api/events')
      .set('X-API-Key', writeOnly.key)
      .send({
        description: 'Written by a write-only key',
        actor: 'actor',
        target: 'target',
        timestamp: '2020-01-01T00:00:00.000Z',
      })
      .expect(201);

    const refused = await request(app)
      .get('/api/events')
      .set('X-API-Key', writeOnly.key)
      .expect(403);

    expect(refused.body.error.message).toContain('read:events');
  });

  it('charges an authenticated entity request to the key rate limit', async () => {
    // The same per-key budget the other authenticated groups enforce; the
    // headers come from `rateLimit()`, so their presence proves it is mounted.
    const response = await request(app)
      .get('/api/events')
      .set('X-API-Key', ADMIN_KEY)
      .expect(200);

    expect(response.headers['x-ratelimit-limit']).toBeDefined();
    expect(response.headers['x-ratelimit-remaining']).toBeDefined();
  });

  it('refuses a key that is not allowed to read the graph it names', async () => {
    // `ApiKey.allowedGraphs` is the per-key graph restriction. These five
    // groups did not mount `authorizeGraphAccess`, so a key issued for one
    // graph could name another in `X-Graph-Id` and read it.
    const allowed = await request(app)
      .post('/api/graphs')
      .set('X-API-Key', ADMIN_KEY)
      .send({ name: 'Entity auth: allowed graph' })
      .expect(201);

    const forbidden = await request(app)
      .post('/api/graphs')
      .set('X-API-Key', ADMIN_KEY)
      .send({ name: 'Entity auth: forbidden graph' })
      .expect(201);

    const scoped = await container.authService.createApiKey({
      name: 'entity-auth-graph-scoped',
      permissions: ['read:events'],
      allowedGraphs: [allowed.body.data.id],
    });

    // The graph it was issued for: allowed.
    await request(app)
      .get('/api/events')
      .set('X-API-Key', scoped.key)
      .set('X-Graph-Id', allowed.body.data.id)
      .expect(200);

    // Any other graph: refused.
    const refused = await request(app)
      .get('/api/events')
      .set('X-API-Key', scoped.key)
      .set('X-Graph-Id', forbidden.body.data.id)
      .expect(403);

    expect(refused.body.error.message).toMatch(/graph/i);
  });

  it('refuses to mount a permission guard that names no permission', async () => {
    // `authorize()` with no permissions filters nothing and admits any valid
    // key, so a forgotten argument would be silent. It throws at mount time
    // instead, where a developer sees it.
    const { entityPermission } = await import('@/api/entityAuth');

    expect(() => entityPermission()).toThrow(/at least one permission/);
  });
});
