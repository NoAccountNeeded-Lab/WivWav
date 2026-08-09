# syntax=docker/dockerfile:1

# Playwright supports Debian/glibc, not Alpine/musl. Keep every stage on the
# same runtime family so native packages such as sharp are built for the final
# image's libc and architecture.
FROM node:26-bookworm-slim AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN npm install -g corepack@latest && corepack enable

FROM base AS builder
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
WORKDIR /app
RUN apt-get update \
    && apt-get install --yes --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*
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
COPY packages/agents/package.json ./packages/agents/
COPY packages/scraper-sources/package.json ./packages/scraper-sources/
COPY apps/scraper/package.json ./apps/scraper/
RUN --mount=type=cache,id=wivwav-pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile

COPY packages/config ./packages/config
COPY packages/types ./packages/types
COPY packages/observability ./packages/observability
COPY packages/db ./packages/db
COPY packages/logger ./packages/logger
COPY packages/queue ./packages/queue
COPY packages/search ./packages/search
COPY packages/agents ./packages/agents
COPY packages/scraper-sources ./packages/scraper-sources
COPY apps/scraper ./apps/scraper
RUN pnpm --filter @wivwav/db generate \
    && pnpm --filter @wivwav/scraper... run build

# Materialize a portable production-only app. Build scripts already ran in the
# glibc builder, so the deploy step must not rerun workspace postinstall hooks.
# Prisma exposes TypeScript and its CLI as optional peers; remove those build
# tools after deploy because the generated client is already in @wivwav/db/dist.
RUN pnpm --config.inject-workspace-packages=true \
      --filter @wivwav/scraper \
      --prod \
      --ignore-scripts \
      deploy /prod/scraper \
    && find /prod/scraper/node_modules/.pnpm -maxdepth 1 -type d \
      \( -name 'typescript@*' -o -name 'prisma@*' \) -exec rm -rf '{}' + \
    && find /prod/scraper/node_modules -xtype l -delete \
    && ! find /prod/scraper/node_modules/.pnpm -maxdepth 1 -type d \
      \( -name 'typescript@*' -o -name 'vitest@*' -o -name 'eslint@*' \
         -o -name 'prettier@*' -o -name 'turbo@*' \) | grep -q . \
    && cd /prod/scraper \
    && node -e "const sharp = require('sharp'); console.log('sharp', sharp.versions.sharp)"

FROM base AS runner
ENV NODE_ENV=production
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
ENV HOME=/home/scraper
WORKDIR /app

RUN groupadd --gid 10001 scraper \
    && useradd --uid 10001 --gid 10001 --create-home --shell /usr/sbin/nologin scraper

COPY --from=builder --chown=scraper:scraper /prod/scraper ./

# The scraper launches Playwright's default headless mode without a channel, so
# only Chromium headless shell is required. Firefox, WebKit, and full Chromium
# are intentionally not installed.
RUN ./node_modules/.bin/playwright install --with-deps --only-shell chromium \
    && rm -rf /var/lib/apt/lists/* \
    && chown -R scraper:scraper /ms-playwright

COPY --chown=scraper:scraper docker/scraper-smoke.mjs ./smoke.mjs

USER scraper
CMD ["node", "dist/index.js"]
