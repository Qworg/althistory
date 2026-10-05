import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { loadConfig, initializeDatabaseManager } from '@/utils';
import { initializeContainer, cleanupContainer } from '@/container';
import { apiRouter } from '@/api/routes';
import { 
  errorHandler, 
  notFoundHandler, 
  requestLogger, 
  requestTimeout,
  validateJsonRequest,
  injectContainer,
  authenticate,
  rateLimit
} from '@/api/middleware';

/**
 * Main application class
 */
class Application {
  private app: express.Application;
  private config: ReturnType<typeof loadConfig>;

  constructor() {
    this.app = express();
    this.config = loadConfig();
  }

  /**
   * Initialize the application
   */
  async initialize(): Promise<void> {
    try {
      // Log execution mode
      if (this.config.localExecution.enabled) {
        console.log('🚀 Starting application in LOCAL EXECUTION mode');
        console.log(`📁 Data directory: ${this.config.localExecution.dataDirectory}`);
        console.log(`💾 Graph file: ${this.config.localExecution.graphFile}`);
        console.log(`🧠 Max memory: ${this.config.localExecution.maxMemoryUsage}MB`);
      } else {
        console.log('🌐 Starting application in CLOUD mode');
        console.log(`📊 Neo4j: ${this.config.database.neo4j.uri}`);
        console.log(`🗄️  Redis: ${this.config.database.redis.host}:${this.config.database.redis.port}`);
      }
      
      // Initialize database manager
      const dbManager = initializeDatabaseManager(this.config.database);
      
      // Initialize service container (includes auth services)
      const container = initializeContainer(dbManager, this.config);
      await container.initialize();

      // Setup middleware
      this.setupMiddleware();

      // Setup routes
      this.setupRoutes();

      // Setup error handling
      this.setupErrorHandling();

      console.log('✅ Application initialized successfully');
    } catch (error) {
      console.error('❌ Failed to initialize application:', error);
      throw error;
    }
  }

  /**
   * Setup Express middleware
   */
  private setupMiddleware(): void {
    // Security middleware
    this.app.use(helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          scriptSrc: ["'self'"],
          imgSrc: ["'self'", "data:", "https:"],
        },
      },
    }));
    
    this.app.use(cors({
      origin: process.env.CORS_ORIGIN || '*',
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-ID', 'X-API-Key'],
      exposedHeaders: ['X-RateLimit-Limit', 'X-RateLimit-Remaining', 'X-RateLimit-Reset', 'Retry-After'],
      credentials: true
    }));

    // Request processing middleware
    this.app.use(express.json({ 
      limit: '10mb',
      verify: (req, res, buf) => {
        try {
          JSON.parse(buf.toString());
        } catch (e) {
          throw new Error('Invalid JSON');
        }
      }
    }));
    this.app.use(express.urlencoded({ extended: true, limit: '10mb' }));

    // Custom middleware (order matters!)
    this.app.use(injectContainer); // Must be first to inject container
    this.app.use(requestLogger);
    this.app.use(requestTimeout(this.config.performance.queryTimeoutMs));
    this.app.use(validateJsonRequest);
    
    // Rate limiting (can be enabled per environment)
    if (this.config.nodeEnv === 'production') {
      this.app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 1000 })); // 1000 requests per 15 minutes
    }
    
    // Global authentication middleware - validates API keys on all routes
    // Note: Individual routes use requireAuth to enforce authentication
    this.app.use(authenticate);
  }

  /**
   * Setup application routes
   */
  private setupRoutes(): void {
    // Health check endpoint (before API routes for monitoring)
    this.app.get('/health', async (req, res) => {
      try {
        const container = (req as any).container;
        const health = await container.getHealthStatus();
        
        res.status(health.status === 'healthy' ? 200 : 503).json({
          ...health,
          uptime: process.uptime(),
          memory: process.memoryUsage(),
          version: '1.0.0'
        });
      } catch (error) {
        res.status(503).json({
          status: 'unhealthy',
          error: 'Health check failed',
          timestamp: new Date().toISOString()
        });
      }
    });

    // API routes
    this.app.use('/api', apiRouter);

    // Root endpoint
    this.app.get('/', (req, res) => {
      res.json({
        name: 'Hierarchical Temporal Graph System',
        version: '1.0.0',
        status: 'running',
        timestamp: new Date().toISOString(),
        api: '/api',
        health: '/health',
        environment: this.config.nodeEnv
      });
    });
  }

  /**
   * Setup error handling
   */
  private setupErrorHandling(): void {
    // 404 handler (must be before error handler)
    this.app.use(notFoundHandler);

    // Global error handler (must be last)
    this.app.use(errorHandler);
  }

  /**
   * Start the server
   */
  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        const server = this.app.listen(this.config.port, () => {
          console.log(`Server running on port ${this.config.port}`);
          console.log(`Environment: ${this.config.nodeEnv}`);
          console.log(`API available at: http://localhost:${this.config.port}/api`);
          resolve();
        });

        // Graceful shutdown handling
        process.on('SIGTERM', () => this.shutdown(server));
        process.on('SIGINT', () => this.shutdown(server));
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Graceful shutdown
   */
  private async shutdown(server: any): Promise<void> {
    console.log('Shutting down gracefully...');
    
    server.close(async () => {
      try {
        // Cleanup service container (includes database connections and auth services)
        await cleanupContainer();
        
        console.log('Application shut down successfully');
        process.exit(0);
      } catch (error) {
        console.error('Error during shutdown:', error);
        process.exit(1);
      }
    });

    // Force shutdown after 30 seconds
    setTimeout(() => {
      console.error('Forced shutdown after timeout');
      process.exit(1);
    }, 30000);
  }
}

/**
 * Start the application
 */
async function main(): Promise<void> {
  try {
    const app = new Application();
    await app.initialize();
    await app.start();
  } catch (error) {
    console.error('Failed to start application:', error);
    process.exit(1);
  }
}

// Start the application if this file is run directly
if (require.main === module) {
  main();
}

export { Application };