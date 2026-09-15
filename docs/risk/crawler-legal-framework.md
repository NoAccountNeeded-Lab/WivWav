# Crawler Legal Framework

Last reviewed: September 2026

This note records WivWav's crawler posture for publicly accessible vehicle listing pages. It is an engineering and product-risk framework, not legal advice.

## Operating Principles

- Crawl only publicly accessible pages. Do not add sources that require login, account-only access, or technical bypass.
- Respect robots.txt allow and disallow rules for crawler-managed requests.
- Apply declared `Crawl-delay` values to same-domain request pacing for Crawlee-managed requests.
- Use one honest, identifiable user-agent for Crawlee-managed requests: `WivWav/1.0 (+https://wivwav.com/bot)`.
- Keep source attribution and buyer links back to the original listing source.
- Do not add sources with known anti-scraping terms without explicit product/legal go/no-go.

## Crawler Versus Scraper Posture

WivWav's crawler discovers and refreshes source-attributed vehicle listing facts from public pages. It is not intended to bypass access controls, hide identity, defeat rate limits, or republish source sites wholesale.

For Crawlee-managed requests, WivWav uses robots.txt checks, declared crawl-delay pacing, and a single identifiable user-agent. The public crawler information page is available at `/bot`.

## Source Review

Before adding a new source, record:

- Whether the listing pages are public without login.
- Whether robots.txt allows the target paths.
- Whether robots.txt declares `Crawl-delay`.
- Whether published terms prohibit crawling, scraping, caching, or reuse.
- Whether the implementation links users back to source listings.

Sources with explicit anti-scraping terms, login requirements, or technical blocks need an explicit product/legal decision before implementation.
