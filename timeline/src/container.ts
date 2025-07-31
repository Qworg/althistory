import { DatabaseManager } from '@/utils/database';
import { 
  TemporalService, 
  CausalService, 
  InferenceService, 
  GraphCopyService, 
  ValidationService,
  CacheInvalidationService,
  DatabaseOptimizationService
} from '@/services';
import { EventRepository, ArcRepository } from '@/repositories';
import { AppConfig } from '@/utils/config';

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
  
  // Repositories
  eventRepository: EventRepository;
  arcRepository: ArcRepository;
  
  // Infrastructure
  databaseManager: DatabaseManager;
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

  constructor(
    public readonly databaseManager: DatabaseManager,
    public readonly config: AppConfig
  ) {}

  /**
   * Get temporal service instance (singleton)
   */
  get temporalService(): TemporalService {
    if (!this._temporalService) {
      this._temporalService = new TemporalService(
        this.databaseManager,
        this.validationService
      );
    }
    return this._temporalService;
  }

  /**
   * Get causal service instance (singleton)
   */
  get causalService(): CausalService {
    if (!this._causalService) {
      this._causalService = new CausalService(
        this.databaseManager,
        this.temporalService,
        this.validationService
      );
    }
    return this._causalService;
  }

  /**
   * Get inference service instance (singleton)
   */
  get inferenceService(): InferenceService {
    if (!this._inferenceService) {
      this._inferenceService = new InferenceService(
        this.databaseManager,
        this.temporalService,
        this.causalService
      );
    }
    return this._inferenceService;
  }

  /**
   * Get graph copy service instance (singleton)
   */
  get graphCopyService(): GraphCopyService {
    if (!this._graphCopyService) {
      this._graphCopyService = new GraphCopyService(
        this.databaseManager,
        this.validationService
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
      this._cacheInvalidationService = new CacheInvalidationService(
        this.databaseManager.getRedisClient()
      );
    }
    return this._cacheInvalidationService;
  }

  /**
   * Get database optimization service instance (singleton)
   */
  get databaseOptimizationService(): DatabaseOptimizationService {
    if (!this._databaseOptimizationService) {
      this._databaseOptimizationService = new DatabaseOptimizationService(
        this.databaseManager
      );
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
      this._arcRepository = new ArcRepository(
        this.databaseManager,
        this.validationService,
        this.temporalService,
        this.cacheInvalidationService
      );
    }
    return this._arcRepository;
  }

  /**
   * Initialize all services and perform health checks
   */
  async initialize(): Promise<void> {
    console.log('Initializing service container...');

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
      await this.databaseOptimizationService.initialize();

      console.log('Service container initialized successfully');
    } catch (error) {
      console.error('Failed to initialize service container:', error);
      throw error;
    }
  }

  /**
   * Cleanup all services and close connections
   */
  async cleanup(): Promise<void> {
    console.log('Cleaning up service container...');

    try {
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
      arcRepository: !!this._arcRepository
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
export function initializeContainer(databaseManager: DatabaseManager, config: AppConfig): Container {
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