# NHTSA & EPA Public Source Coverage Audit

_Refs #219 — expand source-backed public vehicle model facts_

This document audits which public data sources are ingested, which fields each
exposes, and the rate-limit / caching guidance for each. All sources used here
are free public APIs with no authentication requirement and MIT-friendly terms.

---

## Sources evaluated

| Source | Category | Implemented? |
|--------|----------|-------------|
| NHTSA Recalls API | Safety | ✅ Yes (`nhtsa-recalls` job) |
| NHTSA Complaints API | Safety | ✅ Yes (`nhtsa-complaints` job) |
| NHTSA Safety Ratings API | Safety | ✅ Yes (`nhtsa-safety-ratings` job) |
| NHTSA Investigations API | Safety | ✅ Yes (`nhtsa-investigations` job, added #219) |
| NHTSA TSBs (Manufacturer Communications) API | Safety | ✅ Yes (`nhtsa-manufacturer-communications` job, added #219) |
| NHTSA vPIC VIN Decode API | Identity | ✅ Yes (used in `vin-enrich` and `/v1/vin/:vin` route) |
| EPA FuelEconomy.gov vehicles API | Efficiency | ✅ Yes (`model-research` job, EPA claims) |
| NHTSA Manufacturer Communications (NHTSA FMCS) | Safety | ⬜ Not yet (separate from TSBs; very low volume) |
| EPA FuelEconomy.gov — MPGe / EV range fields | Efficiency | ⬜ Partially — `combMpgData`/`pv4` captured; EV-specific (`range`, `mpge`) not explicitly mapped |

---

## Source-by-source field inventory

### 1. NHTSA Recalls — `https://api.nhtsa.gov/recalls/recallsByVehicle`

**Fields available from API:**
| Field | Stored column | Notes |
|-------|--------------|-------|
| `NHTSACampaignNumber` | `recall.nhtsaCampaignId` | Unique NHTSA campaign ID |
| `Component` | `recall.component` | Component affected |
| `Summary` | `recall.summary` | Description of defect |
| `Remedy` | `recall.remedy` | Repair instructions (null = open recall) |
| `ReportReceivedDate` | `recall.reportedAt` | Microsoft `/Date(ms)/` format |

**Fields available but not stored:** `Manufacturer`, `Subject`, `Consequence`

**Rate limit / caching guidance:**
- NHTSA requests ≤ 1 req/sec for API users; we apply 300 ms between calls (≈3 req/s),
  which stays safely within documented guidance.
- Schedule: daily at 04:30. Per-model on-demand via `refresh-safety`.
- Staleness threshold: 90 days (matches `isSafetyDataStale` in web).

---

### 2. NHTSA Complaints — `https://api.nhtsa.gov/complaints/complaintsByVehicle`

**Fields available from API:**
| Field | Stored column | Notes |
|-------|--------------|-------|
| `odiNumber` | `complaint.nhtsaId` | Unique ODI complaint number |
| `components` | `complaint.component` | Component category string |
| `summary` | `complaint.summary` | Complaint narrative |
| `mileage` | `complaint.mileage` | Odometer at time of incident |
| `crash` | `complaint.crashInvolved` | Boolean crash flag |
| `dateOfIncident` | `complaint.reportedAt` | YYYYMMDD integer |

**Fields available but not stored:** `injuries`, `deaths`, `fireinvolved`,
`products` (model-year details).

**Rate limit / caching guidance:**
- Same guidance as recalls (300 ms between calls).
- Schedule: Sundays at 05:00. High-volume endpoint — Sunday-only avoids daily
  API pressure.

---

### 3. NHTSA Safety Ratings — `https://api.nhtsa.gov/SafetyRatings`

Two-step fetch: list variants (make/model/year → VehicleId list), then detail
per VehicleId.

**Fields available from API:**
| Field | Stored column | Notes |
|-------|--------------|-------|
| `VehicleId` | `safety_rating.nhtsaVehicleId` | Unique variant ID |
| `VehicleDescription` | `safety_rating.description` | Trim/variant label |
| `OverallRating` | `safety_rating.overallRating` | 1–5 stars (string, parsed to int) |
| `OverallFrontCrashRating` | `safety_rating.frontCrashRating` | 1–5 stars |
| `OverallSideCrashRating` | `safety_rating.sideCrashRating` | 1–5 stars |
| `RolloverRating` | `safety_rating.rolloverRating` | 1–5 stars |
| `RolloverRating2` | `safety_rating.rolloverRatingText` | Text description |

**Fields available but not stored:** `NHTSAElectronicStabilityControl`,
`NHTSAForwardCollisionWarning`, `NHTSALaneDepartureWarning`, NCAP dates.

**Rate limit / caching guidance:**
- Two HTTP calls per vehicle model (variants + details per variant).
- 300 ms between calls. Schedule: Sundays at 06:00.

---

### 4. NHTSA Investigations — `https://api.nhtsa.gov/investigations/investigationsByVehicle`

_Added by issue #219._

**Fields available from API:**
| Field | Stored column | Notes |
|-------|--------------|-------|
| `investigationId` | `investigation.nhtsaId` | e.g. `PE24001` |
| `component` | `investigation.component` | Component under investigation |
| `summary` | `investigation.summary` | Investigation description |
| `openedDate` | `investigation.openedDate` | YYYYMMDD integer |
| `closedDate` | `investigation.closedDate` | Null if still open |
| `outcome` | `investigation.outcome` | Resolution text when closed |

**Source URL pattern:** `https://www.nhtsa.gov/vehicle-safety/recalls-and-investigations#investigations&investigationId={id}`

**Rate limit / caching guidance:**
- 300 ms between calls. Schedule: Sundays at 06:30.
- Investigations are infrequent (typically < 10 per make/model/year).

---

### 5. NHTSA Technical Service Bulletins (TSBs) — `https://api.nhtsa.gov/tsbs/tsbsByVehicle`

_Added by issue #219. TSBs are the primary "manufacturer communications" data
available through the public NHTSA API._

**Fields available from API:**
| Field | Stored column | Notes |
|-------|--------------|-------|
| `tsbId` | `manufacturer_communication.nhtsaId` | TSB identifier |
| `component` | `manufacturer_communication.component` | System addressed |
| `summary` | `manufacturer_communication.summary` | Bulletin description |
| `issuedDate` | `manufacturer_communication.issuedDate` | YYYYMMDD integer |

**Source URL pattern:** `https://www.nhtsa.gov/vehicle/safety-issues/tsbs?tsbId={id}`

**Rate limit / caching guidance:**
- 300 ms between calls. Schedule: Sundays at 07:00.

---

### 6. NHTSA vPIC VIN Decode — `https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVin/{vin}`

Used during VIN enrichment, not model-level batch refresh.

**Fields captured:**
| vPIC variable | Usage |
|---------------|-------|
| `Make` | Vehicle make normalisation |
| `Model` | Vehicle model normalisation |
| `Model Year` | Year validation |
| `Trim` | Trim-level matching |
| `Body Class` | `bodyType` on `VehicleModel` |

**Rate limit / caching guidance:**
- vPIC is a batch-friendly API; for production use, the bulk CSV downloads
  (`vpic.nhtsa.dot.gov/api/vehicles/GetAllMakes?format=csv`) are preferred
  for make/model/year reference data. VIN decode is per-record only.
- VIN decode results are not re-fetched unless the `vehicleId` is missing.

---

### 7. EPA FuelEconomy.gov — `https://www.fueleconomy.gov/ws/rest/ympg/shared/vehicles`

**Fields captured (stored as `VehicleModelClaim` records):**
| EPA field | Claim `field` | Notes |
|-----------|--------------|-------|
| `city08` | `fuelEconomyCity` | City MPG (petroleum) |
| `hwy08` | `fuelEconomyHwy` | Highway MPG |
| `combMpgData` / `pv4` | `fuelEconomyCombined` | Combined MPG |
| `drive` | `drivetrain` | e.g. "Front-Wheel Drive" |
| `eng_dscr` | `engineDescription` | Engine description string |
| `displ` + `cylinders` | `engineDescription` | Fallback if `eng_dscr` absent |
| `fuelType` | `fuelType` | e.g. "Regular Gasoline" |
| `trany` | `transmission` | e.g. "Automatic 8-spd" |

**Fields available but not currently mapped:**
| EPA field | Description |
|-----------|-------------|
| `combE` / `city08E` / `hwy08E` | EV/PHEV electricity efficiency (MPGe) |
| `range` | EV electric-only range (miles) |
| `rangeCity` / `rangeHwy` | City/highway EV range |
| `co2TailpipeGpm` | CO₂ tailpipe grams/mile |
| `fuelCost08` | Annual fuel cost estimate |
| `ghgScore` | EPA greenhouse gas score |
| `msrp` | Base MSRP (not reliably populated) |

These EV/emissions fields are not ingested today. A follow-up issue should add
them for electric and plug-in hybrid vehicles.

**Rate limit / caching guidance:**
- No explicit rate limit documented; we apply 300 ms between calls.
- Data is keyed by model year and does not change frequently.
  Schedule: Sundays at 05:30.
- `researchVersion` integer gates re-fetch; bump to trigger a full re-run.

---

## Coverage gaps identified

| Gap | Priority | Notes |
|-----|----------|-------|
| EPA MPGe / EV range fields | Medium | Relevant for BEV/PHEV WAV base vehicles |
| EPA fuel cost and emissions fields | Low | Nice-to-have for buyer context |
| vPIC bulk make/model/year reference | Low | Currently done per-VIN; bulk download would reduce API calls |
| NHTSA FMCS manufacturer communications (not TSBs) | Low | Very low volume; separate from TSBs; may duplicate TSB data |

---

## No computed scores policy

Per product direction (issue #219), WivWav does **not** compute reliability,
dependability, or purchase-quality scores. All displayed facts must be traceable
to a `sourceUrl` or `sourceName` from the raw API response. The `VehicleStats`
table's `reliabilityScore` and `jdPowerScore` columns are vestiges of an earlier
design and are not surfaced in the current UI.
