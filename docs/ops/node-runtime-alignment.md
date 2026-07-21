# Node.js Runtime Alignment

Fixes #809: the repository previously advertised incompatible Node.js
contracts across environments — package.json accepted `>=20`, host CI and
setup docs used Node 24, production Dockerfiles built on Node 26, and
`@types/node` compiled against Node 26 types. This document records the
single supported runtime and the upgrade/rollback path.

## Supported runtime

**Node 24** (the current Active LTS line) is the one supported major for
local development, CI, Docker builds, and production runtime.

| Surface | Previous | Current |
| --- | --- | --- |
| Root `package.json` `engines.node` | `>=20` (unbounded, unenforced) | `>=24 <25` |
| `.npmrc` `engine-strict` | unset (mismatches only warned) | `true` |
| Preinstall guard (`scripts/check-node-version.mjs`) | none | fails fast with a clear message when `process.versions.node` major does not match `engines.node` |
| Host CI (`.github/workflows/ci.yml`, `actions/setup-node`) | 24 | 24 (unchanged) |
| `.devcontainer/Dockerfile` | `node:24-alpine` | `node:24-alpine` (unchanged) |
| `docker/api.Dockerfile`, `docker/web.Dockerfile`, `docker/ops.Dockerfile`, `docker/migrate.Dockerfile`, `docker/dev.Dockerfile` | `node:26-alpine` | `node:24-alpine` |
| `docker/scraper.Dockerfile` | `node:26-bookworm-slim` | `node:24-bookworm-slim` |
| `@types/node` (all workspace packages) | `^26.1.0` | `^24.13.3` |

Node 26 was still a "Current" (pre-LTS) release when the production
Dockerfiles pinned it; running unreleased-LTS Node in production was the root
mismatch this issue closes. Node 24 is already what CI, the devcontainer, and
the setup docs (`README.md`, `docs/ops/quick-start.md`) documented, so those
files did not need to change.

## Fail-fast behavior

- `pnpm install` fails immediately when the active Node major does not
  satisfy `engines.node`, because `.npmrc` now sets `engine-strict=true` and
  the root `preinstall` script (`scripts/check-node-version.mjs`) independently
  checks `process.versions.node` and exits non-zero with an actionable message
  (e.g. `nvm install 24 && nvm use 24`) before any dependency resolution runs.
- This is defense in depth: `engine-strict` is pnpm's own check; the
  preinstall script is a package-manager-independent guard that also fires on
  a bare `node scripts/check-node-version.mjs`.

## Verification performed

- `pnpm typecheck`, `pnpm lint`, `pnpm build`, and `pnpm test` all pass on
  Node 24.15.0.
- `docker build -f docker/scraper.Dockerfile .` succeeds on Node 24; `sharp`
  rebuilds natively for the image's glibc/arch, and Playwright's Chromium
  headless shell installs and launches (verified with the existing
  `docker/scraper-smoke.mjs` smoke script under the same sandboxed
  `--security-opt seccomp=./docker/chromium-seccomp.json` invocation CI uses).
- `docker build -f docker/api.Dockerfile .` succeeds and reports
  `node v24.18.0` (the Debian-slim/Alpine base's patch version) at runtime.

## Rollback

Revert this change set (`.npmrc`, `package.json`, `docker/*.Dockerfile`,
`scripts/check-node-version.mjs`, the per-package `@types/node` bumps, and
`pnpm-lock.yaml`) as a single unit — the Docker base images, `@types/node`
major, and `engines.node` range must move together, or the same
development/CI/production mismatch this issue fixes will reappear. There is
no data migration involved; rollback is a pure dependency/image revert.
