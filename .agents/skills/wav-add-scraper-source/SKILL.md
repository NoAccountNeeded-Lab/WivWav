---
name: wav-add-scraper-source
description: Add or modify a WivWav scraper source in packages/scraper-sources. Use for source registration, adapters, declarative mappings, crawl etiquette, browser extraction, fixtures, gold cases, or scraper integration tests.
user-invocable: false
---

# Add scraper source

Scraper source code lives in `packages/scraper-sources/src/sources/` (not `apps/scraper`, which was
relocated into `apps/api`/`packages/scraper-sources` and no longer exists as a package — ignore any
stale doc comment that still points there).

## 1. Register the source

Add an entry to `SCRAPER_SOURCE_REGISTRY` in `packages/types/src/source-registry.ts`: `key`
(unique, used to key the adapter map below), `name`, `baseUrl`, `cronExpression`, `timezone`, and
`pipeline` (`'scrape-only'` for a list-only source, `'detail-pages'` if each listing has its own
page to crawl).

## 2. Choose custom adapter vs. declarative detail extraction

Two ways to extract detail-page fields:

- **Custom adapter** (e.g. `blvd.ts`, `mobilityworks.ts`): full control, needed when extraction
  logic can't be expressed as CSS-selector + transform pairs.
- **Declarative** (`declarative-detail.ts` + a `FieldMapping[]` module, e.g.
  `freedom-motors-detail-mappings.ts`): driven by `Source.mappings` in the DB — selector,
  attribute, transform per target field. Prefer this when the target site's fields are simple,
  stable selectors; it avoids writing and testing a bespoke parser.

## 3. Implement `SourceAdapter`

`packages/scraper-sources/src/engine/source-adapter.ts` requires:

```ts
readonly sourceId: string
readonly name: string
checkStructure(): Promise<StructureCheckResult>  // hash-based change detection
scrape(context?: JobContext): Promise<ScrapeResult>
checkPage1?(): Promise<Page1CheckResult>  // optional: skip full crawl if page 1 is unchanged
```

Export a `createSourceAdapter(previousHash, config): SourceAdapter` factory matching
`SourceAdapterModule` (`sources/factory.ts`), then add it to the static
`SOURCE_ADAPTER_MODULES` map in `sources/adapters.ts`, keyed by the same registry `key`. This map
is static (not a dynamic `import()`) because a relative dynamic import can't cross the package
boundary and the static form is bundler-friendly — don't revert to dynamic import.

## 4. Crawl etiquette — required, not optional

- Check `RobotsCache.isAllowed(url, userAgent)` (`util/robots-cache.ts`) before fetching; a
  missing/malformed `robots.txt` is treated as permissive, but an existing disallow must be
  honored.
- Use `jitteredSleep(ms)` (`util/jitter-sleep.ts`) between requests, not a fixed delay — a
  constant interval is a bot fingerprint. Default jitter is ±20%.

## 5. Browser sandbox safety

Inside any `page.evaluate`, use `function` declarations, not named arrow-function-to-const
assignments — Playwright's evaluated context lacks esbuild's injected `__name`, so arrow-to-const
throws there even though it works everywhere else in the codebase.

## 6. AI structure-remap confidence

`.claude/instructions.md` documents a `>= 0.7` confidence floor for applying an AI-proposed
structure remap. Verify where this gate is actually enforced for the pipeline you're touching
(`apps/api/src/ai/structure-detector.ts` generates the remap; confirm its caller applies the
threshold) before relying on the number — this is exactly the kind of runtime-configurable value
this repo has moved out of hardcoded constants and into DB-backed config elsewhere
(`docs/data/schema-conventions.md`'s AI provider/model config table).

## 7. Test at the applicable tiers

- **Unit parser tests**: cover normalization, malformed or missing fields, duplicates, pagination,
  and accessibility-critical fields.
- **Fixtures** (`sources/fixtures/`): keep captured HTML/JSON local and deterministic.
- **Structural contract** (`fixture-contract.test.ts`): currently covers BLVD and MobilityWorks,
  not every registered source. Extend its `SourceId`, imports, fixtures, and manifest when the new
  source uses the same list/detail facet contract; do not claim coverage until it is included.
- **Gold regression** (`fixtures/gold/*.gold.json` + `*.gold.test.ts`): currently covers BLVD and
  MobilityWorks. Add manually verified cases when enrolling a source in the gold corpus. Preserve
  exact matching for expected keys and the explicit 100% aggregate gate for critical fields. Do
  not claim an optional-field percentage unless the test implementation actually computes it.
- **Integration** (`*.integration.test.ts`): inspect the test before running it. Existing scraper
  integration tests may contact real target sites; they are not universally offline and are not
  included in the root `pnpm test:integration` command.

Run offline checks first:

```bash
pnpm --filter @wivwav/scraper-sources test
pnpm --filter @wivwav/scraper-sources test:fixtures
```

Run `pnpm --filter @wivwav/scraper-sources test:integration` only when live-network access is
expected and authorized. Record which targets were contacted and any skipped live checks.
