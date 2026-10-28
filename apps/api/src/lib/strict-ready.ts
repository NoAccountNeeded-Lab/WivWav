import { Prisma } from '@wivwav/db'
import { isPublishGateStrict } from '@wivwav/types/listing-readiness'

/** Raw-SQL twin of `strictReadyWhere()`; keep the two in step (parity test in meilisearch-sync.test.ts). */
export const STRICT_READY_SQL = Prisma.sql`
      AND listings."detailScrapedAt" IS NOT NULL
      AND listings."detailStaleAt" IS NULL
      AND listings."qualityCheckedAt" IS NOT NULL
      AND listings."readinessComputedAt" IS NOT NULL
      AND cardinality(listings.images) > 0
      AND cardinality(listings."readinessBlockers") = 0
      AND (listings.vin IS NULL OR listings."vehicleModelId" IS NOT NULL)
`

/** Appends the strict publish predicate to a raw query on `listings` when PUBLISH_GATE_STRICT=true. */
export function strictReadySql(): Prisma.Sql {
  return isPublishGateStrict() ? STRICT_READY_SQL : Prisma.empty
}
