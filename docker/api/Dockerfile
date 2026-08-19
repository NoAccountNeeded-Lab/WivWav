# syntax=docker/dockerfile:1.7
# node:26-alpine (musl libc) is kept here, unlike docker/scraper/Dockerfile's
# Debian/glibc base — sharp (added in #969 for the relocated image-analysis
# jobs) ships prebuilt musl-x64 binaries via its optionalDependencies, so no
# base-image change is needed. The deploy stage below must not pass
# `--no-optional` to `pnpm deploy`, or those platform-specific binaries would
# be pruned along with the CLI-only optional deps it's meant to strip; see
# the sharp smoke-test at the end of that stage.
FROM node:26-alpine AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN npm install -g corepack@latest && corepack enable

FROM base AS builder
# apps/api's test suite imports @wivwav/scraper-sources (a devDependency, see
# apps/api/package.json) to cross-check a seeded field mapping against that
# package's canonical constant (#968). tsc compiles test files into dist
# alongside production code (same as every other *.test.ts here), so the
# builder stage still needs scraper-sources' types even though the deploy
# stage below never ships it. Skip the browser download for this
# devDependency-only need — apps/api never runs Playwright.
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
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
COPY packages/agents/package.json ./packages/agents/
COPY packages/scraper-sources/package.json ./packages/scraper-sources/
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
COPY packages/agents ./packages/agents
COPY packages/scraper-sources ./packages/scraper-sources
COPY apps/api ./apps/api
RUN pnpm --filter @wivwav/types build
RUN pnpm --filter @wivwav/observability build
RUN pnpm --filter @wivwav/logger build
RUN pnpm --filter @wivwav/db generate
RUN pnpm --filter @wivwav/db build
RUN pnpm --filter @wivwav/queue build
RUN pnpm --filter @wivwav/search build
RUN pnpm --filter @wivwav/agents build
RUN pnpm --filter @wivwav/scraper-sources build
RUN pnpm --filter @wivwav/api build

# `pnpm deploy` resolves @wivwav/api's production dependency closure only —
# the runtime workspace packages it needs (each pruned to its own `files`
# allowlist, e.g. just `dist`) plus their third-party production deps. No
# TypeScript, Vitest, ESLint, Prettier, Turbo, tsx, or root devDependencies
# make it into the deployed tree. `--ignore-scripts` is safe here: the Prisma
# client and every workspace package's `dist` were already built above, and
# this step only re-links already-built artifacts into a pruned tree.
#
# Unlike before #969, this no longer passes `--no-optional`: sharp (added for
# the relocated image-analysis jobs) resolves its native binary through an
# optionalDependency (e.g. `@img/sharp-linuxmusl-x64` on this alpine base),
# and `--no-optional` would prune that along with everything else optional.
# `@prisma/client`'s `prisma`/`typescript` optional peer deps — the actual
# thing `--no-optional` used to target — are instead stripped explicitly
# below, mirroring docker/scraper/Dockerfile's equivalent step (which has
# carried sharp the same way since before #969).
FROM builder AS deploy
RUN --mount=type=cache,id=wivwav-pnpm,target=/pnpm/store \
    pnpm --filter @wivwav/api deploy --prod --ignore-scripts --legacy /app/deploy/api \
    && find /app/deploy/api/node_modules/.pnpm -maxdepth 1 -type d \
      \( -name 'typescript@*' -o -name 'prisma@*' \) -exec rm -rf '{}' + \
    && find /app/deploy/api/node_modules -xtype l -delete \
    && ! find /app/deploy/api/node_modules/.pnpm -maxdepth 1 -type d \
      \( -name 'typescript@*' -o -name 'vitest@*' -o -name 'eslint@*' \
         -o -name 'prettier@*' -o -name 'turbo@*' \) | grep -q . \
    && cd /app/deploy/api \
    && node -e "const sharp = require('sharp'); console.log('sharp', sharp.versions.sharp)"

FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup -S wivwav && adduser -S wivwav -G wivwav

COPY --from=deploy --chown=wivwav:wivwav /app/deploy/api ./

USER wivwav
EXPOSE 3001
CMD ["node", "dist/index.js"]
