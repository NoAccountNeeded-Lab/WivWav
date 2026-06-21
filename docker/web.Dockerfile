# syntax=docker/dockerfile:1.7
FROM node:24-alpine AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

FROM base AS builder
WORKDIR /app
ARG NEXT_PUBLIC_SENTRY_DSN
ARG SENTRY_DSN
ARG NEXT_PUBLIC_SENTRY_ENABLED
ARG SENTRY_ENABLED
ARG SENTRY_ORG
ARG SENTRY_PROJECT
ENV NEXT_PUBLIC_SENTRY_DSN=$NEXT_PUBLIC_SENTRY_DSN
ENV SENTRY_DSN=$SENTRY_DSN
ENV NEXT_PUBLIC_SENTRY_ENABLED=$NEXT_PUBLIC_SENTRY_ENABLED
ENV SENTRY_ENABLED=$SENTRY_ENABLED
ENV SENTRY_ORG=$SENTRY_ORG
ENV SENTRY_PROJECT=$SENTRY_PROJECT
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* ./
COPY packages/config/package.json ./packages/config/
COPY packages/types/package.json ./packages/types/
COPY packages/observability/package.json ./packages/observability/
COPY apps/web/package.json ./apps/web/
RUN pnpm install --frozen-lockfile

COPY packages/config ./packages/config
COPY packages/types ./packages/types
COPY packages/observability ./packages/observability
COPY apps/web ./apps/web
RUN pnpm --filter @wivwav/types build
RUN pnpm --filter @wivwav/observability build
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

USER nextjs
EXPOSE 3000
ENV PORT=3000
CMD ["node", "apps/web/server.js"]
