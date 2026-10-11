#!/usr/bin/env sh
#
# Production entrypoint for the Althistory CLI inside the `api` image.
#
# `bin/althistory` in the repository runs the TypeScript source through ts-node,
# which needs the dev dependencies. The container ships only the compiled
# output, so the CLI runs `dist/cli/index.js` with the runtime path-alias
# config instead.
set -e

cd /app/timeline
exec node -r tsconfig-paths/register dist/cli/index.js "$@"
