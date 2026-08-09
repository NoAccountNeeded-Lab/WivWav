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
COPY packages/observability/package.json ./packages/observability/
COPY packages/db/package.json ./packages/db/
COPY packages/db/prisma.config.ts ./packages/db/
COPY packages/db/prisma/schema.prisma ./packages/db/prisma/
COPY packages/logger/package.json ./packages/logger/
COPY packages/queue/package.json ./packages/queue/
COPY packages/search/package.json ./packages/search/
COPY apps/api/package.json ./apps/api/
RUN --mount=type=cache,id=wivwav-pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile

COPY packages/config ./packages/config
COPY packages/types ./packages/types
COPY packages/observability ./packages/observability
COPY packages/db ./packages/db
COPY packages/logger ./packages/logger
COPY packages/queue ./packages/queue
COPY packages/search ./packages/search
COPY apps/api ./apps/api
RUN pnpm --filter @wivwav/types build
RUN pnpm --filter @wivwav/observability build
RUN pnpm --filter @wivwav/logger build
RUN pnpm --filter @wivwav/db generate
RUN pnpm --filter @wivwav/db build
RUN pnpm --filter @wivwav/queue build
RUN pnpm --filter @wivwav/search build
RUN pnpm --filter @wivwav/api build

# `pnpm deploy` resolves @wivwav/api's production dependency closure only —
# the runtime workspace packages it needs (each pruned to its own `files`
# allowlist, e.g. just `dist`) plus their third-party production deps. No
# TypeScript, Vitest, ESLint, Prettier, Turbo, tsx, or root devDependencies
# make it into the deployed tree. `--no-optional` additionally drops the
# `prisma` CLI and `typescript`, which @prisma/client lists as *optional*
# peer dependencies — the API only needs the already-generated client, never
# the CLI that generated it. `--ignore-scripts` is safe here: the Prisma
# client and every workspace package's `dist` were already built above, and
# this step only re-links already-built artifacts into a pruned tree.
FROM builder AS deploy
RUN --mount=type=cache,id=wivwav-pnpm,target=/pnpm/store \
    pnpm --filter @wivwav/api deploy --prod --no-optional --ignore-scripts --legacy /app/deploy/api

FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup -S wivwav && adduser -S wivwav -G wivwav

COPY --from=deploy --chown=wivwav:wivwav /app/deploy/api ./

USER wivwav
EXPOSE 3001
CMD ["node", "dist/index.js"]
