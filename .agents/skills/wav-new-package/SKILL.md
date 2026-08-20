---
name: wav-new-package
description: Scaffold a new packages/* or apps/* workspace and update its Docker, Compose, and CI dependency wiring. Use when adding a WivWav workspace or a deployable service.
user-invocable: false
---

# New package/app scaffolding

`pnpm-workspace.yaml` (`apps/*`, `packages/*` globs) and `turbo.json` (`dependsOn: ["^build"]`)
pick up a new workspace automatically. **Dockerfiles do not.** Every image Dockerfile lists its
dependency closure by hand — a `COPY <pkg>/package.json` line before `pnpm install`, a
`COPY <pkg>` + `RUN pnpm --filter @wivwav/<pkg> build` line in topological order before its
consumers build. A new package that any Dockerfile-built app imports (directly or transitively)
will build and pass CI locally, then fail at `docker build` or in `docker-compose` with a missing
module, because the image never copied it in. This has bitten this project before — do not skip it.

## 1. Scaffold the workspace

- `packages/<name>` for a shared library; `apps/<name>` for a runnable service.
- `package.json` name `@wivwav/<name>`; add it as a dependency in every consumer's `package.json`.
- `tsconfig.json` extending `packages/config`'s base config.
- NodeNext local imports need `.js` extensions in `apps/api`, `apps/worker`, and NodeNext
  packages; bundler packages (`apps/web`, `apps/ops`, `packages/charts`) are extensionless —
  match whichever the new package's consumers use (see `.claude/core.md`).
- Run `pnpm install` at the repo root so the lockfile picks up the new workspace member.

## 2. Find which Dockerfiles need it

Images: `docker/api`, `docker/web`, `docker/ops`, `docker/worker`, `docker/migrate`,
`docker/dev` (`.devcontainer/Dockerfile` bind-mounts source and does not need per-package edits).

A Dockerfile needs the new package only if that image's app depends on it, directly or
transitively. Check each Dockerfile's existing `COPY packages/*/package.json` lines against the
new package's consumers — e.g. `docker/ops/Dockerfile` only copies `config`, `types`, `charts`;
`docker/migrate/Dockerfile` only copies what `@wivwav/db`'s generate/build step needs.

`docker/dev/Dockerfile` is the odd one out: it copies **every** workspace's `package.json` (kept
manually aligned with `pnpm-workspace.yaml`, per its own header comment) regardless of who
depends on whom. Always add the new package there.

## 3. Edit each affected Dockerfile, in order

Handle `docker/dev` separately: add only the new workspace's `package.json` COPY before
`pnpm install`. Do not copy its source or add a build command; source is bind-mounted at runtime
and this Dockerfile has no build stage.

For each other affected image Dockerfile:

1. Install stage — add `COPY packages/<name>/package.json ./packages/<name>/` (or
   `apps/<name>/package.json`) alongside the other manifest COPY lines, before `pnpm install`.
2. Build stage — add `COPY packages/<name> ./packages/<name>`. If the Dockerfile builds packages
   explicitly, add `RUN pnpm --filter @wivwav/<name> build` before every consumer. If it uses a
   recursive filter such as `@wivwav/worker...`, keep that pattern and let pnpm build the dependency
   closure. Do not invent a build stage in a manifest-only or migration-only image.
3. If the package needs Prisma (`packages/db`), mirror the extra
   `packages/db/prisma.config.ts` / `packages/db/prisma/schema.prisma` COPY lines already present
   in `docker/api`, `docker/web`, and `docker/migrate`.

`docker/migrate` is specialized: it installs and deploys the `@wivwav/db` dependency closure but
only copies DB source and runs Prisma generation. If a new dependency is required by that path,
mirror its filtered-install/deploy pattern; do not add an unrelated package build command.

A brand-new `apps/*` service that ships as its own container needs a new `docker/<name>/Dockerfile`
(base it on the closest existing app — `docker/api` for a Fastify-style service, `docker/worker`
for a background processor), plus:

- a service block in `docker-compose.yml` for local development;
- a service or image reference in `docker-compose.prod.yml` when it deploys with the production
  stack;
- an entry in `e2e/docker-compose.e2e.yml` only when the built-container E2E topology needs it;
- the corresponding build, size, smoke, artifact, and publish wiring in `.github/workflows/ci.yml`.

## 4. Verify

- `pnpm --filter @wivwav/<name> build` succeeds standalone.
- `pnpm typecheck && pnpm lint && pnpm build && pnpm test` (per `AGENTS.md`).
- `docker build -f docker/<affected>/Dockerfile .` for each Dockerfile you touched — this is the
  only way to actually catch a missing COPY/build line; CI checks alone won't.
- Run `docker compose -f <file> config` for every Compose file touched.

Then continue with the normal issue finish workflow.
