# Multi-stage build for smartchats-local-server.
#
# Build context is the monorepo ROOT (not this package dir) — docker-compose.yml
# sets `context: .` so workspace siblings (cortex, llm-service, smartchats-backend,
# smartchats-common) are reachable for npm-install resolution.
#
# Run from repo root:
#   docker build -f packages/smartchats-local-server/Dockerfile -t smartchats-local-server .
#
# This image contains only OPEN-CORE packages — no smartchats-cloud, no
# Firebase code, no billing module. The local server has `capabilities.billing
# = false` and runs entirely against a local SurrealDB + BYO API keys.

# ───── builder ─────
FROM node:22-slim AS builder

WORKDIR /repo

# Copy lockfile + root package.json first for better layer caching.
COPY package.json package-lock.json* ./
COPY turbo.json ./

# Copy every workspace package this server's dep tree references. Listed
# explicitly rather than `COPY . .` so unrelated packages don't bust the
# install layer cache.
COPY packages/smartchats-backend ./packages/smartchats-backend
COPY packages/smartchats-common ./packages/smartchats-common
COPY packages/cortex ./packages/cortex
COPY packages/llm-service ./packages/llm-service
COPY packages/smartchats-local-server ./packages/smartchats-local-server

# Install everything (workspaces resolve via the root lockfile).
# `--include=optional` ensures the platform-specific esbuild binary is fetched.
RUN npm install --include=optional

# Build dependencies in dependency order.
RUN npm run build --workspace=cortex
RUN npm run build --workspace=llm-service
RUN npm run build --workspace=smartchats-backend
RUN npm run build --workspace=smartchats-common
RUN npm run build --workspace=smartchats-local-server

# ───── runtime ─────
FROM node:22-slim AS runtime

# Tini for clean signal handling (Ctrl-C in compose, k8s SIGTERM, etc.)
RUN apt-get update \
    && apt-get install -y --no-install-recommends tini \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy the workspace tree from builder so node can resolve workspace symlinks
# at runtime. node_modules is preserved (npm symlinks workspace packages into
# it during install).
COPY --from=builder /repo/package.json /repo/package-lock.json* ./
COPY --from=builder /repo/node_modules ./node_modules
COPY --from=builder /repo/packages/smartchats-backend ./packages/smartchats-backend
COPY --from=builder /repo/packages/smartchats-common ./packages/smartchats-common
COPY --from=builder /repo/packages/cortex ./packages/cortex
COPY --from=builder /repo/packages/llm-service ./packages/llm-service
COPY --from=builder /repo/packages/smartchats-local-server ./packages/smartchats-local-server

# Default port — docker-compose can override via env.
ENV SMARTCHATS_PORT=4242
ENV SMARTCHATS_HOST=0.0.0.0
EXPOSE 4242

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "packages/smartchats-local-server/dist/cli.js"]
