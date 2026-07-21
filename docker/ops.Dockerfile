# syntax=docker/dockerfile:1.7
FROM node:26-alpine AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN npm install -g corepack@latest && corepack enable

FROM base AS builder
WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* ./
COPY scripts/check-node-version.mjs ./scripts/
COPY packages/config/package.json ./packages/config/
COPY packages/types/package.json ./packages/types/
COPY packages/charts/package.json ./packages/charts/
COPY apps/ops/package.json ./apps/ops/
RUN --mount=type=cache,id=wivwav-pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile

COPY packages/config ./packages/config
COPY packages/types ./packages/types
COPY packages/charts ./packages/charts
COPY apps/ops ./apps/ops
RUN pnpm --filter @wivwav/types build
RUN pnpm --filter @wivwav/charts build
RUN pnpm --filter @wivwav/ops build

FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

COPY --from=builder --chown=nextjs:nodejs /app/apps/ops/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/apps/ops/.next/static ./apps/ops/.next/static

USER nextjs
EXPOSE 3002
ENV PORT=3002
# Bind to all interfaces. Next.js standalone server.js uses process.env.HOSTNAME
# as its listen address; Docker sets HOSTNAME to the container id, which would
# bind only to the container's eth0 IP and break the loopback healthcheck.
ENV HOSTNAME="0.0.0.0"
CMD ["node", "apps/ops/server.js"]
