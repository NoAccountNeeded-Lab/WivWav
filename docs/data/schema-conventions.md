# Database Schema Conventions

## Data model

See `packages/types/src/listing.ts` for the complete `Listing` interface.
Mutable-field ownership and refresh semantics are defined in
[`listing-field-ownership.md`](listing-field-ownership.md).

The `GET /v1/listings/:id` response groups listing fields into three nested objects:
- `wav` — `conversionType`, `conversionManufacturer`, `floorLoweringInches`, `rampType`, `hasLift`, `handControls`, `transferSeat`, `wheelchairCapacity`
- `location` — `zip`, `city`, `state`, `lat`, `lng`
- `dealer` — `name`, `phone`, `website`

## Naming conventions

- **Table names:** singular snake_case — `listing_price_history`, `vehicle_stats`
- **Column names:** camelCase in Prisma model fields; column names in the DB match the field name exactly (camelCase) unless an explicit `@map` decorator is added
- **Enums:** singular PascalCase — `SourceStatus`, `ConversionType`

> Many existing tables use plural names (`sources`, `listings`, `scraper_runs`, `raw_pages`, `vehicle_models`, `recalls`, `complaints`, `safety_ratings`, `conversion_brands`, `conversion_products`, `nmea_dealers`). Do not rename them. All new tables must use singular names.

## Schema changes

**Never use `make db-push` for schema changes that will be deployed.** Instead:

1. Edit `packages/db/prisma/schema.prisma`
2. Run `make db-migrate-create` — Prisma generates a `.sql` file in `prisma/migrations/`
3. Commit the migration file alongside the schema change
4. CI will reject PRs where the schema and migrations are out of sync
5. On deploy, the `migrate` Docker service applies pending migrations automatically before the API starts

## Environment variables

See `.env.example` in each app directory. Never commit `.env` files.

- CI: only `GITHUB_TOKEN` (auto-provided)

AI API keys and provider selection are managed through the config DB, not env vars. Set them via `/ops/ai` or the `/admin/config` API:

| Config key | Description |
| --- | --- |
| `secret.anthropic.default` | Anthropic API key (type: secret, encrypted at rest) |
| `ai.<job>.provider` | `anthropic` or `ollama` — which provider a job uses |
| `ai.<job>.model` | Model name for that provider |
| `ai.<job>.apiKeyId` | Points to the secret config key holding the API key |

Where `<job>` is one of: `intake`, `scraper.structure`, `scraper.remap`, `agents`.
