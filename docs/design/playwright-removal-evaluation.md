# Playwright removal evaluation

Issue: #1022
Date: 2026-09-19

## Summary

Do not remove Playwright from the worker yet. The current worker still needs a
browser for `detail-crawl`, `detail-extract`, and three source adapters. The
best near-term direction is partial fallback retention: make browser creation
lazy/capability-gated, keep a browser-capable worker image for the jobs that
still require it, and allow a lighter HTTP-only worker lane for enrichment and
browserless scrape-only sources.

The `make worker` failure should be fixed before the migration. It is a
packaging bug, not proof that the browser dependency is unused.

## Current worker boundary

`apps/worker/src/index.ts` imports and instantiates
`PlaywrightBrowserService` at process startup, then passes the shared service
to:

- `source-scrape`
- `detail-crawl`
- `detail-extract`

The nine enrichment handlers registered below those three are HTTP-only. They
do not need Chromium, but they still run in a process that imports and creates
the Playwright-backed service today.

## Source inventory

| Source | Registry pipeline | Source scrape browser need | Detail browser need | Classification |
| --- | --- | --- | --- | --- |
| BLVD.com | `detail-pages` | Required today. `blvd.ts` uses `BrowserService`, `page.goto`, `waitForSelector`, and `page.evaluate` for page-1 checks, structure checks, and listing cards. | Required today. `detail-crawl` fetches raw pages with a browser; `detail-extract` uses `evaluateBlvdDetail`, `evaluateSourceListingDates`, and browser-backed DOM evaluation. | Browser-required. Candidate for Cheerio migration, but needs both list and detail parser parity. |
| MobilityWorks | `detail-pages` | Browserless today for production list scraping. `mobilityworks.ts` uses `DefaultCrawleeHtmlFetcher` and Cheerio extraction; the old `browserService` config is deprecated. | Required today through the shared detail pipeline. `detail-crawl` still uses a browser, and `detail-extract` uses `evaluateMwDetail` plus source-date DOM evaluation inside a Playwright page. | Mixed. Source scrape is migrated; detail stages still block full removal. |
| Freedom Motors | `detail-pages` | Required today. `freedom-motors.ts` uses `BrowserService`, navigation, selectors, and `page.evaluate` for list extraction. | Required today through `detail-crawl` and declarative `detail-extract`. Detail mappings are selector/XPath based, but currently evaluated inside a browser page. | Browser-required. Likely migrateable to static HTML parsing because the source appears server-rendered. |
| Superior Van & Mobility | `detail-pages` | Required today. `superior-van.ts` uses `BrowserService`, navigation, selectors, and `page.evaluate`. | Required today through `detail-crawl` and declarative `detail-extract`. Detail mappings are selector/XPath based, but currently evaluated inside a browser page. | Browser-required. Likely migrateable to static HTML parsing if FacetWP/list pages remain server-rendered. |
| AMS Vans Mobility Classifieds | `scrape-only` | Browserless today. The adapter uses sitemap discovery, `fetch`, robots checks, and server-rendered `__NEXT_DATA__` parsing. | Not applicable. It is `scrape-only`; no separate detail-crawl/detail-extract queue is used. | Browserless-ready. |
| MobilityVanSales | `scrape-only` | Browserless today. The adapter uses Node HTTP/HTTPS fetching, robots checks, and HTML parsing. | Not applicable. It is `scrape-only`; no separate detail-crawl/detail-extract queue is used. | Browserless-ready, subject to the existing legal/product note in the adapter comments. |

## Worker path inventory

| Path | Browser dependency | Removal notes |
| --- | --- | --- |
| `apps/worker/src/index.ts` | Eager `new PlaywrightBrowserService()` at startup. | First simplification target. Make this lazy or capability-gated so HTTP-only workers do not import/create Chromium. |
| `apps/worker/src/handlers/source-scrape.ts` | Always receives a Playwright service and injects it into every adapter, even browserless adapters. | Change the handler contract to inject browser service only when the selected source needs it, or let adapters own lazy creation until source capabilities exist. |
| `apps/worker/src/handlers/detail-crawl.ts` | Always launches a browser and calls `page.goto`, `page.content`, and `page.url`. | Needs an HTML-fetcher implementation before browser removal. It must preserve status handling, off-domain redirect detection, final URL behavior, timeouts, robots posture, and rate limiting. |
| `apps/worker/src/handlers/detail-extract.ts` | Always launches a browser and uses `page.setContent`; parser entry points consume `BrowserPage`. | Needs parser API changes from `BrowserPage` to static DOM/Cheerio helpers for BLVD, MobilityWorks, source listing dates, and declarative mappings. |
| `packages/scraper-sources/src/browser/playwright-browser-service.ts` | Concrete dependency on `@playwright/test`, `playwright-extra`, and stealth plugin. | Keep while any source/path remains browser-required. Can move behind a browser-capable package boundary later. |
| `packages/scraper-sources/src/crawlee/html-fetcher.ts` | No browser dependency; Crawlee `CheerioCrawler`. | This is the preferred replacement shape for static HTML list/detail fetching. |

## Recommendation

Choose partial fallback retention now, not full removal.

The crawler is already halfway split by behavior:

- `scrape-only` sources can run without Chromium.
- HTTP enrichment jobs can run without Chromium.
- `detail-pages` sources still require Chromium at the worker handler level,
  even when their source scrape has been migrated to Crawlee/Cheerio.

The least risky architecture is:

1. Add source/job browser capability metadata.
2. Make `PlaywrightBrowserService` lazy and only available to browser-capable
   job handlers.
3. Split runtime lanes:
   - lightweight worker: HTTP enrichment plus browserless source scrapes;
   - browser worker: `detail-crawl`, `detail-extract`, and remaining
     browser-required source scrapes.
4. Migrate one source pipeline at a time from browser-backed DOM evaluation to
   static HTML parsing.
5. Remove Playwright only after all `detail-pages` fetch and extraction paths
   have browserless parity.

Separate images are preferable to a single all-purpose image if client setup
remains a product priority. Most client machines should run the lighter image
by default; browser workers can be opt-in for clients willing to carry the
heavier dependency.

## Immediate Docker unblock

The smallest immediate fix is to keep Playwright and repair the worker image
packaging.

`docker/worker/Dockerfile` currently runs:

```bash
./node_modules/.bin/playwright install --with-deps --only-shell chromium
```

after `pnpm deploy /prod/worker`. The worker app does not directly depend on
`playwright` or `@playwright/test`; Playwright is a transitive runtime
dependency of `@wivwav/scraper-sources`. The production deploy can therefore
contain the library code without exposing a root `node_modules/.bin/playwright`
entry where the Dockerfile expects it.

Recommended follow-up: add an issue-scoped fix that makes the Playwright CLI
available in the deployed worker root, preferably by adding a direct worker
runtime dependency on the matching Playwright package and keeping the existing
headless-shell-only install. That is smaller and safer than changing crawler
behavior while `detail-crawl` and `detail-extract` still need a browser.

Do this before broad migration work so `make worker` is usable again for client
testing.

## Validation required before removing Playwright from a path

For each migrated source or handler path:

- Fixture parity: existing fixture/gold tests must pass with browserless
  parsing. For BLVD and MobilityWorks, update or duplicate the contract tests
  that currently exercise exported `page.evaluate` functions.
- Parser parity: compare browser-backed output and browserless output for the
  same fixtures, including images, sale status, source-listed/source-updated
  dates, VIN/source identity matching, and evidence flags.
- Handler behavior: cover 404 handling, off-domain redirects, final URL
  handling, timeouts, retry/backoff behavior, raw page persistence, failed-page
  retry eligibility, and source paused/disabled mid-run behavior.
- Live smoke: run one bounded live scrape per migrated source with low page or
  listing limits and record counts for discovered cards, parsed listings, raw
  pages, and extracted details.
- Robots/crawl etiquette: preserve robots checks, user agent, crawl delays, and
  source-specific legal/product constraints already documented in adapters.
- Packaging evidence: prove the lightweight worker image starts without
  Playwright installed, and prove the browser-capable worker image still starts
  and can execute a browser-required job.

## Suggested follow-up issues

1. Fix `make worker` by restoring Playwright CLI availability in the production
   worker image.
2. Add worker capability gating and lazy browser-service initialization so
   HTTP-only jobs can run without importing/creating Playwright.
3. Add a browserless `detail-crawl` fetcher spike using the Crawlee/Cheerio
   fetcher pattern, with status/final URL parity tests.
4. Convert `detail-extract` parser APIs from `BrowserPage` to static DOM/Cheerio
   helpers, starting with MobilityWorks because source scrape is already
   browserless.
5. Convert BLVD, Freedom Motors, and Superior Van source scrapes one at a time.

