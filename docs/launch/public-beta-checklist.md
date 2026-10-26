# Public beta launch checklist

## Pre-launch

- [ ] [H] Apply the production migration using `pnpm db:migrate` (`package.json`).
- [ ] Seed local fixtures only where needed for rehearsal with `make db-seed` (`Makefile`). No production-seed command was found in the reviewed docs; TODO(verify): confirm the production beta-data seeding procedure.
- [ ] [H] In `/ops/sources`, confirm the intended sources are enabled and use **Run Now** to scrape them (`docs/ops/workflows.md`).
- [ ] [H] In `/ops/queues`, run `detail-crawl` and then `detail-extract` where needed; these queues are triggerable from the page (`docs/ops/workflows.md`).
- [ ] [H] In `/ops/queues`, trigger `geocode` and wait for city/state listings to receive coordinates (`docs/ops/workflows.md`).
- [ ] [H] In `/ops/queues`, use **Sync Meilisearch** only after the publication-containment runbook permits publication (`docs/ops/workflows.md`).
- [ ] [H] Verify data freshness against live data. (Required human check; the repository does not prove live freshness.)
- [ ] [H] Verify provenance and source attribution against live data. (Required human check.)
- [ ] [H] Verify non-advice disclaimers against live data and the rendered beta experience. (Required human check.)

## Launch

- [ ] Search: open `/{locale}/discover` or `/{locale}/results` and verify a representative query; API contract is `GET /v1/listings` (`apps/web/src/app/[locale]/discover/page.tsx`, `apps/web/src/app/[locale]/results/page.tsx`, `docs/api-routes.md`).
- [ ] Listing detail: open `/{locale}/vehicle/{id}` and verify the detail loads; API contract is `GET /v1/listings/:id` (`apps/web/src/lib/vehicle-url.ts`, `apps/web/src/app/[locale]/vehicle/[id]/page.tsx`, `docs/api-routes.md`).
- [ ] Map pins: verify listings with coordinates appear on the search map after sync; the documented prerequisite is geocode followed by Meilisearch sync (`docs/ops/workflows.md`).
- [ ] Safety data: verify the detail safety view and `GET /v1/listings/:id/safety`; the on-demand refresh is `POST /v1/listings/:id/refresh-safety` (`docs/api-routes.md`).
- [ ] Ops queues: open `/ops/queues` and confirm queue health and activity (`apps/ops/src/app/ops/queues/page.tsx`, `docs/ops/workflows.md`).
- [ ] Sources: open `/ops/sources` and verify source status and a run action (`apps/ops/src/app/ops/sources/page.tsx`, `docs/ops/workflows.md`).
- [ ] Runs: open `/ops/runs` and verify the launch scrape appears (`apps/ops/src/app/ops/runs/page.tsx`, `docs/api-routes.md`).
- [ ] Schedules: open `/ops/schedules` and verify enabled schedules and next-run times (`apps/ops/src/app/ops/schedules/page.tsx`, `docs/ops/workflows.md`).
- [ ] Config: open `/ops/config` and verify required operator-managed configuration is present (`apps/ops/src/app/ops/config/page.tsx`, `docs/ops/deployment.md`).
- [ ] Basic logging: open `/ops/logs` and verify recent API/scraper activity; the observability stack uses stdout → Alloy → Loki/Prometheus (`apps/ops/src/app/ops/logs/page.tsx`, `docs/ops/quick-start.md`, `docs/ops/error-monitoring.md`).

## Post-launch

- [ ] [H] Recheck `/ops`, `/ops/runs`, `/ops/queues`, `/ops/sources`, and `/ops/readiness` after the first scheduled cycle (`apps/ops/src/app/ops/page.tsx`, `apps/ops/src/app/ops/runs/page.tsx`, `apps/ops/src/app/ops/queues/page.tsx`, `apps/ops/src/app/ops/sources/page.tsx`, `apps/ops/src/app/ops/readiness/page.tsx`).
- [ ] [H] Confirm the public search index contains only active, eligible listings from enabled sources without a manual hide after the first full sync (`docs/pipeline-stage-semantics.md`, `docs/ops/workflows.md`).
- [ ] [H] Review safety freshness and failed enrichment jobs; schedules and safety queues are documented in `docs/ops/workflows.md` and `docs/nhtsa-epa-source-coverage.md`.

## Rollback and Post-release monitoring

- [ ] Roll back application images by downloading the earlier `deploy-<commit-sha>` release manifest and repeating the documented compose validation/pull/up commands (`docs/ops/deployment.md`). This is app-image rollback only and does not reverse migrations.
- [ ] Disable an affected source from `/ops/sources`; this durably prevents its scrape/detail jobs and removes its listings from public search on the next rebuild (`docs/ops/workflows.md`).
- [ ] Disable affected repeatable jobs from `/ops/schedules`; operator intent is persisted and re-applied after restart (`docs/ops/workflows.md`).
- [ ] TODO(verify): confirm whether a single beta-wide public-visibility switch exists. No beta-wide switch was found in the reviewed code or docs; no switch found, needs design.
- [ ] Inspect `/ops/logs`, `/ops/problems`, `/ops/queues`, `/ops/runs`, `/ops/readiness`, and Grafana's WivWav Logs/System dashboards (`apps/ops/src/app/ops/logs/page.tsx`, `apps/ops/src/app/ops/problems/page.tsx`, `apps/ops/src/app/ops/queues/page.tsx`, `apps/ops/src/app/ops/runs/page.tsx`, `apps/ops/src/app/ops/readiness/page.tsx`, `docs/ops/quick-start.md`).
- [ ] Inspect `/metrics` through the internal observability network for request, queue, database, search, scrape, and NHTSA recency metrics; do not expose it publicly (`docs/api-routes.md`).
- [ ] If enabled, inspect Sentry's WivWav organization dashboard; Sentry is inert unless `SENTRY_ENABLED=true` and a DSN are present (`docs/ops/error-monitoring.md`).
