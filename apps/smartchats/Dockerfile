# Multi-stage build for the smartchats Next.js app.
#
# Build context is the monorepo ROOT — docker-compose.yml sets `context: .`
# so workspace siblings (cortex, tivi, simi, graph-viz, smartchats-common,
# smartchats-backend, smartchats-backend-{firebase,local}, llm-service) are
# reachable for npm-install resolution.
#
# Build with NEXT_PUBLIC_SMARTCHATS_BOOTSTRAP=local so layout.tsx picks the
# open-core bootstrap path. Webpack tree-shakes out the unreached wrapper
# bootstrap branch.

# ───── builder ─────
FROM node:22-slim AS builder

# `cp` for the prebuild's ONNX asset shuffling.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /repo

# Root manifest first for better layer caching.
COPY package.json package-lock.json* turbo.json ./

# Workspace packages this app's dep tree references.
COPY packages/cortex ./packages/cortex
COPY packages/tivi ./packages/tivi
COPY packages/simi ./packages/simi
COPY packages/graph-viz ./packages/graph-viz
COPY packages/smartchats-common ./packages/smartchats-common
COPY packages/smartchats-backend ./packages/smartchats-backend
COPY packages/smartchats-backend-firebase ./packages/smartchats-backend-firebase
COPY packages/smartchats-backend-local ./packages/smartchats-backend-local
COPY packages/llm-service ./packages/llm-service

# Smartchats prebuild needs the silero VAD model. It currently lives under
# ts_next_app's public/onnx — copy just that one asset, no app source.
COPY apps/ts_next_app/public/onnx/silero_vad_v5.onnx \
     ./apps/ts_next_app/public/onnx/silero_vad_v5.onnx

# The app itself.
COPY apps/smartchats ./apps/smartchats

# Install everything (workspaces resolve via the root lockfile).
# `--include=optional` ensures platform-specific binaries (sharp, swc) land.
RUN npm install --include=optional

# Build workspace deps in dependency order so the Next.js build sees
# fully-emitted dist/ artifacts.
RUN npm run build --workspace=cortex
RUN npm run build --workspace=llm-service
RUN npm run build --workspace=smartchats-backend
RUN npm run build --workspace=smartchats-common
RUN npm run build --workspace=simi
RUN npm run build --workspace=graph-viz
RUN npm run build --workspace=smartchats-backend-firebase
RUN npm run build --workspace=smartchats-backend-local
RUN npm run build --workspace=tivi

# Open-core build: pick the LocalBackend bootstrap at compile time so webpack
# can dead-code-eliminate the wrapper bootstrap branch.
ENV NEXT_PUBLIC_SMARTCHATS_BOOTSTRAP=local
ENV NEXT_TELEMETRY_DISABLED=1

WORKDIR /repo/apps/smartchats
RUN npm run build

# ───── runtime ─────
FROM node:22-slim AS runtime

RUN apt-get update \
    && apt-get install -y --no-install-recommends tini ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy the workspace tree from builder. Heavier than a Next.js standalone
# output, but standalone mode isn't enabled in next.config.mjs yet.
COPY --from=builder /repo/package.json /repo/package-lock.json* ./
COPY --from=builder /repo/node_modules ./node_modules
COPY --from=builder /repo/packages ./packages
COPY --from=builder /repo/apps/smartchats/package.json ./apps/smartchats/package.json
COPY --from=builder /repo/apps/smartchats/.next ./apps/smartchats/.next
COPY --from=builder /repo/apps/smartchats/public ./apps/smartchats/public
COPY --from=builder /repo/apps/smartchats/next.config.mjs ./apps/smartchats/next.config.mjs

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
EXPOSE 3000

WORKDIR /app/apps/smartchats
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["npx", "next", "start", "-p", "3000"]
