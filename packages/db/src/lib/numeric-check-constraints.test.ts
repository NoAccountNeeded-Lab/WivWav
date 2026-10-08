import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// Guards the migration-only CHECK constraints from #1116: Prisma cannot
// express CHECKs, so nothing in the type system stops the migration file
// from being edited down to nothing. This pins every expected predicate.
// Live enforcement is proven by numeric-check-constraints.integration.test.ts.
// Resolved from the package directory: package test scripts run with
// cwd=packages/db (turbo, pnpm --filter, and vitest all preserve this).
const MIGRATION_SQL = readFileSync(
  join(
    process.cwd(),
    'prisma/migrations/20261008022814_add_numeric_range_check_constraints/migration.sql',
  ),
  'utf8',
)

const EXPECTED_PREDICATES = [
  'CHECK ("priceCents" >= 0)',
  'CHECK ("mileage" >= 0)',
  // No year CHECK by design: the ingestion quality pipeline is
  // store-then-quarantine for implausible years (validateListing flags
  // `implausible_year` as error-severity, decidePublication quarantines the
  // stored row). A DB CHECK would reject the row at INSERT time — see the
  // `quarantined-bad-year` (1800) row in fixture-to-facets.catalog.ts.
  'CHECK ("lat" BETWEEN -90 AND 90)',
  'CHECK ("lng" BETWEEN -180 AND 180)',
  'CHECK ("wheelchairCapacity" >= 0)',
  'CHECK ("floorLoweringInches" >= 0)',
  'CHECK ("missingFromCompleteCount" >= 0)',
  'CHECK ("confidence" BETWEEN 0 AND 1)',
  'CHECK ("avgLifespanMiles" >= 0)',
  'CHECK ("originalMsrpCents" >= 0)',
  'CHECK ("destinationFeeCents" >= 0)',
  'CHECK ("msrpCents" >= 0)',
  'CHECK ("overallRating" BETWEEN 1 AND 5)',
  'CHECK ("frontCrashRating" BETWEEN 1 AND 5)',
  'CHECK ("sideCrashRating" BETWEEN 1 AND 5)',
  'CHECK ("rolloverRating" BETWEEN 1 AND 5)',
  'CHECK ("rating" BETWEEN 0 AND 5)',
  'CHECK ("reviewCount" >= 0)',
  'CHECK ("rating" BETWEEN 1 AND 5)',
  'CHECK ("position" >= 0)',
  'CHECK ("widthPx" >= 0)',
  'CHECK ("heightPx" >= 0)',
]

describe('numeric check-constraint migration', () => {
  it('should define every expected CHECK predicate', () => {
    for (const predicate of EXPECTED_PREDICATES) {
      expect(MIGRATION_SQL).toContain(predicate)
    }
  })

  it('should not define any year CHECK (store-then-quarantine contract)', () => {
    expect(MIGRATION_SQL).not.toContain('CHECK ("year"')
  })

  it('should add each constraint NOT VALID and validate it', () => {
    const adds = MIGRATION_SQL.match(/ADD CONSTRAINT "\S+" CHECK \(/g) ?? []
    const validates = MIGRATION_SQL.match(/VALIDATE CONSTRAINT "\S+"/g) ?? []
    expect(adds.length).toBe(28)
    expect(validates.length).toBe(adds.length)
    expect(MIGRATION_SQL).toContain('NOT VALID')
  })
})
