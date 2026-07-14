# Crawlee detail-crawl pilot

Status: **Complete — recommendation: revert the spike**

Issue #158 tested Crawlee only as the browser-fetching layer for
`detail-crawl`. BullMQ scheduling, Postgres URL selection, `RawPage`
persistence, detail extraction, and source adapters remained outside the
prototype.

## Prototype evidence

The prototype replaced the manual page loop with `PlaywrightCrawler` and
verified that it could:

- receive every selected URL, including duplicate rows, in database order;
- persist successful HTML with the existing `RawPage.upsert` shape;
- retry a failed request twice, report the final failure, and continue
  persisting later successes;
- use process-local Crawlee storage without creating a `storage/` directory;
- retain Chromium sandboxing and the existing 45-second navigation timeout.

Crawlee's native `sameDomainDelaySecs: 2` setting produced only a 617 ms gap
between requests in a local two-page browser smoke test. Adding an explicit
pre-navigation gate and a small scheduling margin produced a measured 2,091 ms
gap. This preserved the current one-request-every-two-seconds minimum, but it
also retained custom throttling logic alongside Crawlee's controls.

The prototype passed focused tests, scraper typecheck, lint, build, and the
affected check matrix (60 test files and 927 tests).

## Decision

Do not keep Crawlee in `detail-crawl` at this time.

The scoped `@crawlee/playwright` dependency adds `@crawlee/utils`, whose
runtime dependency on `sax@1.6.0` uses the BlueOak-1.0.0 license. WivWav allows
runtime dependencies only under MIT, Apache-2.0, BSD, or the PostgreSQL
License. Older compatible `sax` releases use ISC, which is also outside the
allowlist, so a version override does not resolve the policy conflict.

The pilot also added roughly 125 package records to the lockfile and still
needed WivWav-owned rate gating and duplicate-request keys. Those tradeoffs do
not make the fetching path simpler enough to justify a license exception or a
third-party patch.

## Follow-up threshold

Re-evaluate only through a new issue if Crawlee offers a fully allowlisted
runtime closure that works with the repository's strict pnpm linking. Any
follow-up should repeat the measured throttle, failure-continuation, storage,
dependency-footprint, and `RawPage` equivalence checks before considering
expansion beyond `detail-crawl`.
