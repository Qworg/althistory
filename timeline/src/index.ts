import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { createServer } from 'http';
import type { Server } from 'http';
import { loadConfig, initializeDatabaseManager } from '@/utils';
import { initializeContainer, cleanupContainer, getContainer } from '@/container';
import { apiRouter } from '@/api/routes';
import { StreamHandler, StreamSessionManager, getStreamTokenStore, STREAM_PATH } from '@/websocket';
import { 
  errorHandler, 
  notFoundHandler, 
  requestLogger, 
  requestTimeout,
  validateJsonRequest,
  injectContainer,
  authenticate,
  rateLimit,
  asRequestHandler,
} from '@/api/middleware';

// Re-exported for callers that imported the adapter from the entrypoint.
export { asRequestHandler };

/**
 * Main application class
 */
class Application {
  private app: express.Application;
  private config: ReturnType<typeof loadConfig>;
  private streamHandler: StreamHandler | undefined;

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
    // Note: this middleware derives its limits from the API key's
    // RateLimitConfig (requestsPerMinute/Hour/Day); it has no window-based
    // configuration, so nothing is passed here.
    if (this.config.nodeEnv === 'production') {
      this.app.use(asRequestHandler(rateLimit()));
    }
    
    // Global authentication middleware - validates API keys on all routes
    // Note: Individual routes use requireAuth to enforce authentication
    this.app.use(asRequestHandler(authenticate));
  }

  /**
   * Setup application routes
   */
  private setupRoutes(): void {
    // Health check endpoint (before API routes for monitoring)
    this.app.get('/health', async (req, res) => {
      try {
        const container = req.container;
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
        // A raw `app.listen()` cannot host a WebSocket upgrade, so build the
        // HTTP server explicitly and attach the stream handler to its
        // `upgrade` event before listening.
        const server = createServer(this.app);
        const container = getContainer();
        const streamHandler = new StreamHandler({
          tokenStore: getStreamTokenStore(),
          sessionManager: new StreamSessionManager(),
          deps: {
            authService: container.authService,
            graphScopedRepositories: (graphId) => container.graphScopedRepositories(graphId),
            graphWriteVersioningService: container.graphWriteVersioningService,
          },
        });
        streamHandler.attach(server);
        this.streamHandler = streamHandler;

        server.listen(this.config.port, () => {
          console.log(`Server running on port ${this.config.port}`);
          console.log(`Environment: ${this.config.nodeEnv}`);
          console.log(`API available at: http://localhost:${this.config.port}/api`);
          console.log(`WebSocket stream available at: ws://localhost:${this.config.port}${STREAM_PATH}`);
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
  private async shutdown(server: Server): Promise<void> {
    console.log('Shutting down gracefully...');

    // Close streaming sockets FIRST. An open WebSocket is a live connection, so
    // `server.close()` does not complete while one exists; terminating them is
    // what keeps shutdown from hanging until the force-exit timer below.
    if (this.streamHandler) {
      try {
        await this.streamHandler.close();
      } catch (error) {
        console.error('Error closing WebSocket stream handler:', error);
      }
      this.streamHandler = undefined;
    }

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

    // Drop idle keep-alive HTTP connections so `server.close()` can complete.
    server.closeIdleConnections();

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