/**
 * The OpenAPI description must describe the API that is actually served.
 *
 * The document's paths come from the Express route table and the prose comes
 * from `operations.ts`, so the two are checked against each other here: a
 * route that is mounted and not described fails, and a description for a
 * route that is not mounted fails too.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import express from 'express'
import * as fs from 'fs/promises'
import * as os from 'os'
import * as path from 'path'
import { apiRouter } from '../routes'
import { loadConfig, initializeDatabaseManager } from '@/utils'
import { initializeContainer, cleanupContainer } from '@/container'
import { errorHandler, injectContainer } from '@/api/middleware'
import { buildOpenApiDocument, toOpenApiPath } from './document'
import { uniqueRoutes } from './routeInventory'
import { OPERATIONS } from './operations'

const routes = uniqueRoutes(apiRouter, '/api')
const document = buildOpenApiDocument(routes) as {
  openapi: string
  info: { title: string; version: string }
  servers: Array<{ url: string }>
  paths: Record<string, Record<string, Record<string, unknown>>>
  components: {
    schemas: Record<string, Record<string, unknown>>
    securitySchemes: Record<string, Record<string, unknown>>
  }
}

describe('the OpenAPI description', () => {
  it('has a description for every mounted route, and a route for every description', () => {
    // The guarantee the README makes: a route that is added and not described
    // fails here, because the builder refuses to describe a route it has no
    // entry for.
    //
    // The comparison is between the TABLE and the route table. Comparing the
    // document with the routes it was built from would be a tautology: the
    // generator would have produced an entry for every route.
    const described = Object.keys(OPERATIONS).sort()
    const mounted = routes
      .map((route) => `${route.method} ${route.path}`)
      .sort()

    expect(mounted.filter((entry) => !described.includes(entry))).toEqual([])
    expect(described.filter((entry) => !mounted.includes(entry))).toEqual([])
  })

  it('describes every route the table describes', () => {
    // The document is built from the table, so this is what the table has to
    // cover: every route in the document is one the table describes.
    const described = new Set<string>()

    for (const [path, item] of Object.entries(document.paths)) {
      for (const method of Object.keys(item)) {
        described.add(`${method.toUpperCase()} ${path}`)
      }
    }

    const mounted = routes.map((route) => `${route.method} ${toOpenApiPath(route.path)}`)

    expect(mounted.filter((entry) => !described.has(entry))).toEqual([])
    expect(described.size).toBe(mounted.length)
  })

  it('refuses to build a document for a route it has no description of', () => {
    const extra = [...routes, { method: 'GET', path: '/api/graphs/:id/export-csv' }]

    expect(() => buildOpenApiDocument(extra)).toThrow(
      /no description in the OpenAPI document/
    )
  })

  it('is a valid OpenAPI 3 document', () => {
    expect(document.openapi).toMatch(/^3\.\d+\.\d+$/)
    expect(document.info.title).toBeTruthy()
    expect(document.info.version).toBeTruthy()
    expect(document.components.securitySchemes.apiKey).toBeDefined()
    expect(document.components.securitySchemes.bearer).toBeDefined()

    // The servers entry and the paths have to agree: a client resolves a path
    // against the server, so `/api` plus `/api/graphs` would be `/api/api/graphs`.
    for (const server of document.servers) {
      expect(server.url).toBe('/')
    }
    for (const path of Object.keys(document.paths)) {
      expect(path.startsWith('/api')).toBe(true)
    }
  })

  it('uses OpenAPI path templating, and declares the parameters it uses', () => {
    for (const [path, item] of Object.entries(document.paths)) {
      const templated = [...path.matchAll(/\{([^}]+)\}/g)].map((match) => match[1]).sort()

      for (const operation of Object.values(item)) {
        const parameters = (operation as { parameters?: Array<{ name: string; in: string; required?: boolean }> })
          .parameters ?? []
        const declared = parameters
          .filter((parameter) => parameter.in === 'path')
          .map((parameter) => parameter.name)
          .sort()

        // A path parameter that the path does not use, or that is not
        // required, is rejected by every OpenAPI validator.
        expect({ path, declared }).toEqual({ path, declared: templated })
        for (const parameter of parameters) {
          if (parameter.in === 'path') {
            expect(parameter.required).toBe(true)
          }
        }
      }
    }
  })

  it('uses only OpenAPI 3.0 schema syntax', () => {
    // 3.0 has no union types: `type` is a single string, and a nullable field
    // is `nullable: true`.
    const visit = (value: unknown, path: string): void => {
      if (Array.isArray(value)) {
        value.forEach((item, index) => visit(item, `${path}[${index}]`))
        return
      }
      if (!value || typeof value !== 'object') return

      for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
        if (key === 'type' && Array.isArray(nested)) {
          throw new Error(`${path}.type is an array, which OpenAPI 3.0 rejects`)
        }
        visit(nested, `${path}.${key}`)
      }
    }

    visit(document.components.schemas, 'schemas')
  })

  it('refers only to schemas it defines', () => {
    const referenced = new Set<string>()

    const visit = (value: unknown): void => {
      if (Array.isArray(value)) {
        value.forEach(visit)
        return
      }
      if (!value || typeof value !== 'object') return

      for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
        if (key === '$ref' && typeof nested === 'string') {
          const match = /^#\/components\/schemas\/(.+)$/.exec(nested)
          if (match) referenced.add(match[1])
        }
        visit(nested)
      }
    }

    visit(document.paths)
    visit(document.components.schemas)

    for (const name of referenced) {
      expect(document.components.schemas[name]).toBeDefined()
    }
  })

  it('gives every operation an id, a summary, a tag, its authentication and its responses', () => {
    const operationIds = new Set<string>()

    for (const [path, item] of Object.entries(document.paths)) {
      for (const [method, operation] of Object.entries(item)) {
        const typed = operation as {
          operationId?: string
          summary?: string
          tags?: string[]
          security?: unknown[]
          responses?: Record<string, unknown>
        }

        expect({ path, method, summary: typed.summary }).toEqual({
          path,
          method,
          summary: expect.any(String),
        })
        expect(typed.operationId).toBeTruthy()
        expect(operationIds.has(typed.operationId!)).toBe(false)
        operationIds.add(typed.operationId!)
        expect(typed.tags?.length).toBeGreaterThan(0)
        expect(typed.security).toBeDefined()
        expect(Object.keys(typed.responses ?? {}).length).toBeGreaterThan(0)
      }
    }
  })
})

describe('the description matches the routes it describes', () => {
  let app: express.Express
  let testDataDir: string

  beforeAll(async () => {
    testDataDir = path.join(os.tmpdir(), `openapi-test-${process.pid}-${Date.now()}`)
    process.env.LOCAL_EXECUTION_ENABLED = 'true'
    process.env.LOCAL_DATA_DIR = testDataDir
    process.env.LOCAL_GRAPH_FILE = 'openapi-test-graph.json'
    process.env.LOCAL_BACKUP_ENABLED = 'false'
    process.env.LOCAL_MAX_MEMORY_MB = '64'
    await fs.mkdir(testDataDir, { recursive: true })

    const config = loadConfig()
    const dbManager = initializeDatabaseManager(config.database)
    const container = initializeContainer(dbManager, config)
    await container.initialize()

    app = express()
    app.use(express.json())
    app.use(injectContainer)
    app.use('/api', apiRouter)
    app.use(errorHandler)
  })

  afterAll(async () => {
    await cleanupContainer()
    await fs.rm(testDataDir, { recursive: true, force: true })
  })

  it('only claims a key where the route asks for one', async () => {
    // The document's `security` is a claim about the route. A keyless request
    // to a route that requires one answers 401; a keyless request to a route
    // that does not answers something else. The two sets have to agree.
    const mismatches: string[] = []

    for (const route of routes) {
      const key = `${route.method} ${route.path}`
      const spec = OPERATIONS[key]
      if (!spec) continue

      // A path parameter needs a value; the request is not expected to get
      // far, only far enough to answer 401 or not.
      const path = toOpenApiPath(route.path).replace(/\{[^}]+\}/g, 'test-id')

      const method = route.method.toLowerCase() as 'get'
      const response = await request(app)[method](path)
        .set('Content-Type', 'application/json')
        .send(route.method === 'GET' || route.method === 'DELETE' ? undefined : {})

      const claimsAKey = spec.auth === 'required'

      // A route that does not require a key may still refuse a request for
      // other reasons (a missing body, an unknown id). What it may not do is
      // answer 401, because a route that requires no key mounts no
      // `requireAuth`.
      if (!claimsAKey && response.status === 401) {
        mismatches.push(`${key}: the document says no key is needed, but the route answers 401`)
      }

      // And the other way round: a route that says it needs a key has to
      // refuse one. The auth middleware runs before the handler, so the answer
      // is 401 whatever the body was.
      if (claimsAKey && response.status !== 401 && response.status !== 403) {
        mismatches.push(
          `${key}: the document says a key is needed, but the route answered ${response.status}`
        )
      }
    }

    expect(mismatches).toEqual([])
  })
})

describe('GET /api/openapi.json', () => {
  it('serves the description of the API', async () => {
    const app = express()
    app.use('/api', apiRouter)

    const response = await request(app).get('/api/openapi.json').expect(200)

    expect(response.body.openapi).toMatch(/^3\.\d+\.\d+$/)
    expect(response.body.info.title).toBe('Althistory API')
    expect(Object.keys(response.body.paths).length).toBeGreaterThan(50)
    expect(response.body.paths['/api/graphs']).toBeDefined()
  })

  it('serves the description of EVERY route, including its own', async () => {
    // The served document is built when the route is first asked for, and the
    // route table at that moment includes the description route itself. A
    // document built before the routes were registered would leave them out --
    // and the test builds its own, so only this comparison catches it.
    const app = express()
    app.use('/api', apiRouter)

    const response = await request(app).get('/api/openapi.json').expect(200)

    expect(response.body.paths).toEqual(document.paths)
    expect(response.body.paths['/api/openapi.json']).toBeDefined()
    expect(response.body.paths['/api/health']).toBeDefined()
    expect(response.body.paths['/api/info']).toBeDefined()
  })
})
