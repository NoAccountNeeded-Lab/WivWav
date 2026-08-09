# syntax=docker/dockerfile:1.7
FROM node:26-alpine AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN npm install -g corepack@latest && corepack enable

FROM base AS builder
WORKDIR /app
# NEXT_PUBLIC_* vars are inlined into the client bundle at `next build` time,
# not read from the container's runtime environment. docker-compose.yml's
# `environment:` entry for NEXT_PUBLIC_API_URL only affects the server
# process — the browser bundle needs it baked in here, or it silently falls
# back to apps/web/src/lib/api-url.ts's DEFAULT_PUBLIC_API_URL.
ARG NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_SENTRY_DSN
ARG SENTRY_DSN
ARG NEXT_PUBLIC_SENTRY_ENABLED
ARG SENTRY_ENABLED
ARG SENTRY_ORG
ARG SENTRY_PROJECT
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_SENTRY_DSN=$NEXT_PUBLIC_SENTRY_DSN
ENV SENTRY_DSN=$SENTRY_DSN
ENV NEXT_PUBLIC_SENTRY_ENABLED=$NEXT_PUBLIC_SENTRY_ENABLED
ENV SENTRY_ENABLED=$SENTRY_ENABLED
ENV SENTRY_ORG=$SENTRY_ORG
ENV SENTRY_PROJECT=$SENTRY_PROJECT
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* ./
COPY scripts/check-node-version.mjs ./scripts/
COPY packages/config/package.json ./packages/config/
COPY packages/types/package.json ./packages/types/
COPY packages/observability/package.json ./packages/observability/
COPY packages/db/package.json ./packages/db/
COPY packages/db/prisma.config.ts ./packages/db/
COPY packages/db/prisma/schema.prisma ./packages/db/prisma/
# @wivwav/db depends on @wivwav/logger since the #499 claims/resolution logic
# moved there (#951).
COPY packages/logger/package.json ./packages/logger/
COPY packages/search/package.json ./packages/search/
COPY apps/web/package.json ./apps/web/
RUN --mount=type=cache,id=wivwav-pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile

COPY packages/config ./packages/config
COPY packages/types ./packages/types
COPY packages/observability ./packages/observability
COPY packages/db ./packages/db
COPY packages/logger ./packages/logger
COPY packages/search ./packages/search
COPY apps/web ./apps/web
RUN pnpm --filter @wivwav/types build
RUN pnpm --filter @wivwav/observability build
RUN pnpm --filter @wivwav/logger build
RUN pnpm --filter @wivwav/db generate
RUN pnpm --filter @wivwav/db build
RUN pnpm --filter @wivwav/search build
RUN --mount=type=secret,id=sentry_auth_token,required=false \
  if [ -s /run/secrets/sentry_auth_token ]; then export SENTRY_AUTH_TOKEN="$(cat /run/secrets/sentry_auth_token)"; fi; \
  pnpm --filter @wivwav/web build

FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/public ./apps/web/public

USER nextjs
EXPOSE 3000
ENV PORT=3000
# Bind to all interfaces. Next.js standalone server.js uses process.env.HOSTNAME
# as its listen address; Docker sets HOSTNAME to the container id, which would
# bind only to the container's eth0 IP and break the loopback healthcheck.
ENV HOSTNAME="0.0.0.0"
CMD ["node", "apps/web/server.js"]
