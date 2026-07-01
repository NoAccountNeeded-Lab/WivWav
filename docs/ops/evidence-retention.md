# Evidence Retention Policy

This document defines what evidence must be retained after raw HTML cleanup,
how long it must be kept, what may be redacted, and how an operator can
reconstruct a field decision from retained evidence.

---

## Why evidence retention matters

WivWav derives accessibility-critical fields (ramp type, conversion type, WAV
features, floor lowering) from scraper-extracted text.  If a listing's detail
HTML is deleted before a field decision is audited, there is no way to verify
whether the extraction was correct or to reproduce the decision.

The raw HTML retention window is seven days.  After that window closes, the
only evidence of how a field was populated is the listing row itself plus the
evidence preserved under this policy.

---

## What must be retained

| Evidence item | Retention period | Rationale |
|---|---|---|
| Listing DB row (all columns) | Until listing is permanently deleted | Primary source of parsed field values |
| `qualityIssueCodes[]` on the listing | Same as listing row | Enables audit to identify quarantined listings without re-parsing |
| `ListingObservation` rows for the detail extraction | 90 days from `observedAt` | Provides the specific extraction-version context (schema version, job run) that produced the current field values |
| Source URL (`sourceUrl`, `buyerUrl`) | Same as listing row | Allows an operator to re-fetch the live page for fresh verification |
| `qualityCheckedAt` timestamp | Same as listing row | Links field values to the validation run that produced the quarantine decision |
| Gold dataset fixtures (`fixtures/gold/*.gold.json`) | Indefinite — checked into version control | Provides verified expected values for each parser version to compare against |
| Audit report outputs (`*.listing-quality-audit.json`) | 90 days from run date | Enables baseline comparison and trend analysis without re-running |

---

## What must NOT be retained beyond the raw HTML window

| Data type | Reason |
|---|---|
| Full dealer or private seller description text (beyond the DB column) | Raw copy may contain personal contact information; the `description` column retains only the scraper-extracted text, which is already bounded by the API snippet limit |
| Raw response HTML after the 7-day rawpage cleanup | Storage cost; operator ToS compliance; re-fetching from live source achieves the same goal |
| Personally identifiable seller data (full name, personal phone, personal email) beyond `dealerName` / `dealerPhone` | Privacy policy — these fields already exist only as dealer-context fields, not as personal seller fields |

---

## Redaction constraints

- The listing quality audit report (`listing-quality-audit.ts`) must not emit
  description text, dealer phone numbers, or seller names in its output.
  Representative listing IDs (cuid values) are permitted.
- Audit reports stored to disk (`--out audit.json`) must be treated as
  operator-internal files and must not be published or exposed via public API.
- When sampling listings for the `knownGaps` attachment in issue evidence,
  use listing IDs only, not full serialized listing objects.

---

## Storage limits

- Gold dataset fixtures: no hard limit; each fixture file should remain under
  100 KB. Files exceeding this size are a signal that the fixture contains
  unnecessary embedded HTML rather than structured test input.
- Audit report JSON files: target under 1 MB per run. If a report exceeds
  this threshold, reduce representative sample counts or add `--source` scoping.

---

## How to reconstruct a field decision

1. **Identify the listing** — note the listing `id` (cuid) from the audit
   report sample list or the operator UI.

2. **Retrieve the listing row** — query the `listings` table for the full row,
   including `qualityIssueCodes`, `qualityCheckedAt`, `detailScrapedAt`, and
   `sourceUrl`.

3. **Retrieve listing observations** — query `ListingObservation` filtered by
   `listingId` and sorted by `observedAt` desc.  The most recent observation
   for `reference = 'detail'` contains the schema-version context that
   produced the current field values.

4. **Re-fetch from live source** — use `sourceUrl` to load the current
   listing page.  If the listing is still live, compare the live page with
   the current DB values to determine whether a field changed or was always
   wrong.

5. **Check the gold dataset** — if the discrepancy matches a known test
   pattern in the gold fixtures, the parser behavior is expected; file a
   fixture update to add the edge case.

6. **Check the validator** — if `qualityIssueCodes` includes a code that
   conflicts with your manual reading, consult
   `apps/scraper/src/engine/listing-validator.ts` for the rule definition and
   `packages/types/src/listing.ts` for the severity mapping.

---

## Audit version tracking

Every audit report includes `auditVersion` (currently `1`). When extraction
or analysis logic changes in a way that would produce different field values
for the same source HTML, increment `AUDIT_VERSION` in
`apps/scraper/src/jobs/listing-quality-audit.ts`. This allows operators to
identify which results came from which version of the logic.

Gold fixture files include a `parserVersion` field for the same purpose. When
a parser function is updated in a backward-incompatible way, increment
`parserVersion` in the affected gold file and update the expected values.
