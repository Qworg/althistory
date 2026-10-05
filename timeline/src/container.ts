import { DatabaseManager, LocalDatabaseManager, LocalSession } from '@/utils/database';
import { 
  TemporalService, 
  CausalService, 
  InferenceService, 
  GraphCopyService, 
  ValidationService,
  CacheInvalidationService,
  DatabaseOptimizationService,
  GraphService,
  ExportService,
  JobService,
  AuthService,
  RateLimitService
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

/**
 * Minimal shape for a component that may expose an async `initialize()`.
 *
 * `DatabaseOptimizationService` does not declare such a method today, but the
 * container keeps working when one is added, so the check below is a real
 * runtime type guard rather than a cast.
 */
type Initializable = { initialize(): Promise<void> };

function hasInitialize(value: object): value is Initializable {
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
  graphCopyService: GraphCopyService;
  validationService: ValidationService;
  cacheInvalidationService: CacheInvalidationService;
  databaseOptimizationService: DatabaseOptimizationService;
  
  // Phase 1 I/O services
  graphService: GraphService;
  exportService: ExportService;
  jobService: JobService;
  
  // Repositories
  eventRepository: EventRepository;
  arcRepository: ArcRepository;
  
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
  private _graphCopyService?: GraphCopyService;
  private _validationService?: ValidationService;
  private _cacheInvalidationService?: CacheInvalidationService;
  private _databaseOptimizationService?: DatabaseOptimizationService;
  private _eventRepository?: EventRepository;
  private _arcRepository?: ArcRepository;
  
  // Phase 1 I/O services
  private _graphService?: GraphService;
  private _exportService?: ExportService;
  private _jobService?: JobService;
  
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
  get graphService(): GraphService {
    if (!this._graphService) {
      this._graphService = new GraphService({
        dataDir: this.config.localExecution.dataDirectory,
      });
    }
    return this._graphService;
  }

  /**
   * Get export service instance (singleton)
   */
  get exportService(): ExportService {
    if (!this._exportService) {
      this._exportService = new ExportService({
        dataDir: this.config.localExecution.dataDirectory,
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
      this._rateLimitService = new RateLimitService({
        dataDir: this.config.localExecution.dataDirectory,
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

      // Initialize Phase 1 I/O services (local execution mode)
      if (this.config.localExecution.enabled) {
        await this.graphService.initialize();
        await this.exportService.initialize();
        await this.jobService.initialize();
        this.jobService.start();
      }

      // Initialize Phase 3: Authentication services (all modes)
      console.log('🔐 Initializing authentication services...');
      await this.authService.initialize();
      await this.rateLimitService.initialize();

      if (this.config.localExecution.enabled) {
        console.log('📦 Service container initialized successfully (Local Mode)');
      } else {
        console.log('☁️  Service container initialized successfully (Cloud Mode)');
      }
    } catch (error) {
      console.error('❌ Failed to initialize service container:', error);
      throw error;
    }
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