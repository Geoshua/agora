# syntax=docker/dockerfile:1.7
# ─────────────────────────────────────────────────────────────────────
# Agora web — public read-only catalog. Next.js standalone, no DB.
# Talks to the registry over HTTPS via AGORA_REGISTRY_URL.
# ─────────────────────────────────────────────────────────────────────

ARG NODE_VERSION=20

# ── deps ────────────────────────────────────────────────────────────
FROM node:${NODE_VERSION}-bookworm-slim AS deps
WORKDIR /app

COPY package.json package-lock.json* tsconfig.base.json ./
COPY packages/agora-core/package.json ./packages/agora-core/
COPY web/package.json ./web/
COPY registry/package.json ./registry/
COPY provider/package.json ./provider/
COPY buyer/package.json ./buyer/
COPY mcp/package.json ./mcp/
COPY dashboard/package.json ./dashboard/
COPY agents/market-monitor/package.json ./agents/market-monitor/
COPY agents/dataset-seller/package.json ./agents/dataset-seller/

RUN npm ci --include=dev

# ── builder ─────────────────────────────────────────────────────────
FROM node:${NODE_VERSION}-bookworm-slim AS builder
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json* tsconfig.base.json ./
COPY packages ./packages
COPY web ./web

ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build --workspace=@agora/web

# ── runner ──────────────────────────────────────────────────────────
FROM node:${NODE_VERSION}-bookworm-slim AS runner
WORKDIR /app

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3300 \
    HOSTNAME=0.0.0.0

COPY --from=builder /app/web/.next/standalone ./
COPY --from=builder /app/web/.next/static ./web/.next/static

USER node

EXPOSE 3300

CMD ["node", "web/server.js"]
