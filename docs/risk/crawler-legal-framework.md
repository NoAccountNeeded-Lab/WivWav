# Crawler vs. Scraper — Legal Reference & Project Framing

Reviewed: September 2026
Status: **Informational context, not legal advice.** Verify anything decision-critical with an actual attorney before shipping. Provides shared background so this reasoning does not need to be re-derived from scratch each session. It does not by itself clear a source for implementation.
Related: #972 (BLVD/MobilityWorks referral posture), #998 (private-seller source expansion, AMS Vans implemented, Craigslist/Facebook flagged), #999 (eBay Motors, blocked on API credential provisioning), `docs/risk/private-seller-data-policy.md`

---

## Operating Principles

WivWav's crawler discovers and refreshes source-attributed vehicle listing facts from public pages. It is not intended to bypass access controls, hide identity, defeat rate limits, or republish source sites wholesale.

- Crawl only publicly accessible pages. Do not add sources that require login, account-only access, or technical bypass.
- Respect robots.txt allow and disallow rules for crawler-managed requests.
- Apply declared `Crawl-delay` values to same-domain request pacing for crawler-managed requests.
- Use one honest, identifiable user-agent for crawler-managed requests: `WivWav/1.0 (+https://wivwav.com/bot)`.
- Keep source attribution and buyer links back to the original listing source.
- Do not add sources with known anti-scraping terms without explicit product/legal go/no-go.

Before adding a new source, record:

- Whether the listing pages are public without login.
- Whether robots.txt allows the target paths.
- Whether robots.txt declares `Crawl-delay`.
- Whether published terms prohibit crawling, scraping, caching, or reuse.
- Whether the implementation links users back to source listings.

Sources with explicit anti-scraping terms, login requirements, or technical blocks need an explicit product/legal decision before implementation.

---

## Project Description

**WivWav (Wav.vin)** is a general-purpose web search crawler/index — not a tool built around any single site. It is designed to work the way Google, Bing, or DuckDuckGo work, not the way a single-site scraper (e.g., a "better Craigslist search") works.

**Core design commitments:**
- Crawls **many, unrelated sites** — not narrowly targeted at one source
- **Follows robots.txt** on every site, without exception
- **Never logs in** to any site or accepts/agrees to any Terms of Service via account creation
- **Never attempts to circumvent** a block — if a site blocks the crawler (via robots.txt, IP block, CAPTCHA, etc.), it stops and does not try to get around it
- Indexes and displays **facts** (price, location, category, basic attributes) — not creative/copyrighted content (full post text, images, articles)
- **Routes users back to the original site** to transact, read, or otherwise complete any interaction — WivWav is a discovery layer, not a destination or a substitute
- Currently **free with no ads**; may add minimal ads later only if hosting/server costs become unsustainable due to popularity — not as a business model competing with any indexed site's ad revenue

This design was arrived at specifically to sit on the well-established "general search engine" side of a legal line that has been litigated multiple times, rather than the "single-site scraper" side.

---

## The Core Legal Distinction

There is no technical difference in code — both crawlers and scrapers are automated HTTP-fetching programs. The distinction that matters legally is **purpose, scope, and behavior**:

| | Crawler (protected pattern) | Scraper (risky pattern) |
|---|---|---|
| Scope | Many/unrelated sites | One site or a small targeted set |
| Purpose | General discovery/indexing | Extracting data for one specific downstream product |
| Norms | Obeys robots.txt, stops if blocked | Often ignores these; may evade blocks (proxy rotation, IP hopping) |
| Output | A general index others can query | A dataset that recreates/replaces one source |
| How courts have treated it | Implied license, fair use (*Field v. Google*) | Unauthorized access, breach of contract, trespass (*Craigslist v. 3Taps*) |

**WivWav is deliberately built to be the crawler pattern.** If the project ever narrows to target one site specifically, it shifts toward the scraper pattern and loses much of the legal grounding below.

**A general crawl scope does not neutralize a specific site's explicit terms.** The legal exposure attaches per-site, based on that site's own robots.txt/ToS/access-control posture.

---

## Key US Case Law

### *Craigslist, Inc. v. 3Taps, Inc.*, 942 F. Supp. 2d 962 (N.D. Cal. 2013)

- 3Taps scraped Craigslist content in real time and resold API access to it.
- Craigslist sent cease-and-desist letters and IP-blocked 3Taps; 3Taps evaded the blocks via proxies.
- The court denied the motion to dismiss the CFAA claim: continuing to access after explicit revocation (C&D + IP block) could be unauthorized access.
- Breach of contract and trespass-to-chattels claims also survived.
- Outcome: settled in 2015; permanent injunctions barred continued use of Craigslist content.

### *hiQ Labs, Inc. v. LinkedIn Corp.*, 938 F.3d 985 (9th Cir. 2019); reaffirmed 31 F.4th 1180 (9th Cir. 2022)

- hiQ scraped public LinkedIn profiles (no login required).
- The 9th Circuit held that CFAA generally does not cover accessing purely public data, even after a C&D and IP block.
- hiQ still lost on a separate contract theory after creating accounts and becoming bound by LinkedIn's user agreement.
- Takeaway: CFAA risk is lower for logged-out public pages; contract risk remains live when terms were actually accepted.

### *Field v. Google, Inc.*, 412 F. Supp. 2d 1106 (D. Nev. 2006)

- Google won against a claim over caching and snippets.
- The court relied in part on implied license: the plaintiff knew about robots.txt/no-archive controls and did not use them.
- This is a key foundation for good-faith search crawling, with the limit that explicit written prohibitions can displace silence-based implied license.

### *Meta Platforms, Inc. v. Bright Data Ltd.* (N.D. Cal., Jan. 2024)

- Court declined to find Bright Data liable for scraping logged-out, public Facebook/Instagram pages.
- Reinforces the public-page versus logged-in/account-bound distinction.

---

## Working Legal Framework

Ranked, most to least protective of a general crawler:

1. **Official API / licensed data access** — full permission and lowest exposure.
2. **Never create an account / never click through a TOU acceptance** — avoids the strongest breach-of-contract posture.
3. **Never circumvent a technical access control** (login walls, IP blocks via proxy rotation, CAPTCHA bypass).
4. **Obey robots.txt; stop immediately if blocked or sent a cease-and-desist**.
5. **Display facts, not creative content**.
6. **Stay general-purpose (many sites), not single-site-targeted**.
7. **Non-commercial or cost-covering-only monetization** — useful context, but it does not create authorization.

What does **not** protect a project by itself:

- "I only display facts" — good for copyright, but not enough for access/contract/trespass claims.
- "I route users back to the source to transact" — good product posture, but it does not determine whether access was authorized.
- "I'm not making money" — relevant to equities and likelihood of a dispute, but it does not create authorization.
- "We crawl many sites in general" — a specific site's ToS/robots.txt/access-control posture still matters.

---

## Explicit Revocation

The sharpest legal line is: **general, good-faith crawling of public data is lower-risk until a specific site tells you to stop** through a cease-and-desist, robots.txt entry naming the crawler, explicit IP block, or other access-control posture.

At that point:

- **Continuing anyway** creates the strongest risk.
- **Complying immediately** preserves the general search-engine framing and aligns with WivWav's stated design.

A site's ToS can also revoke consent up front in writing. This is why sources with explicit "no automated access" terms or login requirements stay in the "needs explicit product/legal go/no-go" bucket, regardless of WivWav's general-purpose framing.

---

## Interaction With Per-Source Go/No-Go

This document explains why the crawler is designed the way it is and what the case law says generally. It does not, by itself, clear any specific source for implementation. Each source still needs its own robots.txt/ToS check before an adapter is built against it, per the `wav-add-scraper-source` skill's crawl-etiquette requirements.

Per the framework above, a source whose ToS contains an explicit "no automated access" clause or that requires login to view listings stays in the "needs explicit product/legal go/no-go" bucket tracked per source.

---

*Last updated: September 2026. This document reflects US federal case law (primarily 9th Circuit) as of that date; verify against current law before making decisions with real legal/financial consequences. Not legal advice.*
