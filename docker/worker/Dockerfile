# syntax=docker/dockerfile:1

# Playwright supports Debian/glibc, not Alpine/musl. Keep every stage on the
# same runtime family so native packages are built for the final image's
# libc and architecture.
FROM node:26-bookworm-slim AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN npm install -g corepack@latest && corepack enable

FROM base AS builder
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
WORKDIR /app
# apps/worker deliberately has no @wivwav/db, @wivwav/queue, or @wivwav/search
# dependency — it must never gain one. Only copy the package.jsons of the
# workspace packages it actually depends on (see apps/worker/package.json):
# @wivwav/config, @wivwav/types, @wivwav/logger, @wivwav/scraper-sources.
# @wivwav/scraper-sources itself depends on @wivwav/queue (for the JobContext
# *type* only — see apps/worker/src/engine/scraper-engine.ts's docstring) and
# @wivwav/logger, so those are copied too; @wivwav/db never appears below.
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* ./
COPY scripts/check-node-version.mjs ./scripts/
COPY packages/config/package.json ./packages/config/
COPY packages/types/package.json ./packages/types/
COPY packages/logger/package.json ./packages/logger/
COPY packages/queue/package.json ./packages/queue/
COPY packages/scraper-sources/package.json ./packages/scraper-sources/
COPY apps/worker/package.json ./apps/worker/
RUN --mount=type=cache,id=wivwav-pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile

COPY packages/config ./packages/config
COPY packages/types ./packages/types
COPY packages/logger ./packages/logger
COPY packages/queue ./packages/queue
COPY packages/scraper-sources ./packages/scraper-sources
COPY apps/worker ./apps/worker
RUN pnpm --filter @wivwav/worker... run build

# Materialize a portable production-only app.
RUN pnpm --config.inject-workspace-packages=true \
      --filter @wivwav/worker \
      --prod \
      --ignore-scripts \
      deploy /prod/worker \
    && find /prod/worker/node_modules -xtype l -delete \
    && ! find /prod/worker/node_modules/.pnpm -maxdepth 1 -type d \
      \( -name 'typescript@*' -o -name 'vitest@*' -o -name 'eslint@*' \
         -o -name 'prettier@*' -o -name 'turbo@*' -o -name 'prisma@*' \
         -o -name '@prisma+client@*' \) | grep -q .

FROM base AS runner
ENV NODE_ENV=production
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
ENV HOME=/home/worker
WORKDIR /app

RUN groupadd --gid 10001 worker \
    && useradd --uid 10001 --gid 10001 --create-home --shell /usr/sbin/nologin worker

COPY --from=builder --chown=worker:worker /prod/worker ./

# Headless-shell-only footprint — no Firefox, WebKit, or full Chromium.
RUN ./node_modules/.bin/playwright install --with-deps --only-shell chromium \
    && rm -rf /var/lib/apt/lists/* \
    && chown -R worker:worker /ms-playwright

USER worker
CMD ["node", "dist/index.js"]
