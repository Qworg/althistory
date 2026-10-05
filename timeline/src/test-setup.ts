import '@testing-library/jest-dom';
import { config } from 'dotenv';

// Load environment variables for tests
config();

// Set test environment variables if not already set
if (!process.env.NODE_ENV) {
  process.env.NODE_ENV = 'test';
}

// Enable local execution for tests to avoid requiring external databases
if (!process.env.LOCAL_EXECUTION_ENABLED) {
  process.env.LOCAL_EXECUTION_ENABLED = 'true';
}

// Set default test database configuration
if (!process.env.NEO4J_URI) {
  process.env.NEO4J_URI = 'bolt://localhost:7687';
}
if (!process.env.NEO4J_USERNAME) {
  process.env.NEO4J_USERNAME = 'neo4j';
}
if (!process.env.NEO4J_PASSWORD) {
  process.env.NEO4J_PASSWORD = 'password';
}
if (!process.env.NEO4J_DATABASE) {
  process.env.NEO4J_DATABASE = 'test';
}

// Set Redis defaults
if (!process.env.REDIS_HOST) {
  process.env.REDIS_HOST = 'localhost';
}
if (!process.env.REDIS_PORT) {
  process.env.REDIS_PORT = '6379';
}

// Global test timeout for database operations
const originalTimeout = setTimeout;
// `Object.assign` keeps the *type* of the global identical to Node's
// `setTimeout` (which carries extra members such as `__promisify__`, so a bare
// replacement arrow function is not assignable) while installing the capped
// implementation as the callable.
global.setTimeout = Object.assign(
  (callback: (...args: unknown[]) => void, delay?: number, ...args: unknown[]) =>
    originalTimeout(callback, Math.min(delay ?? 0, 5000), ...args),
  setTimeout
);