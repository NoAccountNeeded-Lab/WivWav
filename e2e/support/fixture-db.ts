import { PrismaClient } from '@wivwav/db'
import { PrismaPg } from '@prisma/adapter-pg'
import { Pool } from 'pg'
import { databaseUrl } from './compose.js'

export const fixtureListingId = 'e2e-smoke-listing-1'
export const fixtureSourceId = 'e2e-smoke-source'

/** Runs `fn` with a short-lived Prisma client against the E2E database. */
export async function withE2eDb<T>(fn: (db: PrismaClient) => Promise<T>): Promise<T> {
  process.env['DATABASE_URL'] = databaseUrl()

  const pool = new Pool({ connectionString: databaseUrl(), max: 1 })
  const db = new PrismaClient({ adapter: new PrismaPg(pool) })
  try {
    return await fn(db)
  } finally {
    await db.$disconnect()
    await pool.end()
  }
}
