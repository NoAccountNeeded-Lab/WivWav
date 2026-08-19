/**
 * Search index reconciliation (issue #642).
 *
 * The pre-#642 listing-quality-audit compared the raw count of eligible
 * active listing rows against the Meilisearch document count. Search holds
 * exactly one representative document per verified vehicle group (#530,
 * #669), so that comparison over-counts whenever any group has more than one
 * eligible member — it reports "divergence" during entirely normal operation
 * and can mask a real defect (e.g. #636) that puts more than one
 * representative in the index for the same group.
 *
 * This module rebuilds the *expected* representative catalog from Postgres
 * using the same deterministic grouping/selection policy production indexing
 * uses (`groupKeyOf` / `selectRepresentative` / `toDocument` from
 * `@wivwav/search` — imported, never re-implemented), fetches the *actual*
 * catalog from Meilisearch, and reconciles every public facet between them.
 *
 * Facet invariants:
 * - "required" facets (make, model, year, condition, sellerType,
 *   conversionType, rampType) are always set on every eligible listing —
 *   `unknown` is a legitimate value for the two enum fields, but null/empty
 *   is not. A required facet missing from a document is a data-integrity bug
 *   and is reported as an invariant violation.
 * - "optional" facets (trim, color, state, priceBucket, mileageBucket,
 *   conversionBrand) are legitimately null for many real listings (no VIN
 *   decode, call-for-price, private seller with no location, etc.) — a facet
 *   value being absent on some documents is expected and must never be
 *   reported as an error. Only their *coverage ratio* is tracked.
 * - "multi-valued" facets (wavFeatures) may legitimately be an empty array —
 *   same treatment as optional facets.
 *
 * @module
 */

import type { Listing, PrismaClient } from '@wivwav/db'
import type { Meilisearch } from 'meilisearch'
import {
  groupKeyOf,
  selectRepresentative,
  toDocument,
  INDEX_NAME,
  type ListingDocument,
} from '@wivwav/search'
import { getMeiliClient } from '../lib/meili.js'
import { getQueueFactory } from '../lib/queue-factory.js'
import { QUEUES } from '@wivwav/queue'

// ── Constants ────────────────────────────────────────────────────────────────

const DB_BATCH_SIZE = 500
const MEILI_PAGE_SIZE = 500
const MAX_SAMPLE_IDS = 10
/**
 * BullMQ/ioredis is configured with `maxRetriesPerRequest: null` (required
 * for worker blocking-pop semantics elsewhere in the app) — a command issued
 * against an unreachable Redis/Valkey retries indefinitely rather than
 * failing fast. Without a bounded timeout here, a down queue backend would
 * hang the entire read-only audit instead of degrading to "unavailable".
 */
const QUEUE_STATS_TIMEOUT_MS = 3000
/** Default absolute coverage-rate drop (0–1) that triggers a baseline alert. */
export const DEFAULT_COVERAGE_DROP_THRESHOLD = 0.1

// ── Facet model ──────────────────────────────────────────────────────────────

export type FacetKey =
  | 'make'
  | 'model'
  | 'trim'
  | 'year'
  | 'priceBucket'
  | 'mileageBucket'
  | 'state'
  | 'condition'
  | 'conversionType'
  | 'color'
  | 'rampType'
  | 'sellerType'
  | 'conversionBrand'
  | 'wavFeatures'

export interface FacetSpec {
  key: FacetKey
  /** Always non-null/non-empty on every eligible listing; absence is a bug. */
  required: boolean
  /** Array-valued facet (may legitimately be empty). */
  multiValued: boolean
}

/**
 * The complete public facet set (refs #642 acceptance criteria). Order here
 * drives the order of `facetComparisons`/`coverage` in the report.
 */
export const FACET_SPECS: readonly FacetSpec[] = [
  { key: 'make', required: true, multiValued: false },
  { key: 'model', required: true, multiValued: false },
  { key: 'trim', required: false, multiValued: false },
  { key: 'year', required: true, multiValued: false },
  { key: 'priceBucket', required: false, multiValued: false },
  { key: 'mileageBucket', required: false, multiValued: false },
  { key: 'state', required: false, multiValued: false },
  { key: 'condition', required: true, multiValued: false },
  { key: 'conversionType', required: true, multiValued: false },
  { key: 'color', required: false, multiValued: false },
  { key: 'rampType', required: true, multiValued: false },
  { key: 'sellerType', required: true, multiValued: false },
  { key: 'conversionBrand', required: false, multiValued: false },
  { key: 'wavFeatures', required: false, multiValued: true },
]

/** Fields (beyond the facets themselves) needed from every document for reconciliation. */
const FACET_DOC_FIELDS = [
  'id',
  'sourceId',
  'vehicleId',
  'make',
  'model',
  'trim',
  'year',
  'priceBucket',
  'mileageBucket',
  'state',
  'condition',
  'conversionType',
  'color',
  'rampType',
  'sellerType',
  'conversionBrand',
  'wavFeatures',
] as const

export type FacetDoc = Pick<ListingDocument, (typeof FACET_DOC_FIELDS)[number]>

export function toFacetDoc(doc: ListingDocument): FacetDoc {
  const picked: Record<string, unknown> = {}
  for (const field of FACET_DOC_FIELDS) picked[field] = doc[field]
  return picked as FacetDoc
}

/** Returns the set of facet values a document contributes for `key` (0 or 1 for exclusive facets). */
function facetValues(doc: FacetDoc, key: FacetKey): string[] {
  if (key === 'wavFeatures') return doc.wavFeatures
  // `year` is a non-nullable Int column, but `0` is the established sentinel
  // for "missing" elsewhere in this audit (see scanSourceListings) — treat it
  // the same way here so a missing year can actually be flagged as a required
  // -facet violation instead of always counting as present.
  if (key === 'year') return doc.year === 0 ? [] : [String(doc.year)]
  const value = doc[key] as string | null
  return value == null || value === '' ? [] : [value]
}

// ── Distributions & comparisons ─────────────────────────────────────────────

export function buildDistribution(docs: readonly FacetDoc[], key: FacetKey): Record<string, number> {
  const dist: Record<string, number> = {}
  for (const doc of docs) {
    for (const value of new Set(facetValues(doc, key))) {
      dist[value] = (dist[value] ?? 0) + 1
    }
  }
  return dist
}

export interface FacetComparisonResult {
  facet: FacetKey
  required: boolean
  multiValued: boolean
  /** Values present in the expected (Postgres-derived) distribution but absent from Meilisearch. */
  onlyInExpected: string[]
  /** Values present in Meilisearch but absent from the expected distribution — usually stale/raw values. */
  onlyInActual: string[]
  /** Values present on both sides with a divergent document count. */
  countMismatches: Array<{ value: string; expected: number; actual: number }>
  diverged: boolean
}

export function compareFacet(
  spec: FacetSpec,
  expectedDocs: readonly FacetDoc[],
  actualDocs: readonly FacetDoc[],
): FacetComparisonResult {
  const expected = buildDistribution(expectedDocs, spec.key)
  const actual = buildDistribution(actualDocs, spec.key)
  const allValues = new Set([...Object.keys(expected), ...Object.keys(actual)])

  const onlyInExpected: string[] = []
  const onlyInActual: string[] = []
  const countMismatches: Array<{ value: string; expected: number; actual: number }> = []

  for (const value of allValues) {
    const e = expected[value] ?? 0
    const a = actual[value] ?? 0
    if (e > 0 && a === 0) onlyInExpected.push(value)
    else if (a > 0 && e === 0) onlyInActual.push(value)
    else if (e !== a) countMismatches.push({ value, expected: e, actual: a })
  }

  return {
    facet: spec.key,
    required: spec.required,
    multiValued: spec.multiValued,
    onlyInExpected: onlyInExpected.sort(),
    onlyInActual: onlyInActual.sort(),
    countMismatches: countMismatches.sort((a, b) => a.value.localeCompare(b.value)),
    diverged: onlyInExpected.length > 0 || onlyInActual.length > 0 || countMismatches.length > 0,
  }
}

// ── Coverage ratios ──────────────────────────────────────────────────────────

export interface CoverageEntry {
  field: FacetKey
  sourceId: string | 'global'
  present: number
  total: number
  rate: number
}

/**
 * Coverage ratio (present / total) for every *optional* facet — required
 * facets are covered by `invariantViolations` instead, since a missing value
 * there is a bug, not a normal sparsity signal. Computed both globally and
 * per source so a source-specific extraction regression is visible even when
 * the global rate looks fine.
 */
export function computeCoverage(docs: readonly FacetDoc[]): CoverageEntry[] {
  const entries: CoverageEntry[] = []
  const optionalSpecs = FACET_SPECS.filter((s) => !s.required)
  const bySource = new Map<string, FacetDoc[]>()
  for (const doc of docs) {
    const group = bySource.get(doc.sourceId)
    if (group) group.push(doc)
    else bySource.set(doc.sourceId, [doc])
  }

  for (const spec of optionalSpecs) {
    const present = docs.filter((d) => facetValues(d, spec.key).length > 0).length
    entries.push({ field: spec.key, sourceId: 'global', present, total: docs.length, rate: docs.length > 0 ? present / docs.length : 0 })

    for (const [sourceId, sourceDocs] of bySource) {
      const sourcePresent = sourceDocs.filter((d) => facetValues(d, spec.key).length > 0).length
      entries.push({
        field: spec.key,
        sourceId,
        present: sourcePresent,
        total: sourceDocs.length,
        rate: sourceDocs.length > 0 ? sourcePresent / sourceDocs.length : 0,
      })
    }
  }

  return entries
}

/** Rate of `'unknown'` value on the enum facets that always carry a value (conversionType, rampType). */
export function computeUnknownRates(docs: readonly FacetDoc[]): CoverageEntry[] {
  const entries: CoverageEntry[] = []
  const unknownFields: FacetKey[] = ['conversionType', 'rampType']
  const bySource = new Map<string, FacetDoc[]>()
  for (const doc of docs) {
    const group = bySource.get(doc.sourceId)
    if (group) group.push(doc)
    else bySource.set(doc.sourceId, [doc])
  }

  for (const field of unknownFields) {
    const known = docs.filter((d) => (d[field] as string) !== 'unknown').length
    entries.push({ field, sourceId: 'global', present: known, total: docs.length, rate: docs.length > 0 ? known / docs.length : 0 })
    for (const [sourceId, sourceDocs] of bySource) {
      const sourceKnown = sourceDocs.filter((d) => (d[field] as string) !== 'unknown').length
      entries.push({
        field,
        sourceId,
        present: sourceKnown,
        total: sourceDocs.length,
        rate: sourceDocs.length > 0 ? sourceKnown / sourceDocs.length : 0,
      })
    }
  }

  return entries
}

/** Required facets that are null/empty on an expected document — always a bug, never expected sparsity. */
export function detectRequiredFacetViolations(docs: readonly FacetDoc[]): string[] {
  const violations: string[] = []
  for (const spec of FACET_SPECS.filter((s) => s.required)) {
    const missing = docs.filter((d) => facetValues(d, spec.key).length === 0)
    if (missing.length > 0) {
      const samples = missing.slice(0, MAX_SAMPLE_IDS).map((d) => d.id)
      violations.push(
        `Required facet "${spec.key}" is missing on ${missing.length} expected document(s) — samples: ${samples.join(', ')}`,
      )
    }
  }
  return violations
}

// ── Duplicate vehicleId detection ───────────────────────────────────────────

export interface DuplicateVehicleGroup {
  vehicleId: string
  documentIds: string[]
}

/**
 * Meilisearch's `distinctAttribute` only deduplicates at *search* time — it
 * does not prevent more than one representative for the same verified
 * vehicle group from being present in the index (e.g. a `syncListings` bug
 * that fails to delete a stale non-representative member, refs #636). This
 * must be checked directly against the indexed documents.
 */
export function detectDuplicateVehicleIds(
  actualDocs: readonly Pick<ListingDocument, 'id' | 'vehicleId'>[],
): DuplicateVehicleGroup[] {
  const byVehicleId = new Map<string, string[]>()
  for (const doc of actualDocs) {
    if (!doc.vehicleId) continue
    const ids = byVehicleId.get(doc.vehicleId)
    if (ids) ids.push(doc.id)
    else byVehicleId.set(doc.vehicleId, [doc.id])
  }
  return [...byVehicleId.entries()]
    .filter(([, ids]) => ids.length > 1)
    .map(([vehicleId, documentIds]) => ({ vehicleId, documentIds: documentIds.sort() }))
    .sort((a, b) => a.vehicleId.localeCompare(b.vehicleId))
}

// ── Canonicalization divergence (per-document) ──────────────────────────────

export interface CanonicalizationDivergence {
  id: string
  field: FacetKey
  expected: string | null
  actual: string | null
}

/**
 * For documents present in both catalogs (matched by id), compares each
 * facet field value directly. This catches drift that a purely aggregate
 * distribution comparison can miss — e.g. a document whose raw source data
 * changed, or whose canonicalization changed since the last sync, while an
 * unrelated document happens to produce a matching aggregate count.
 */
export function detectCanonicalizationDivergence(
  expectedDocs: readonly FacetDoc[],
  actualDocs: readonly FacetDoc[],
): CanonicalizationDivergence[] {
  const actualById = new Map(actualDocs.map((d) => [d.id, d]))
  const divergences: CanonicalizationDivergence[] = []

  for (const expected of expectedDocs) {
    const actual = actualById.get(expected.id)
    if (!actual) continue // missing coverage — reported separately

    for (const spec of FACET_SPECS) {
      if (spec.multiValued) {
        const e = [...expected.wavFeatures].sort()
        const a = [...actual.wavFeatures].sort()
        if (JSON.stringify(e) !== JSON.stringify(a)) {
          divergences.push({ id: expected.id, field: spec.key, expected: e.join(',') || null, actual: a.join(',') || null })
        }
        continue
      }
      const e = spec.key === 'year' ? String(expected.year) : (expected[spec.key] as string | null)
      const a = spec.key === 'year' ? String(actual.year) : (actual[spec.key] as string | null)
      if (e !== a) {
        divergences.push({ id: expected.id, field: spec.key, expected: e, actual: a })
      }
    }
  }

  return divergences
}

// ── Coverage baseline (historical drop detection) ───────────────────────────

export interface CoverageBaselineEntry {
  field: string
  sourceId: string
  rate: number
}

export interface CoverageBaseline {
  capturedAt: string
  entries: CoverageBaselineEntry[]
}

export interface CoverageDropAlert {
  field: string
  sourceId: string
  previousRate: number
  currentRate: number
  drop: number
}

/**
 * Compares current coverage/unknown-rate entries against a previously
 * approved baseline, flagging any field/source combination whose rate
 * dropped by more than `thresholdRatio` (absolute, 0–1). Returns an empty
 * list when no baseline is supplied — first run never fires a false alert.
 */
export function detectCoverageDrops(
  current: readonly CoverageBaselineEntry[],
  baseline: CoverageBaseline | null,
  thresholdRatio: number = DEFAULT_COVERAGE_DROP_THRESHOLD,
): CoverageDropAlert[] {
  if (!baseline) return []
  const previousByKey = new Map(baseline.entries.map((e) => [`${e.field}::${e.sourceId}`, e.rate]))
  const alerts: CoverageDropAlert[] = []

  for (const entry of current) {
    const previousRate = previousByKey.get(`${entry.field}::${entry.sourceId}`)
    if (previousRate === undefined) continue
    const drop = previousRate - entry.rate
    if (drop >= thresholdRatio) {
      alerts.push({ field: entry.field, sourceId: entry.sourceId, previousRate, currentRate: entry.rate, drop })
    }
  }

  return alerts.sort((a, b) => b.drop - a.drop)
}

// ── Expected catalog (Postgres) ──────────────────────────────────────────────

type DbClient = PrismaClient

/**
 * Rebuilds the expected representative catalog: every eligible active
 * listing grouped by verified vehicle group (`groupKeyOf`), one deterministic
 * representative per group (`selectRepresentative`) — the exact same policy
 * `packages/search`'s `syncListings` uses for the live index, imported
 * rather than re-implemented so the two can never drift apart.
 */
export async function buildExpectedCatalog(db: DbClient): Promise<FacetDoc[]> {
  const groups = new Map<string, Listing[]>()
  let cursor: string | undefined

  for (;;) {
    const rows: Listing[] = await db.listing.findMany({
      take: DB_BATCH_SIZE,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      where: { status: 'active', publicationStatus: 'eligible' },
      orderBy: { id: 'asc' },
    })
    if (rows.length === 0) break

    for (const row of rows) {
      const key = groupKeyOf(row)
      const group = groups.get(key)
      if (group) group.push(row)
      else groups.set(key, [row])
    }

    cursor = rows[rows.length - 1]!.id
    if (rows.length < DB_BATCH_SIZE) break
  }

  return [...groups.values()].map((group) => toFacetDoc(toDocument(selectRepresentative(group))))
}

// ── Actual catalog (Meilisearch) ─────────────────────────────────────────────

export interface ActualCatalog {
  docs: FacetDoc[]
  total: number
}

/**
 * Fetches every document currently in the live index (not just a facet
 * summary) so duplicate-vehicleId and per-document canonicalization checks
 * can run against real data, not a Meilisearch-side aggregate that could
 * itself hide the bug being checked for.
 */
async function fetchActualCatalog(): Promise<ActualCatalog | null> {
  try {
    const client: Meilisearch = getMeiliClient()
    const index = client.index(INDEX_NAME)
    const stats = await index.getStats()
    const total = stats.numberOfDocuments

    const docs: FacetDoc[] = []
    let offset = 0
    for (;;) {
      const page = await index.getDocuments<FacetDoc>({
        offset,
        limit: MEILI_PAGE_SIZE,
        fields: [...FACET_DOC_FIELDS],
      })
      docs.push(...page.results)
      offset += page.results.length
      if (page.results.length < MEILI_PAGE_SIZE || docs.length >= total) break
    }

    return { docs, total }
  } catch {
    return null
  }
}

// ── Publication / listing-resolve backlog ───────────────────────────────────

export interface PublicationBacklog {
  pending: number
  quarantined: number
  /** Waiting + active + delayed jobs on the `listing-resolve` queue; null if the queue is unreachable. */
  listingResolveBacklog: number | null
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms)
    promise.then(
      (value) => { clearTimeout(timer); resolve(value) },
      (err: unknown) => { clearTimeout(timer); reject(err) },
    )
  })
}

async function getPublicationBacklog(db: DbClient): Promise<PublicationBacklog> {
  const [pending, quarantined] = await Promise.all([
    db.listing.count({ where: { status: 'active', publicationStatus: 'pending' } }),
    db.listing.count({ where: { status: 'active', publicationStatus: 'quarantined' } }),
  ])

  let listingResolveBacklog: number | null
  try {
    const factory = getQueueFactory()
    const queue = factory.createQueue(QUEUES.LISTING_RESOLVE)
    const stats = await withTimeout(queue.getStats(), QUEUE_STATS_TIMEOUT_MS)
    listingResolveBacklog = stats.waiting + stats.active + stats.delayed
  } catch {
    listingResolveBacklog = null
  }

  return { pending, quarantined, listingResolveBacklog }
}

// ── Report ───────────────────────────────────────────────────────────────────

export interface SearchReconciliationReport {
  /** False when Meilisearch could not be reached at all — every other field is a Postgres-only view. */
  available: boolean
  note: string
  expectedTotal: number
  actualTotal: number | null
  countDivergence: boolean
  duplicateVehicleIds: DuplicateVehicleGroup[]
  missingFromIndex: { count: number; sampleIds: string[] }
  unexpectedInIndex: { count: number; sampleIds: string[] }
  canonicalizationDivergenceCount: number
  canonicalizationDivergenceSamples: CanonicalizationDivergence[]
  facetComparisons: FacetComparisonResult[]
  coverage: CoverageEntry[]
  unknownRates: CoverageEntry[]
  invariantViolations: string[]
  coverageDropAlerts: CoverageDropAlert[]
  publicationBacklog: PublicationBacklog
}

export interface ReconcileOptions {
  /** Previously approved coverage baseline (from --baseline), or null for a first run. */
  baseline?: CoverageBaseline | null
  coverageDropThreshold?: number
}

/**
 * Runs the full search-index reconciliation. Read-only against both
 * Postgres and Meilisearch.
 */
export async function reconcileSearchCatalog(
  db: DbClient,
  opts: ReconcileOptions = {},
): Promise<SearchReconciliationReport> {
  const expectedDocs = await buildExpectedCatalog(db)
  const publicationBacklog = await getPublicationBacklog(db)
  const actual = await fetchActualCatalog()

  if (!actual) {
    return {
      available: false,
      note: 'Meilisearch unavailable — search index reconciliation not checked.',
      expectedTotal: expectedDocs.length,
      actualTotal: null,
      countDivergence: false,
      duplicateVehicleIds: [],
      missingFromIndex: { count: 0, sampleIds: [] },
      unexpectedInIndex: { count: 0, sampleIds: [] },
      canonicalizationDivergenceCount: 0,
      canonicalizationDivergenceSamples: [],
      facetComparisons: [],
      coverage: [],
      unknownRates: [],
      invariantViolations: detectRequiredFacetViolations(expectedDocs),
      coverageDropAlerts: [],
      publicationBacklog,
    }
  }

  const expectedIds = new Set(expectedDocs.map((d) => d.id))
  const actualIds = new Set(actual.docs.map((d) => d.id))

  const missingFromIndexIds = expectedDocs.filter((d) => !actualIds.has(d.id)).map((d) => d.id)
  const unexpectedInIndexIds = actual.docs.filter((d) => !expectedIds.has(d.id)).map((d) => d.id)

  const facetComparisons = FACET_SPECS.map((spec) => compareFacet(spec, expectedDocs, actual.docs))
  const canonicalizationDivergence = detectCanonicalizationDivergence(expectedDocs, actual.docs)
  const duplicateVehicleIds = detectDuplicateVehicleIds(actual.docs)
  const coverage = computeCoverage(expectedDocs)
  const unknownRates = computeUnknownRates(expectedDocs)

  const baselineEntries: CoverageBaselineEntry[] = [...coverage, ...unknownRates].map((e) => ({
    field: e.field,
    sourceId: e.sourceId,
    rate: e.rate,
  }))
  const coverageDropAlerts = detectCoverageDrops(baselineEntries, opts.baseline ?? null, opts.coverageDropThreshold)

  const invariantViolations = [
    ...detectRequiredFacetViolations(expectedDocs),
    ...(duplicateVehicleIds.length > 0
      ? [`${duplicateVehicleIds.length} verified vehicle group(s) have more than one document in the index (distinctAttribute only dedupes at search time).`]
      : []),
  ]

  const countDivergence = expectedDocs.length !== actual.total || missingFromIndexIds.length > 0 || unexpectedInIndexIds.length > 0

  return {
    available: true,
    note: countDivergence
      ? `Expected ${expectedDocs.length} representative document(s); index has ${actual.total}.`
      : 'Expected representative catalog matches the index.',
    expectedTotal: expectedDocs.length,
    actualTotal: actual.total,
    countDivergence,
    duplicateVehicleIds,
    missingFromIndex: { count: missingFromIndexIds.length, sampleIds: missingFromIndexIds.slice(0, MAX_SAMPLE_IDS) },
    unexpectedInIndex: { count: unexpectedInIndexIds.length, sampleIds: unexpectedInIndexIds.slice(0, MAX_SAMPLE_IDS) },
    canonicalizationDivergenceCount: canonicalizationDivergence.length,
    canonicalizationDivergenceSamples: canonicalizationDivergence.slice(0, MAX_SAMPLE_IDS),
    facetComparisons,
    coverage,
    unknownRates,
    invariantViolations,
    coverageDropAlerts,
    publicationBacklog,
  }
}
