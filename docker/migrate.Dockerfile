# syntax=docker/dockerfile:1.7
FROM node:24-alpine AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN npm install -g corepack@latest && corepack enable

# Builder: installs @wivwav/db's dependency closure using a BuildKit cache
# mount for pnpm's store, then generates the Prisma client. The pnpm store
# itself never lands in an image layer because it's a cache mount, not a
# COPY — this is what previously left ~441 MB of retained store behind.
FROM base AS builder
WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* ./
COPY scripts/check-node-version.mjs ./scripts/
COPY packages/config/package.json ./packages/config/
COPY packages/db/package.json ./packages/db/
COPY packages/db/prisma.config.ts ./packages/db/
COPY packages/db/prisma/schema.prisma ./packages/db/prisma/
RUN --mount=type=cache,id=wivwav-pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter @wivwav/db...

COPY packages/db ./packages/db
RUN pnpm --filter @wivwav/db generate

# `pnpm deploy` (without `--prod`) prunes to @wivwav/db's full dependency
# closure — production deps plus devDependencies — because the Prisma
# migration CLI (`prisma`) lives in devDependencies but is the one runtime
# tool this image actually needs to run. Everything the runner requires
# (schema, complete migration history, prisma.config.ts, the generated
# client) is copied via the package's `files` allowlist
# (dist, prisma/, prisma.config.ts); nothing else from the repo, and no
# package-local `.env` file, is retained.
FROM builder AS deploy
RUN --mount=type=cache,id=wivwav-pnpm,target=/pnpm/store \
    pnpm --filter @wivwav/db deploy --legacy /app/deploy/db

FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup -S wivwav && adduser -S wivwav -G wivwav

COPY --from=deploy --chown=wivwav:wivwav /app/deploy/db ./

USER wivwav
CMD ["node_modules/.bin/prisma", "migrate", "deploy"]
