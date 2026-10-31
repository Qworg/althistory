import * as path from 'path';
import { DatabaseManager, LocalDatabaseManager, LocalSession } from '@/utils/database';
import { LocalGraphStore } from '@/utils/LocalGraphStore';
import { GraphContextStore, GRAPHS_LIVE_DIRECTORY } from '@/utils/GraphContextStore';
import { adoptLegacyGraphStore } from '@/utils/legacyGraphAdoption';
import { 
  TemporalService, 
  CausalService, 
  InferenceService, 
  SimulationService, 
  GraphCopyService, 
  ValidationService,
  CacheInvalidationService,
  DatabaseOptimizationService,
  GraphService,
  ExportService,
  JobService,
  AuthService,
  RateLimitService,
  GraphWriteVersioningService
} from '@/services';
import { 
  EventRepository, 
  ArcRepository,
  GraphRepository,
  VersionRepository,
  JobRepository,
  ApiKeyRepository
} from '@/repositories';
import { AppConfig } from '@/utils/config';
import { LiveStoreSyncService } from '@/services/LiveStoreSyncService';

/**
 * Minimal shape for a component that may expose an async `initialize()`.
 *
 * `DatabaseOptimizationService` does not declare such a method today, but the
 * container keeps working when one is added, so the check below is a real
 * runtime type guard rather than a cast.
 */
type Initializable = { initialize(): Promise<void> };

/**
 * Repositories and services bound to exactly one graph.
 *
 * Returned by {@link Container.graphScopedRepositories}. The scope is carried
 * differently in the two modes: in local mode the graph is the live store, which
 * these objects capture at construction, and in cloud mode it is the graph id,
 * which every query they issue filters on. Either way there is no unscoped read
 * reachable through them. The two services are bound to the same graph as the
 * repositories, so `causalService` and `temporalService` read this graph's data,
 * not the process-wide legacy store the container-level getters resolve.
 */
export interface GraphScopedRepositories {
  eventRepository: EventRepository;
  arcRepository: ArcRepository;
  causalService: CausalService;
  temporalService: TemporalService;
}

/**
 * Upper bound on the container's per-graph repository cache. The stores
 * themselves are bounded (and evicted) by `GraphContextStore`; this cap only
 * keeps the thin repository wrappers from accumulating for graphs that are no
 * longer requested.
 */
const GRAPH_SCOPED_REPOSITORY_CACHE_LIMIT = 32;

/**
 * One cached repository wrapper together with the lease that keeps its store
 * safe.
 *
 * The store itself is in-memory: repositories write to it and never call
 * `save()`, so the only thing standing between a write and an eviction that
 * flushes and shuts the instance down is this lease. It is held for as long as
 * the wrapper is cached — the window in which the container can still hand these
 * repositories to a caller — and released (which flushes the store) when the
 * wrapper is dropped.
 */
interface GraphScopedRepositoryEntry {
  store?: LocalGraphStore;
  repositories: GraphScopedRepositories;
  release: () => Promise<void>;
}

function hasInitialize<T extends object>(value: T): value is T & Initializable {
  return 'initialize' in value;
}

/**
 * Service container interface for dependency injection
 */
export interface ServiceContainer {
  // Core services
  temporalService: TemporalService;
  causalService: CausalService;
  inferenceService: InferenceService;
  simulationService: SimulationService;
  graphCopyService: GraphCopyService;
  validationService: ValidationService;
  cacheInvalidationService: CacheInvalidationService;
  databaseOptimizationService: DatabaseOptimizationService;
  
  // Phase 1 I/O services
  graphService: GraphService;
  exportService: ExportService;
  jobService: JobService;
  graphWriteVersioningService: GraphWriteVersioningService;
  liveStoreSyncService: LiveStoreSyncService;
  
  // Repositories
  eventRepository: EventRepository;
  arcRepository: ArcRepository;

  // Graph-scoped repositories and the live-store registry they draw from
  graphContextStore: GraphContextStore;
  graphScopedRepositories(graphId: string): Promise<GraphScopedRepositories>;
  
  // Phase 1 I/O repositories
  graphRepository: GraphRepository;
  versionRepository: VersionRepository;
  jobRepository: JobRepository;
  
  // Phase 3: Authentication & Batch API
  authService: AuthService;
  rateLimitService: RateLimitService;
  apiKeyRepository: ApiKeyRepository;
  
  // Infrastructure
  databaseManager: DatabaseManager | LocalDatabaseManager;
  config: AppConfig;
}

/**
 * Dependency injection container
 */
export class Container implements ServiceContainer {
  private _temporalService?: TemporalService;
  private _causalService?: CausalService;
  private _inferenceService?: InferenceService;
  private _simulationService?: SimulationService;
  private _graphCopyService?: GraphCopyService;
  private _validationService?: ValidationService;
  private _cacheInvalidationService?: CacheInvalidationService;
  private _databaseOptimizationService?: DatabaseOptimizationService;
  private _eventRepository?: EventRepository;
  private _arcRepository?: ArcRepository;
  private _graphContextStore?: GraphContextStore;
  private readonly _graphScopedRepositories = new Map<
    string,
    GraphScopedRepositoryEntry
  >();
  
  // Phase 1 I/O services
  private _graphService?: GraphService;
  private _exportService?: ExportService;
  private _jobService?: JobService;
  private _graphWriteVersioningService?: GraphWriteVersioningService;
  private _liveStoreSyncService?: LiveStoreSyncService;
  
  // Phase 1 I/O repositories
  private _graphRepository?: GraphRepository;
  private _versionRepository?: VersionRepository;
  private _jobRepository?: JobRepository;
  
  // Phase 3: Authentication & Batch API
  private _authService?: AuthService;
  private _rateLimitService?: RateLimitService;
  private _apiKeyRepository?: ApiKeyRepository;

  constructor(
    public readonly databaseManager: DatabaseManager | LocalDatabaseManager,
    public readonly config: AppConfig
  ) {}

  /**
   * Get temporal service instance (singleton)
   */
  get temporalService(): TemporalService {
    if (!this._temporalService) {
      // TemporalService takes repositories, not a database manager: wiring the
      // manager in here made the service hold a DatabaseManager as if it were an
      // EventRepository. See the report: this is a behaviour fix, not a no-op.
      this._temporalService = new TemporalService(
        this.eventRepository,
        this.arcRepository
      );
    }
    return this._temporalService;
  }

  /**
   * Get causal service instance (singleton)
   */
  get causalService(): CausalService {
    if (!this._causalService) {
      this._causalService = new CausalService();
    }
    return this._causalService;
  }

  /**
   * Get inference service instance (singleton)
   */
  get inferenceService(): InferenceService {
    if (!this._inferenceService) {
      this._inferenceService = new InferenceService();
    }
    return this._inferenceService;
  }

  /**
   * Get simulation service instance (singleton).
   *
   * The engine holds no storage of its own: it reads and writes through
   * `graphScopedRepositories`, so a simulation run can never touch a graph the
   * caller did not name.
   */
  get simulationService(): SimulationService {
    if (!this._simulationService) {
      this._simulationService = new SimulationService({
        inferenceService: this.inferenceService,
        validationService: this.validationService,
        graphScopedRepositories: (graphId: string) => this.graphScopedRepositories(graphId),
      });
    }
    return this._simulationService;
  }

  /**
   * Get graph copy service instance (singleton)
   */
  get graphCopyService(): GraphCopyService {
    if (!this._graphCopyService) {
      // GraphCopyService takes a neo4j Session. It used to be handed the
      // database manager (and a validation service it does not accept), which
      // typed `this.session` as a Session while holding a DatabaseManager at
      // runtime. See the report: this is a behaviour fix, not a no-op.
      // In local-execution mode the manager hands back a `LocalSession` adapter
      // instead, which is not a neo4j Session; there we let the service resolve
      // its own session from the global database manager.
      const session = this.databaseManager.getNeo4jSession();
      this._graphCopyService = new GraphCopyService(
        session instanceof LocalSession ? undefined : session
      );
    }
    return this._graphCopyService;
  }

  /**
   * Get validation service instance (singleton)
   */
  get validationService(): ValidationService {
    if (!this._validationService) {
      this._validationService = new ValidationService();
    }
    return this._validationService;
  }

  /**
   * Get cache invalidation service instance (singleton)
   */
  get cacheInvalidationService(): CacheInvalidationService {
    if (!this._cacheInvalidationService) {
      this._cacheInvalidationService = new CacheInvalidationService();
    }
    return this._cacheInvalidationService;
  }

  /**
   * Get database optimization service instance (singleton)
   */
  get databaseOptimizationService(): DatabaseOptimizationService {
    if (!this._databaseOptimizationService) {
      this._databaseOptimizationService = new DatabaseOptimizationService();
    }
    return this._databaseOptimizationService;
  }

  /**
   * Get event repository instance (singleton)
   */
  get eventRepository(): EventRepository {
    if (!this._eventRepository) {
      this._eventRepository = new EventRepository(
        this.databaseManager,
        this.validationService,
        this.cacheInvalidationService
      );
    }
    return this._eventRepository;
  }

  /**
   * Get arc repository instance (singleton)
   */
  get arcRepository(): ArcRepository {
    if (!this._arcRepository) {
      // ArcRepository ignores everything but the database manager, so it is not
      // given `this.temporalService`: temporalService needs arcRepository, and
      // that back-reference recursed during construction.
      this._arcRepository = new ArcRepository(
        this.databaseManager,
        this.validationService,
        undefined,
        this.cacheInvalidationService
      );
    }
    return this._arcRepository;
  }

  /**
   * Get the per-graph live-store registry (singleton).
   *
   * Owns one `LocalGraphStore` per graph under
   * `<dataDirectory>/graphs-live/<graphId>.json`; the store's lifecycle (lazy
   * load, LRU cache, shutdown) lives there, not in this container.
   */
  get graphContextStore(): GraphContextStore {
    if (!this._graphContextStore) {
      this._graphContextStore = new GraphContextStore({
        dataDirectory: path.join(
          this.config.localExecution.dataDirectory,
          GRAPHS_LIVE_DIRECTORY
        ),
      });
    }
    return this._graphContextStore;
  }

  /**
   * Get repositories bound to one graph.
   *
   * Cloud mode has one database for every graph, so the graph is carried on the
   * rows and named on every query: the repositories and the causal service are
   * constructed with the graph id and filter by it (see
   * `@/repositories/graphScope`). Local mode needs none of that -- the graph is
   * the store -- so the local branch below passes no graph id and its queries
   * are unchanged.
   *
   * The store is resolved through `GraphContextStore` (which caches and bounds
   * the stores themselves) and wrapped in a dedicated `LocalDatabaseManager`, so
   * every query the returned repositories issue is scoped to that graph's file.
   * Wrappers are cached per store identity: when `GraphContextStore` evicts and
   * later reloads a graph, the store instance changes, so the stale wrapper is
   * replaced rather than left pointing at a shut-down store.
   *
   * The cached store is held under a `GraphContextStore` LEASE, not a borrowed
   * reference. Repositories write in memory and never call `save()`, so without
   * the lease a sibling eviction could flush and shut the store down while a
   * cached wrapper (and any caller it was handed to) still had pending writes;
   * the lease keeps the entry resident for exactly the window in which this
   * cache can hand the repositories out again, and releasing it on cache eviction
   * is what flushes those writes.
   */
  async graphScopedRepositories(graphId: string): Promise<GraphScopedRepositories> {
    if (!(this.databaseManager instanceof LocalDatabaseManager)) {
      const cached = this._graphScopedRepositories.get(graphId);
      if (cached) {
        return cached.repositories;
      }
      const eventRepository = new EventRepository(
        this.databaseManager,
        this.validationService,
        this.cacheInvalidationService,
        { graphId }
      );
      const arcRepository = new ArcRepository(
        this.databaseManager,
        this.validationService,
        undefined,
        this.cacheInvalidationService,
        { graphId }
      );
      const repositories: GraphScopedRepositories = {
        eventRepository,
        arcRepository,
        causalService: new CausalService({ graphId }),
        temporalService: new TemporalService(eventRepository, arcRepository),
      };
      this._graphScopedRepositories.set(graphId, {
        repositories,
        release: async () => {},
      });
      return repositories;
    }

    const leased = await this.graphContextStore.lease(graphId);

    const cached = this._graphScopedRepositories.get(graphId);
    if (cached && cached.store === leased.store) {
      // This wrapper already holds a lease on the same store, so the one just
      // taken is redundant; drop it rather than letting the counters drift.
      await leased.release();
      return cached.repositories;
    }
    if (cached) {
      // The store identity changed (it was evicted and reloaded from disk), so
      // the cached wrapper points at a shut-down instance: flush and release it
      // before replacing it.
      this._graphScopedRepositories.delete(graphId);
      await cached.release();
    }

    const store = leased.store;
    const databaseManager = new LocalDatabaseManager(store);
    const eventRepository = new EventRepository(
      databaseManager,
      this.validationService,
      this.cacheInvalidationService
    );
    const arcRepository = new ArcRepository(
      databaseManager,
      this.validationService,
      undefined,
      this.cacheInvalidationService
    );
    const repositories: GraphScopedRepositories = {
      eventRepository,
      arcRepository,
      // Bound to this graph's store, so causal reads, writes and caches stay
      // inside the request's graph instead of the process-wide singleton.
      causalService: new CausalService({ graphStore: store, graphId }),
      // Constructed from the scoped repositories, so temporal queries (e.g.
      // findEventsInRange) read this graph rather than the global store.
      temporalService: new TemporalService(eventRepository, arcRepository),
    };

    this._graphScopedRepositories.set(graphId, {
      store,
      repositories,
      release: leased.release,
    });
    await this.evictGraphScopedRepositoriesOverflow();
    return repositories;
  }

  /**
   * Drop oldest repository wrappers once the per-graph cache is over its bound,
   * releasing each one's store lease.
   *
   * A released store is either flushed by the eviction it triggers or stays
   * resident; either way its pending writes are persisted rather than dropped
   * with the wrapper.
   */
  private async evictGraphScopedRepositoriesOverflow(): Promise<void> {
    while (this._graphScopedRepositories.size > GRAPH_SCOPED_REPOSITORY_CACHE_LIMIT) {
      const oldest = this._graphScopedRepositories.keys().next().value;
      if (oldest === undefined) {
        return;
      }
      const entry = this._graphScopedRepositories.get(oldest);
      this._graphScopedRepositories.delete(oldest);
      if (entry) {
        await entry.release();
      }
    }
  }

  // Phase 1 I/O Repositories

  /**
   * Get version repository instance (singleton)
   */
  get versionRepository(): VersionRepository {
    if (!this._versionRepository) {
      this._versionRepository = new VersionRepository({
        dataDir: this.config.localExecution.dataDirectory,
      });
    }
    return this._versionRepository;
  }

  /**
   * Get graph repository instance (singleton)
   */
  get graphRepository(): GraphRepository {
    if (!this._graphRepository) {
      this._graphRepository = new GraphRepository({
        dataDir: this.config.localExecution.dataDirectory,
      });
    }
    return this._graphRepository;
  }

  /**
   * Get job repository instance (singleton)
   */
  get jobRepository(): JobRepository {
    if (!this._jobRepository) {
      this._jobRepository = new JobRepository({
        dataDir: this.config.localExecution.dataDirectory,
      });
    }
    return this._jobRepository;
  }

  // Phase 1 I/O Services

  /**
   * Get graph service instance (singleton)
   */
  /**
   * Rebuilds a graph's live store from its version head after an operation
   * that wrote only the version tree (singleton).
   */
  get liveStoreSyncService(): LiveStoreSyncService {
    if (!this._liveStoreSyncService) {
      this._liveStoreSyncService = new LiveStoreSyncService({
        checkout: (graphId) => this.graphRepository.checkout(graphId),
        scopedRepositories: (graphId) => this.graphScopedRepositories(graphId),
        clearLiveStore: (graphId) => this.clearLiveStore(graphId),
        invalidateCaches: async () => {
          await this.cacheInvalidationService.invalidateCausalCache();
          await this.cacheInvalidationService.invalidateTemporalCache();
        },
      });
    }
    return this._liveStoreSyncService;
  }

  /** Remove every live entity of one graph, and nothing of any other graph. */
  private async clearLiveStore(graphId: string): Promise<void> {
    if (this.databaseManager instanceof LocalDatabaseManager) {
      // Local mode: the graph is the store.
      const leased = await this.graphContextStore.lease(graphId);
      try {
        await leased.store.clear();
      } finally {
        await leased.release();
      }
      return;
    }
    // Cloud mode: one database, with the graph stamped on every row.
    const session = this.databaseManager.getNeo4jSession();
    try {
      await session.run('MATCH (n) WHERE n.graphId = $graphId DETACH DELETE n', { graphId });
    } finally {
      await session.close();
    }
  }

  get graphService(): GraphService {
    if (!this._graphService) {
      this._graphService = new GraphService({
        dataDir: this.config.localExecution.dataDirectory,
        // Branch, rollback and merge write only the version tree; bring the
        // graph's live store up to the new head so the UI shows it.
        onHeadReplaced: async (graphId) => {
          await this.liveStoreSyncService.materialize(graphId);
        },
      });
    }
    return this._graphService;
  }

  /**
   * Get the live-store-to-version-store bridge (singleton).
   *
   * Entity writes (event/arc/causal) go through this so the active graph's
   * version history and ExportService see UI-created data, not just imports.
   */
  get graphWriteVersioningService(): GraphWriteVersioningService {
    if (!this._graphWriteVersioningService) {
      this._graphWriteVersioningService = new GraphWriteVersioningService({
        graphRepository: this.graphRepository,
      });
    }
    return this._graphWriteVersioningService;
  }

  /**
   * Get export service instance (singleton)
   */
  get exportService(): ExportService {
    if (!this._exportService) {
      this._exportService = new ExportService({
        dataDir: this.config.localExecution.dataDirectory,
        // Unset keeps the service's Req 5.4 default (10,000 entities).
        asyncExportThreshold: this.config.localExecution.exportAsyncEntityThreshold,
        // Unset keeps the 50 MB in-memory ceiling.
        maxInMemorySize: this.config.localExecution.exportMaxInMemoryBytes,
      });
    }
    return this._exportService;
  }

  /**
   * Get job service instance (singleton)
   */
  get jobService(): JobService {
    if (!this._jobService) {
      this._jobService = new JobService({
        dataDir: this.config.localExecution.dataDirectory,
        // The job path streams, so this only has to agree with the container's
        // export service; it keeps the two ceilings from diverging.
        maxInMemorySize: this.config.localExecution.exportMaxInMemoryBytes,
        // A job that embeds referenced entities has to re-check the requester's
        // access when it runs, long after the request. The auth service holds
        // the live key repository, so the key is resolved through it.
        resolveApiKey: (id) => this.authService.getApiKey(id),
      });
    }
    return this._jobService;
  }

  // Phase 3: Authentication & Batch API

  /**
   * Get API key repository instance (singleton)
   */
  get apiKeyRepository(): ApiKeyRepository {
    if (!this._apiKeyRepository) {
      this._apiKeyRepository = new ApiKeyRepository({
        dataDir: this.config.localExecution.dataDirectory,
      });
    }
    return this._apiKeyRepository;
  }

  /**
   * Get auth service instance (singleton)
   */
  get authService(): AuthService {
    if (!this._authService) {
      this._authService = new AuthService({
        dataDir: this.config.localExecution.dataDirectory,
      });
    }
    return this._authService;
  }

  /**
   * Get rate limit service instance (singleton)
   */
  get rateLimitService(): RateLimitService {
    if (!this._rateLimitService) {
      let redisClient: import('redis').RedisClientType | undefined;
      if (!(this.databaseManager instanceof LocalDatabaseManager)) {
        try {
          redisClient = (this.databaseManager as DatabaseManager).getRedisClient();
        } catch {
          // Redis client may not be initialized yet
        }
      }
      this._rateLimitService = new RateLimitService({
        dataDir: this.config.localExecution.dataDirectory,
        redisClient,
      });
    }
    return this._rateLimitService;
  }

  /**
   * Initialize all services and perform health checks
   */
  async initialize(): Promise<void> {
    console.log('🔧 Initializing service container...');

    try {
      // Initialize database connections
      await this.databaseManager.initializeNeo4j();
      await this.databaseManager.initializeRedis();

      // Perform health check
      const health = await this.databaseManager.healthCheck();
      if (!health.neo4j || !health.redis) {
        throw new Error(`Database health check failed: Neo4j=${health.neo4j}, Redis=${health.redis}`);
      }

      // Initialize services that need setup
      // Note: DatabaseOptimizationService might not be available for LocalDatabaseManager
      if (hasInitialize(this.databaseOptimizationService)) {
        await this.databaseOptimizationService.initialize();
      }

      // Initialize Phase 1 I/O services in every mode.
      //
      // GraphService, ExportService and JobService build their own
      // GraphRepository/VersionRepository/JobRepository from
      // `localExecution.dataDirectory`, and there is no Redis- or Neo4j-backed
      // implementation of them: graph metadata, jobs, versions and API keys are
      // files in cloud mode exactly as in local mode. In cloud mode the Neo4j
      // and Redis connections serve the *entities* (the graph-scoped
      // repositories above) and Redis holds the rate-limit snapshot.
      // Initialising these services in cloud mode is what makes the
      // graph/export/job routes work there instead of failing against an
      // uninitialised store (e.g. a missing jobs directory). Because that state
      // is per process, cloud mode is a single replica -- enforced by
      // `validateConfig`.
      await this.graphService.initialize();

      // Legacy live-store adoption is a local-execution migration of the
      // pre-multi-graph `graph.json`; it stays local-only.
      if (this.config.localExecution.enabled) {
        await this.adoptLegacyLiveStore();
      }

      await this.exportService.initialize();
      await this.jobService.initialize();
      this.jobService.start();

      // Initialize Phase 3: Authentication services (all modes)
      console.log('🔐 Initializing authentication services...');
      await this.authService.initialize();
      await this.rateLimitService.initialize();

      const mode = this.config.localExecution.enabled ? 'Local Mode' : 'Cloud Mode';
      // One statement, because there is one truth. `validateConfig` refuses to
      // start cloud mode without CLOUD_SINGLE_REPLICA_STATE, but that variable
      // is an assertion by the operator, not a detection: this line says what
      // the state actually is, not what the deployment was meant to be.
      if (this.config.localExecution.enabled) {
        console.log(`📦 Service container initialized (${mode}).`);
        console.log(
          `📁 Phase 1/3 I/O storage is file-backed JSON under ${this.config.localExecution.dataDirectory}: ` +
            'graph, export/job, version, API-key and rate-limit state.'
        );
      } else {
        console.log(`📦 Service container initialized (${mode}).`);
        console.log(
          '☁️  Entities are in Neo4j. Per process, not shared between replicas: ' +
            `graph metadata, export/job records, versions and API keys (files under ${this.config.localExecution.dataDirectory}) ` +
            'and the rate-limit counters (in memory, snapshotted to Redis every 30 s when they change). ' +
            'The deployment must be a single replica with a persistent volume; CLOUD_SINGLE_REPLICA_STATE asserts that, it does not verify it.'
        );
      }
    } catch (error) {
      console.error('❌ Failed to initialize service container:', error);
      throw error;
    }
  }

  /**
   * Adopt the historical single live-store file into the active graph, once.
   *
   * Runs after `graphService.initialize()` (and therefore after the graph
   * repository is initialised). It is deliberately limited to local mode:
   * although the per-graph live store is file-backed in both modes, adopting a
   * pre-multi-graph `graph.json` is a local-execution migration step, so cloud
   * deployments start from an empty graph index rather than silently importing
   * whatever file happens to sit in the data directory. See
   * `adoptLegacyGraphStore` for the guard and failure policy.
   */
  private async adoptLegacyLiveStore(): Promise<void> {
    const legacyFilePath = path.join(
      this.config.localExecution.dataDirectory,
      this.config.localExecution.graphFile
    );
    await adoptLegacyGraphStore({
      legacyFilePath,
      graphContextStore: this.graphContextStore,
      graphRepository: this.graphRepository,
    });
  }

  /**
   * Cleanup all services and close connections
   */
  async cleanup(): Promise<void> {
    console.log('Cleaning up service container...');

    try {
      // Stop Phase 1 I/O services
      if (this._jobService) {
        this._jobService.stop();
      }
      if (this._jobRepository) {
        this._jobRepository.stop();
      }

      // Stop Phase 3: Authentication services
      if (this._rateLimitService) {
        this._rateLimitService.stop();
      }

      // Shut down graph-scoped live stores so pending writes are saved and
      // their backup timers cleared before the process tears down.
      if (this._graphContextStore) {
        await this._graphContextStore.evictAll();
      }

      // Close database connections
      await this.databaseManager.close();
      
      console.log('Service container cleaned up successfully');
    } catch (error) {
      console.error('Error during service container cleanup:', error);
      throw error;
    }
  }

  /**
   * Get service health status
   */
  async getHealthStatus(): Promise<{
    status: 'healthy' | 'unhealthy';
    services: Record<string, boolean>;
    database: { neo4j: boolean; redis: boolean };
    timestamp: string;
  }> {
    const dbHealth = await this.databaseManager.healthCheck();
    
    const services = {
      temporalService: !!this._temporalService,
      causalService: !!this._causalService,
      inferenceService: !!this._inferenceService,
      graphCopyService: !!this._graphCopyService,
      validationService: !!this._validationService,
      cacheInvalidationService: !!this._cacheInvalidationService,
      databaseOptimizationService: !!this._databaseOptimizationService,
      eventRepository: !!this._eventRepository,
      arcRepository: !!this._arcRepository,
      // Phase 1 I/O services
      graphService: !!this._graphService,
      exportService: !!this._exportService,
      jobService: !!this._jobService,
      graphRepository: !!this._graphRepository,
      versionRepository: !!this._versionRepository,
      jobRepository: !!this._jobRepository,
      // Phase 3: Authentication services
      authService: !!this._authService,
      rateLimitService: !!this._rateLimitService,
      apiKeyRepository: !!this._apiKeyRepository
    };

    const allHealthy = dbHealth.neo4j && dbHealth.redis && Object.values(services).every(Boolean);

    return {
      status: allHealthy ? 'healthy' : 'unhealthy',
      services,
      database: {
        neo4j: dbHealth.neo4j,
        redis: dbHealth.redis
      },
      timestamp: new Date().toISOString()
    };
  }
}

/**
 * The container as seen by request handlers: the full container minus every
 * process-wide, globally-scoped data-reading surface.
 *
 * Omitted: the two global live-store repositories (`eventRepository`,
 * `arcRepository`); `temporalService`, which is constructed from those global
 * repositories and so selects global events/arcs; `causalService`, which is
 * constructed without a store and so resolves the global `LocalGraphStore`; and
 * `databaseManager`, whose `getGraphStore()`/session expose the same global
 * store. Handlers obtain graph-bound repositories and services from
 * `req.container.graphScopedRepositories(req.graphId)` instead.
 *
 * This raises the cost of an unscoped read from "accidental" to "deliberate",
 * but it does NOT make one impossible. These escapes remain, and none is a type
 * error:
 *   1. the exported module-level `getContainer()` returns the full `Container`,
 *      so `getContainer().eventRepository` compiles with no cast;
 *   2. a handler may cast `req.container` back to `Container`; and
 *   3. `graphCopyService` stays on this type. It is constructed from the global
 *      `databaseManager` session, so it reads global data, but graph copy is
 *      inherently cross-graph and there is no graph-scoped replacement today.
 *      Removing it would break the copy route (`graphs.ts`) rather than fix a
 *      leak, so it is a documented known hole instead of a silent one.
 * No `Omit` can close (1), because the accessor is deliberately shared with
 * non-request contexts (CLI paths, tests). Closing it fully would require
 * removing or graph-scoping that module-level accessor, which is a follow-on.
 * What this type does guarantee is that a handler cannot reach global data by
 * accident through the container it is handed. A cast that reaches an unscoped
 * repository is a deliberate, visible act rather than a silent leak.
 */
export type RequestContainer = Omit<
  Container,
  'eventRepository' | 'arcRepository' | 'temporalService' | 'causalService' | 'databaseManager'
>;

/**
 * Global container instance
 */
let container: Container | null = null;

/**
 * Initialize the global container
 */
export function initializeContainer(databaseManager: DatabaseManager | LocalDatabaseManager, config: AppConfig): Container {
  container = new Container(databaseManager, config);
  return container;
}

/**
 * Get the global container instance
 */
export function getContainer(): Container {
  if (!container) {
    throw new Error('Container not initialized. Call initializeContainer first.');
  }
  return container;
}

/**
 * Cleanup the global container
 */
export async function cleanupContainer(): Promise<void> {
  if (container) {
    await container.cleanup();
    container = null;
  }
}