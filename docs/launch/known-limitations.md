# Known limitations for public beta

## For beta users

- Search visibility is narrower than raw observed inventory: listings must be active, eligible, and from an enabled source; pending, quarantined, gone, or manually hidden listings are not public (`docs/pipeline-stage-semantics.md`).
- Map coverage is incomplete until geocoding runs. Listings missing either city or state are unsupported, and listings with both but no coordinates remain waiting (`docs/pipeline-stage-semantics.md`).
- Detail and validation can lag after a card change: a changed identity, conversion, or color field sets `detailStaleAt` and holds publication until fresh detail extraction and validation complete (`docs/pipeline-stage-semantics.md`).
- VIN enrichment is required only when a VIN exists; no-VIN listings are exempt, while an undecoded VIN stays open unless a terminal decode failure is recorded (`docs/pipeline-stage-semantics.md`, decision 4) (`docs/pipeline-stage-semantics.md`).
- Safety coverage is source-backed and model-keyed. NHTSA manufacturer communications are TSBs; separate NHTSA FMCS coverage is not implemented (`docs/nhtsa-epa-source-coverage.md`).
- EPA EV/PHEV MPGe, electric range, emissions, fuel-cost, and greenhouse-gas fields are not ingested today (`docs/nhtsa-epa-source-coverage.md`).
- WivWav does not compute reliability, dependability, or purchase-quality scores; displayed vehicle facts must remain traceable to a source URL or source name (`docs/nhtsa-epa-source-coverage.md`, `docs/data/vehicle-stats-sources.md`).
- Private-seller descriptions remain returned and searchable pending counsel/product review; ZIP exposure is also deferred. Private-seller images are retained with a future review noted (`docs/risk/private-seller-data-policy.md`).

## For operators

- Geocoding is rate-limited to one Nominatim request per second and deduplicated by city/state; large refreshes therefore take time (`docs/ops/workflows.md`).
- The listing-sync operation is a full versioned rebuild and should be triggered manually only when the publication-containment runbook permits it (`docs/api-routes.md`, `docs/ops/workflows.md`).
- Geocode, deduplication, and indexing do not change `publicationStatus`; operators must distinguish eligibility from visibility and readiness (`docs/pipeline-stage-semantics.md`).
- Deduplication and dealer enrichment are currently not reliable readiness markers: deduplication is unobservable and the dealer-enrichment column is documented as never populated (`docs/pipeline-stage-semantics.md`).
- Image semantic analysis is manual-only and has no schedule, so its state is unobservable until scheduled (`docs/pipeline-stage-semantics.md`).
- The 90-day safety freshness threshold is a display threshold, not a refresh limit. On-demand NHTSA refresh is rate-limited to once per model per hour (`docs/nhtsa-epa-source-coverage.md`, `docs/api-routes.md`). NHTSA calls are throttled at 300 ms between requests (`docs/nhtsa-epa-source-coverage.md`).
- A Valkey loss can discard in-flight BullMQ work and degrade one throughput cycle, although schedules and operator intent are reconstructed from PostgreSQL on restart (`docs/data/valkey-state-audit.md`).
- Application-image rollback does not reverse migrations. Operators must not roll back past destructive schema changes without a restore and data reconciliation (`docs/ops/deployment.md`).
- Sentry is disabled by default; logs and metrics flow through stdout, Alloy, Loki, and Prometheus, and `/metrics` must remain network-isolated (`docs/ops/error-monitoring.md`, `docs/api-routes.md`).
- eBay Motors is seeded disabled, requires environment-specific operator configuration before enablement, and each unique discovered item requires a detail call; quota and retention terms remain operational/legal concerns (`docs/ops/deployment.md`, `docs/risk/private-seller-data-policy.md`).
