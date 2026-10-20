/**
 * Guard for the cloud integration suites.
 *
 * These suites exist to test Neo4j. If they ever run against the local store
 * they still "work" -- `LocalDatabaseManager` implements a Neo4j-shaped
 * session -- which is exactly how a green-looking cloud run could mean
 * nothing at all. That is not hypothetical: the suites passed against the
 * local JSON store for as long as `timeline/.env.local` was allowed to
 * override the environment.
 *
 * The check runs in a setup file, before any test, and fails the run outright
 * if local execution is enabled or if the driver cannot reach Neo4j.
 */

import { beforeAll } from 'vitest';
import neo4j from 'neo4j-driver';
import { loadConfig } from '../utils/config';

/** Prove one set of credentials reaches the server, or explain why not. */
async function assertReachable(
  label: string,
  uri: string | undefined,
  username: string | undefined,
  password: string | undefined,
  database: string
): Promise<void> {
  if (!uri) {
    throw new Error(`The cloud suites require ${label} to be set.`);
  }

  const driver = neo4j.driver(uri, neo4j.auth.basic(username ?? 'neo4j', password ?? ''));
  try {
    const session = driver.session({ database });
    await session.run('RETURN 1 AS reachable');
    await session.close();
  } catch (error) {
    throw new Error(
      `The cloud suites could not reach Neo4j at ${uri} (${label}): ` +
        `${error instanceof Error ? error.message : String(error)}`
    );
  } finally {
    await driver.close();
  }
}

beforeAll(async () => {
  // The guard asks `loadConfig` rather than comparing strings, so it decides
  // exactly the way the code under test does -- `parseBooleanEnvVar` accepts
  // "TRUE", "1" and "yes", and a case-sensitive comparison here would let
  // those through.
  if (loadConfig().localExecution.enabled) {
    throw new Error(
      'The cloud suites require LOCAL_EXECUTION_ENABLED to be false. ' +
        'They were running against the local JSON store, which is not what they test. ' +
        'A stray .env.local can set this; the environment must win over it.'
    );
  }

  const database = process.env.NEO4J_TEST_DATABASE || process.env.NEO4J_DATABASE || 'neo4j';

  // Both sets are probed, separately. The repository suites read the _TEST_
  // variables; GraphCopyService goes through `getDatabaseManager()`, which is
  // configured from the plain ones. Probing only one set would let a
  // configuration where they disagree pass the guard and then fail
  // confusingly halfway through a suite.
  await assertReachable(
    'NEO4J_TEST_URI',
    process.env.NEO4J_TEST_URI,
    process.env.NEO4J_TEST_USERNAME,
    process.env.NEO4J_TEST_PASSWORD,
    process.env.NEO4J_TEST_DATABASE || database
  );

  await assertReachable(
    'NEO4J_URI',
    process.env.NEO4J_URI,
    process.env.NEO4J_USERNAME,
    process.env.NEO4J_PASSWORD,
    process.env.NEO4J_DATABASE || database
  );
});
