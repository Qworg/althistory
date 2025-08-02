# Hierarchical Temporal Graph System

A sophisticated system for capturing, analyzing, and visualizing historical events across multiple temporal scales using graph database technology. The system supports both cloud-based deployment with Neo4j and Redis, as well as local execution for offline development.

## 🌟 Features

- **Hierarchical Temporal Modeling**: Capture events and arcs (periods) at multiple temporal scales
- **Causal Relationship Analysis**: Model and analyze cause-and-effect relationships between events
- **Graph Visualization**: Interactive timeline and causal graph visualizations
- **Dual Execution Modes**: Run locally for development or deploy to cloud with full infrastructure
- **Performance Optimized**: Intelligent caching, query optimization, and connection pooling
- **Real-time Analysis**: Inference engine for detecting patterns and suggesting relationships

## 🏗️ Architecture

### Core Components
- **Events**: Specific historical occurrences with precise temporal information
- **Arcs**: Historical phases or periods that can contain events and other arcs
- **Causal Relationships**: Weighted connections showing influence between events
- **Inferred Pressures**: System-calculated influences between temporal entities

### Technology Stack
- **Backend**: Node.js, Express.js, TypeScript
- **Database**: Neo4j (graph database) + Redis (caching) OR Local file-based storage
- **Frontend**: React, D3.js, Cytoscape.js
- **Testing**: Vitest, React Testing Library

## 🚀 Quick Start

### Prerequisites

#### For Local Development (Recommended for getting started)
- Node.js 18+ and npm
- Git

#### For Cloud Deployment
- Node.js 18+ and npm
- Neo4j 4.4+ database instance
- Redis 6+ instance
- Git

### Installation

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd hierarchical-temporal-graph
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Choose your execution mode** (see detailed instructions below)

## 🏠 Local Execution Mode (Offline Development)

Perfect for development, testing, or when you don't have access to Neo4j/Redis infrastructure.

### Setup

1. **Create local environment file**
   ```bash
   cp .env.example .env.local
   ```

2. **Configure local execution in `.env.local`**
   ```env
   # Enable local execution mode
   LOCAL_EXECUTION_ENABLED=true
   
   # Local storage configuration
   LOCAL_DATA_DIR=./data
   LOCAL_GRAPH_FILE=graph.json
   LOCAL_MAX_MEMORY_MB=512
   LOCAL_CACHE_SIZE=1000
   
   # Optional: Backup settings
   LOCAL_BACKUP_ENABLED=true
   LOCAL_BACKUP_INTERVAL=300000
   LOCAL_PERSISTENCE_INTERVAL=30000
   
   # Application settings
   PORT=3000
   NODE_ENV=development
   ```

3. **Start the application**
   ```bash
   npm run dev
   ```

### Local Mode Features

- **Zero Infrastructure**: No external databases required
- **File-based Storage**: All data stored in JSON files in `LOCAL_DATA_DIR`
- **Automatic Backups**: Configurable backup creation with retention
- **Memory Management**: LRU eviction when memory limits are reached
- **Persistence**: Data automatically saved at regular intervals
- **Offline Capable**: Works completely without internet connection

### Local Data Structure
```
data/
├── graph.json          # Main graph database file
├── cache.json          # Cached query results
└── backups/           # Automatic backups
    ├── graph_backup_2024-01-01T10-00-00.json
    └── ...
```

## ☁️ Cloud Execution Mode (Production)

For production deployments with full Neo4j and Redis infrastructure.

### Prerequisites Setup

#### Neo4j Database
1. **Install Neo4j**
   - [Neo4j Desktop](https://neo4j.com/download/) (easiest for development)
   - [Neo4j Community Server](https://neo4j.com/deployment-center/)
   - Cloud options: [Neo4j Aura](https://neo4j.com/cloud/aura/)

2. **Create database and user**
   ```cypher
   CREATE DATABASE temporalgraph;
   CREATE USER temporaluser SET PASSWORD 'your-secure-password';
   GRANT ROLE admin TO temporaluser;
   ```

#### Redis Cache
1. **Install Redis**
   - macOS: `brew install redis && brew services start redis`
   - Ubuntu: `sudo apt install redis-server`
   - Docker: `docker run -d -p 6379:6379 redis:alpine`
   - Cloud options: Redis Cloud, AWS ElastiCache, etc.

### Configuration

1. **Create production environment file**
   ```bash
   cp .env.example .env.production
   ```

2. **Configure cloud execution in `.env.production`**
   ```env
   # Disable local execution (use cloud infrastructure)
   LOCAL_EXECUTION_ENABLED=false
   
   # Neo4j Configuration
   NEO4J_URI=bolt://localhost:7687
   NEO4J_USERNAME=temporaluser
   NEO4J_PASSWORD=your-secure-password
   NEO4J_DATABASE=temporalgraph
   
   # Redis Configuration
   REDIS_HOST=localhost
   REDIS_PORT=6379
   REDIS_PASSWORD=your-redis-password
   
   # Application Configuration
   PORT=3000
   NODE_ENV=production
   
   # Performance Tuning
   QUERY_TIMEOUT_MS=30000
   MAX_QUERY_RESULTS=10000
   CACHE_EXPIRATION_MS=300000
   
   # CORS Configuration
   CORS_ORIGIN=https://yourdomain.com
   ```

3. **Build and start the application**
   ```bash
   npm run build
   npm start
   ```

## 🛠️ Development

### Available Scripts

```bash
# Development with hot reload
npm run dev

# Build for production
npm run build

# Start production server
npm start

# Run tests
npm test

# Run tests in watch mode
npm run test:watch

# Format code
npm run format
```

### Environment Variables Reference

#### Local Execution Settings
| Variable | Default | Description |
|----------|---------|-------------|
| `LOCAL_EXECUTION_ENABLED` | `false` | Enable local file-based execution |
| `LOCAL_DATA_DIR` | `./data` | Directory for local data storage |
| `LOCAL_GRAPH_FILE` | `graph.json` | Graph database filename |
| `LOCAL_MAX_MEMORY_MB` | `512` | Maximum memory usage in MB |
| `LOCAL_CACHE_SIZE` | `1000` | Maximum cache entries |
| `LOCAL_BACKUP_ENABLED` | `true` | Enable automatic backups |
| `LOCAL_BACKUP_INTERVAL` | `300000` | Backup interval in milliseconds |
| `LOCAL_PERSISTENCE_INTERVAL` | `30000` | Data save interval in milliseconds |

#### Cloud Infrastructure Settings
| Variable | Required | Description |
|----------|----------|-------------|
| `NEO4J_URI` | Yes | Neo4j connection URI |
| `NEO4J_USERNAME` | Yes | Neo4j username |
| `NEO4J_PASSWORD` | Yes | Neo4j password |
| `NEO4J_DATABASE` | No | Neo4j database name |
| `REDIS_HOST` | No | Redis host (default: localhost) |
| `REDIS_PORT` | No | Redis port (default: 6379) |
| `REDIS_PASSWORD` | No | Redis password |

#### Application Settings
| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | HTTP server port |
| `NODE_ENV` | `development` | Environment mode |
| `QUERY_TIMEOUT_MS` | `30000` | Database query timeout |
| `MAX_QUERY_RESULTS` | `10000` | Maximum query result size |
| `CACHE_EXPIRATION_MS` | `300000` | Cache expiration time |
| `CORS_ORIGIN` | `*` | CORS allowed origins |

## 📚 API Documentation

### Health Check
```bash
GET /health
```
Returns system health status including database connectivity and service status.

### Events API
```bash
# Create event
POST /api/events
Content-Type: application/json
{
  "description": "World War II begins",
  "actor": "Germany",
  "target": "Poland",
  "timestamp": "1939-09-01T00:00:00Z"
}

# Get events in time range
GET /api/events?start=1939-01-01&end=1945-12-31&limit=100

# Get specific event
GET /api/events/:id

# Update event
PUT /api/events/:id

# Delete event
DELETE /api/events/:id
```

### Arcs API
```bash
# Create arc (historical period)
POST /api/arcs
Content-Type: application/json
{
  "name": "World War II",
  "description": "Global conflict from 1939-1945",
  "start_time": "1939-09-01T00:00:00Z",
  "end_time": "1945-09-02T00:00:00Z",
  "level": 0
}

# Get overlapping arcs
GET /api/arcs/overlapping?start=1940-01-01&end=1940-12-31

# Get arc hierarchy
GET /api/arcs/:id/hierarchy?max_depth=3
```

### Causal Relationships API
```bash
# Create causal relationship
POST /api/causal/relationships
Content-Type: application/json
{
  "cause_event_id": "event1",
  "effect_event_id": "event2",
  "weight": 0.8,
  "confidence": 0.9,
  "evidence": "Historical documentation shows direct causation"
}

# Get causal chain
GET /api/causal/chains/:event_id?max_depth=5

# Detect causal cycles
GET /api/causal/cycles
```

## 🧪 Testing

### Running Tests
```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Run specific test suite
npm test -- src/services/TemporalService.test.ts

# Run performance tests
npm test -- --grep "performance"
```

### Test Structure
- **Unit Tests**: Test individual functions and classes
- **Integration Tests**: Test service interactions and database operations
- **Performance Tests**: Validate system performance under load
- **E2E Tests**: End-to-end workflow testing

## 📊 Monitoring and Performance

### Built-in Monitoring
- **Health Checks**: `/health` endpoint with detailed system status
- **Connection Pool Monitoring**: Real-time database connection statistics
- **Cache Metrics**: Hit rates, response times, and memory usage
- **Query Performance**: Automatic timeout handling and optimization suggestions

### Performance Features
- **Intelligent Caching**: Multi-layer caching with automatic invalidation
- **Connection Pooling**: Optimized database connection management
- **Query Optimization**: Automatic index creation and query analysis
- **Memory Management**: Configurable limits with graceful degradation

## 🚨 Troubleshooting

### Common Issues

#### Local Mode Issues
```bash
# Data directory permission error
chmod 755 ./data

# Memory limit exceeded
# Increase LOCAL_MAX_MEMORY_MB in .env

# Backup failures
# Check disk space and LOCAL_DATA_DIR permissions
```

#### Cloud Mode Issues
```bash
# Neo4j connection failed
# Verify NEO4J_URI, credentials, and network connectivity
npm run health

# Redis connection timeout
# Check Redis service status and REDIS_HOST/PORT
redis-cli ping

# Query timeout errors
# Increase QUERY_TIMEOUT_MS or optimize queries
```

#### Performance Issues
```bash
# Enable performance monitoring
NODE_ENV=development npm run dev

# Check cache hit rates
curl http://localhost:3000/health

# Monitor connection pool
# Check connectionPool stats in health endpoint
```

### Debug Mode
```bash
# Enable detailed logging
DEBUG=app:* npm run dev

# Enable database query logging
DEBUG=database:* npm run dev

# Enable all debug output
DEBUG=* npm run dev
```

## 🔧 Advanced Configuration

### Custom Database Schemas
The system automatically creates necessary Neo4j indexes and constraints. For custom schemas:

```cypher
// Create custom indexes
CREATE INDEX event_actor FOR (e:Event) ON (e.actor);
CREATE INDEX arc_level FOR (a:Arc) ON (a.level);

// Create custom constraints
CREATE CONSTRAINT event_id FOR (e:Event) REQUIRE e.id IS UNIQUE;
CREATE CONSTRAINT arc_id FOR (a:Arc) REQUIRE a.id IS UNIQUE;
```

### Performance Tuning

#### Neo4j Configuration
```conf
# neo4j.conf additions for high performance
dbms.memory.heap.initial_size=2G
dbms.memory.heap.max_size=4G
dbms.memory.pagecache.size=2G
```

#### Redis Configuration
```conf
# redis.conf additions
maxmemory 1gb
maxmemory-policy allkeys-lru
save 900 1
save 300 10
```

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Make your changes
4. Add tests for new functionality
5. Run the test suite (`npm test`)
6. Commit your changes (`git commit -m 'Add amazing feature'`)
7. Push to the branch (`git push origin feature/amazing-feature`)
8. Open a Pull Request

### Development Guidelines
- Follow TypeScript best practices
- Maintain test coverage above 80%
- Use descriptive commit messages
- Update documentation for API changes

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🆘 Support

- **Documentation**: Check this README and inline code documentation
- **Issues**: Report bugs and feature requests via GitHub Issues
- **Discussions**: Use GitHub Discussions for questions and community support

## 🗺️ Roadmap

- [ ] GraphQL API support
- [ ] Real-time collaboration features
- [ ] Advanced visualization options
- [ ] Machine learning integration for pattern detection
- [ ] Multi-language support
- [ ] Enhanced security features
- [ ] Mobile application support

---

**Happy graphing! 📈✨**