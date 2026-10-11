#!/usr/bin/env bash
#
# Run the cloud integration suites against real Neo4j and Redis.
#
# The default test run excludes the suites that need those services; this script
# brings them up with docker compose, waits for their healthchecks, runs the
# excluded suites inside the same toolchain image the production build uses, and
# tears the services down again.
#
# Usage:
#   ./scripts/run-cloud-tests.sh           # start deps, run suites, stop deps
#   ./scripts/run-cloud-tests.sh --keep    # leave Neo4j/Redis running afterwards

set -euo pipefail

cd "$(dirname "$0")/.."

if ! docker compose version >/dev/null 2>&1; then
  echo "error: docker compose v2 is required" >&2
  exit 1
fi

if [ ! -f .env ]; then
  echo "error: no .env found. Run:" >&2
  echo "  cp .env.production.example .env   # then set NEO4J_PASSWORD" >&2
  exit 1
fi

keep=0
if [ "${1:-}" = "--keep" ]; then
  keep=1
fi

cleanup() {
  if [ "$keep" -eq 1 ]; then
    echo "Leaving Neo4j and Redis running (--keep)."
  else
    docker compose down
  fi
}
trap cleanup EXIT

echo "Starting Neo4j and Redis..."
docker compose up -d --wait neo4j redis

echo "Running cloud integration suites..."
docker compose --profile test run --rm cloud-tests

echo "Cloud integration suites passed."
