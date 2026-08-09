FROM node:26-alpine
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
# Pin pnpm store inside the image so it's on the same filesystem as node_modules,
# enabling hard links instead of copies (avoids cross-mount slowness on startup).
ENV PNPM_STORE_DIR="/pnpm/store"
RUN apk add --no-cache git make
RUN npm install -g corepack@latest && corepack enable && echo "store-dir=/pnpm/store" >> /root/.npmrc

WORKDIR /workspace

# Copy package manifests only — source code is bind-mounted at runtime.
# Keep this list aligned with pnpm-workspace.yaml so source-only changes retain
# the dependency layer; update it whenever a workspace is added or removed.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY scripts/check-node-version.mjs scripts/
COPY apps/api/package.json apps/api/
COPY apps/ops/package.json apps/ops/
COPY apps/scraper/package.json apps/scraper/
COPY apps/web/package.json apps/web/
COPY e2e/package.json e2e/
COPY packages/agents/package.json packages/agents/
COPY packages/charts/package.json packages/charts/
COPY packages/config/package.json packages/config/
COPY packages/db/package.json packages/db/
COPY packages/design-tokens/package.json packages/design-tokens/
COPY packages/logger/package.json packages/logger/
COPY packages/observability/package.json packages/observability/
COPY packages/queue/package.json packages/queue/
COPY packages/scraper-sources/package.json packages/scraper-sources/
COPY packages/sdlc-cli/package.json packages/sdlc-cli/
COPY packages/search/package.json packages/search/
COPY packages/types/package.json packages/types/
COPY packages/ui-web/package.json packages/ui-web/
COPY spikes/852-mui-evaluation/design-tokens/package.json spikes/852-mui-evaluation/design-tokens/
COPY spikes/852-mui-evaluation/ui-web/package.json spikes/852-mui-evaluation/ui-web/
# @wivwav/db generates its Prisma client during install.
COPY packages/db/prisma/schema.prisma packages/db/prisma/schema.prisma

# BuildKit cache persists /pnpm/store across builds so subsequent installs
# only fetch what changed.
RUN --mount=type=cache,id=wivwav-pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile

CMD ["sleep", "infinity"]
