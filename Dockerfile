# syntax=docker/dockerfile:1

# ---------------------------------------------------------------------------
# Production images for Althistory.
#
# Two final targets share one build:
#   api  - Node runtime serving the compiled Express backend (and the CLI bin)
#   web  - Caddy serving the compiled frontend and proxying /api to `api`
#
# Build a single target with:
#   docker build --target api -t althistory-api .
#   docker build --target web -t althistory-web .
# ---------------------------------------------------------------------------

# --- All dependencies, needed to compile both packages ---------------------
FROM node:20-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY timeline/package.json timeline/
COPY frontend/package.json frontend/
RUN npm ci

# --- Compile backend + frontend -------------------------------------------
FROM deps AS build
WORKDIR /app
COPY . .
# The SPA is served from the same origin as the reverse proxy, so the client
# must call the relative /api path rather than the dev server's localhost URL.
ENV VITE_API_BASE_URL=/api
RUN npm run build

# --- Production-only dependencies -----------------------------------------
# `tsconfig-paths` is a runtime dependency (see timeline/package.json): tsc does
# not rewrite the `@/` aliases, so the compiled output needs them resolved at
# startup.
FROM node:20-bookworm-slim AS prod-deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY timeline/package.json timeline/
COPY frontend/package.json frontend/
RUN npm ci --omit=dev

# --- API runtime -----------------------------------------------------------
FROM node:20-bookworm-slim AS api
ENV NODE_ENV=production \
    PORT=3000 \
    LOCAL_EXECUTION_ENABLED=false \
    LOCAL_DATA_DIR=/data \
    TS_NODE_PROJECT=/app/timeline/tsconfig.runtime.json
# Work from the timeline workspace so node resolves `tsconfig-paths/register`
# (and any other workspace-local dependency) from timeline/node_modules.
WORKDIR /app/timeline

COPY --from=prod-deps /app/node_modules /app/node_modules
COPY --from=prod-deps /app/timeline/node_modules /app/timeline/node_modules
COPY --from=prod-deps /app/timeline/package.json /app/timeline/package.json
COPY timeline/tsconfig.json timeline/tsconfig.runtime.json /app/timeline/
COPY --from=build /app/timeline/dist /app/timeline/dist

# Production CLI entrypoint: runs the compiled CLI instead of the dev-only
# ts-node wrapper in bin/althistory.
COPY docker/althistory-cli.sh /usr/local/bin/althistory
RUN chmod +x /usr/local/bin/althistory

# File-backed graph/export/job state (there is no Neo4j-backed implementation
# of those repositories); mount a volume here in production.
RUN mkdir -p /data
VOLUME /data

EXPOSE 3000

# Liveness: the process is up and serving HTTP. This deliberately probes `/`
# and not `/health`; `/health` reports readiness and answers 503 until every
# lazy container singleton has been resolved, so it is not a liveness signal.
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=5 \
  CMD node -e "require('http').get('http://127.0.0.1:'+(process.env.PORT||3000)+'/',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

CMD ["node", "-r", "tsconfig-paths/register", "dist/index.js"]

# --- Web runtime (static frontend + reverse proxy) -------------------------
FROM caddy:2-alpine AS web
COPY docker/caddy/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/frontend/dist /srv
EXPOSE 80 443
