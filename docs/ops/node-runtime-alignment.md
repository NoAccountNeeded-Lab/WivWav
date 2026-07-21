# Node.js Runtime Alignment

Issue #809 established one executable Node.js contract across local
development, CI, containers, types, and documentation. Issue #874 advances
that contract from Node 24 to Node 26 and consolidates the overlapping
Dependabot image updates into one tested migration.

## Supported runtime

**Node 26** is the one supported major for local development, CI, Docker
builds, and production runtime.

| Surface                                                                                                                         | Previous                | Current                     |
| ------------------------------------------------------------------------------------------------------------------------------- | ----------------------- | --------------------------- |
| Root `package.json` `engines.node`                                                                                              | `>=24 <25`              | `>=26 <27`                  |
| `.npmrc` `engine-strict`                                                                                                        | `true`                  | `true` (unchanged)          |
| Preinstall guard (`scripts/check-node-version.mjs`)                                                                             | required major 24       | required major 26           |
| Host CI (`.github/workflows/ci.yml`, `actions/setup-node`)                                                                      | 24                      | 26                          |
| `.devcontainer/Dockerfile`                                                                                                      | `node:24-alpine`        | `node:26-alpine`            |
| `docker/api/Dockerfile`, `docker/web/Dockerfile`, `docker/ops/Dockerfile`, `docker/migrate/Dockerfile`, `docker/dev/Dockerfile` | `node:24-alpine`        | `node:26-alpine`            |
| `docker/scraper/Dockerfile`                                                                                                     | `node:24-bookworm-slim` | `node:26-bookworm-slim`     |
| Direct `@types/node` declarations                                                                                               | `^26.1.1`               | `^26.1.1` (already aligned) |

## Pre-LTS adoption

Node 26 remains the Current release until it enters LTS in October 2026.
Adopting it before LTS is deliberate: Dependabot proposed the image update
across every tracked Docker directory, the repository's direct dependencies
accept Node 26, and Playwright 1.61 lists Node 26 as a supported runtime.

The tradeoff is a shorter production support history and a greater chance of
ecosystem regressions before the LTS transition. Container builds, native
dependencies, browser launch, and the full repository suite therefore remain
merge gates for this upgrade.

## Fail-fast behavior

- `pnpm install` fails immediately when the active Node major does not
  satisfy `engines.node`, because `.npmrc` now sets `engine-strict=true` and
  the root `preinstall` script (`scripts/check-node-version.mjs`) independently
  checks `process.versions.node` and exits non-zero with an actionable message
  (e.g. `nvm install 26 && nvm use 26`) before pnpm links or builds any
  package (pnpm still fetches the lockfile graph first).
- This is defense in depth: `engine-strict` is pnpm's own check; the
  preinstall script is a package-manager-independent guard that also fires on
  a bare `node scripts/check-node-version.mjs`.

## Validation contract

Before merge, run installation, typecheck, lint, build, and unit tests on Node 26. Build the API and scraper images to exercise Alpine and Debian variants,
native dependencies such as Sharp, Prisma generation, and Playwright browser
installation. Run the existing scraper smoke test with the repository's
Chromium seccomp profile to verify a real sandboxed browser launch.

## Rollback

Revert issue #874 as a unit: restore `engines.node` and the guard to Node 24,
restore CI and every Docker base image to Node 24, and restore the setup and
runtime documentation. If Node 26 type definitions prove incompatible with a
Node 24 rollback, restore direct `@types/node` declarations to the latest 24.x
release and refresh `pnpm-lock.yaml` in the same change. There is no data
migration; rollback is a pure runtime/configuration revert.
