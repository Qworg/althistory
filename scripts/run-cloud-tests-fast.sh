#!/usr/bin/env bash
#
# Run the cloud integration suites against a running Neo4j/Redis stack.
#
# `scripts/run-cloud-tests.sh` builds the production image and runs the suites
# inside it. That is the right way to verify the shipped artifact, but it is
# slow to iterate on. This script runs the same suites from a stock node image
# with the repository mounted, which is a few seconds per iteration.
#
# Requires the althistory compose stack to be up:
#   docker compose up -d neo4j redis
#
# DESTRUCTIVE: the suites delete every :Event and :Arc node in the database
# they are pointed at, and `database.test.ts` drops the schema. Point them at a
# throwaway instance.
#
# Prerequisites and assumptions:
#   - the compose network is named `althistory_default` (override with
#     COMPOSE_NETWORK);
#   - the repository's `node_modules` are installed for this platform, because
#     they are mounted into the container (a macOS checkout will not work);
#   - the container runs as root, so files it writes under `node_modules`
#     become root-owned on the host.
#
# Usage:
#   ./scripts/run-cloud-tests-fast.sh                # run the suites
#   ./scripts/run-cloud-tests-fast.sh -t "pattern"   # filter by test name
set -euo pipefail

cd "$(dirname "$0")/.."

if [ ! -f .env ]; then
  echo "error: no .env found. Run:" >&2
  echo "  cp .env.production.example .env   # then set NEO4J_PASSWORD" >&2
  exit 1
fi

# Read the secrets the compose stack was started with, so this script talks to
# the same instance the same way.
read_env() {
  grep -E "^$1=" .env | head -1 | cut -d= -f2- || true
}

NEO4J_PASSWORD="${NEO4J_PASSWORD:-$(read_env NEO4J_PASSWORD)}"
REDIS_PASSWORD="${REDIS_PASSWORD:-$(read_env REDIS_PASSWORD)}"
NEO4J_PASSWORD="${NEO4J_PASSWORD:-test_password_12345}"
NETWORK="${COMPOSE_NETWORK:-althistory_default}"

# The exit status has to survive: the suites' failure is the point of the
# script, so `tail` must not become the status of the pipeline.
exec docker run --rm --network "$NETWORK" \
  -v "$PWD:/app" -w /app \
  -e NODE_ENV=test -e LOCAL_EXECUTION_ENABLED=false \
  -e NEO4J_URI=bolt://neo4j:7687 -e NEO4J_USERNAME=neo4j -e NEO4J_PASSWORD="$NEO4J_PASSWORD" \
  -e NEO4J_DATABASE=neo4j \
  -e NEO4J_TEST_URI=bolt://neo4j:7687 -e NEO4J_TEST_USERNAME=neo4j \
  -e NEO4J_TEST_PASSWORD="$NEO4J_PASSWORD" -e NEO4J_TEST_DATABASE=neo4j \
  -e REDIS_HOST=redis -e REDIS_PORT=6379 -e REDIS_PASSWORD="$REDIS_PASSWORD" \
  -e REDIS_TEST_HOST=redis -e REDIS_TEST_PORT=6379 -e REDIS_TEST_PASSWORD="$REDIS_PASSWORD" \
  node:22-bookworm \
  bash -c 'set -o pipefail; cd timeline && npm run test:cloud -- "$@" 2>&1 | tail -"${TAIL_LINES:-80}"' _ "$@"
