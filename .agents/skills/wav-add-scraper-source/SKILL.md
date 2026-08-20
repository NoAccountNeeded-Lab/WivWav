---
description: Add or modify a scraper source in packages/scraper-sources — registration, SourceAdapter contract, crawl etiquette, and the fixture/gold-test tiers
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

## 7. Tests — four tiers, not just unit tests

- **Fixtures** (`sources/fixtures/`): raw captured HTML/JSON inputs.
- **Structural contract** (`fixture-contract.test.ts`): cross-source shape check — every source's
  parser output conforms to the same facet shape.
- **Gold regression** (`fixtures/gold/*.gold.json` + `*.gold.test.ts`): manually verified
  expected output, checked with field-level precision/recall gates. Accessibility-critical fields
  (`conversionType`, `rampType`, `wavFeatures`, `floorLoweringInches`, `vin`) must match 100% across
  gold cases; optional/frequently-absent fields (`color`, dealer fields) only need ≥80%. Add gold
  cases for the new source rather than skipping this tier — it's what catches silent extraction
  regressions.
- **Integration** (`*.integration.test.ts`): exercises the real parse path without live network
  calls, per existing sources' pattern.
