import { PrismaClient } from './generated/prisma/index.js'
import { PrismaPg } from '@prisma/adapter-pg'
import { Pool } from 'pg'

let prisma: PrismaClient | undefined

export function getDb(): PrismaClient {
  if (!prisma) {
    // DATABASE_POOL_SIZE should be set to at least the number of concurrent DB-writing
    // workers in apps/scraper (currently 21 workers × default concurrency 1 = 21 jobs).
    // Default 25 gives a small headroom above the scraper worker count.
    // Without an explicit max the pg default of 10 starves the pool under concurrent writes
    // and causes Prisma P2028 "Transaction already closed" errors.
    const rawPoolSize = process.env['DATABASE_POOL_SIZE']
    const parsedPoolSize = rawPoolSize !== undefined ? parseInt(rawPoolSize, 10) : NaN
    const poolMax = !isNaN(parsedPoolSize) && parsedPoolSize > 0 ? parsedPoolSize : 25
    const pool = new Pool({ connectionString: process.env['DATABASE_URL'], max: poolMax })
    const adapter = new PrismaPg(pool)
    prisma = new PrismaClient({
      adapter,
      log:
        process.env['DATABASE_DEBUG'] === 'true'
          ? ['query', 'error', 'warn']
          : process.env['NODE_ENV'] === 'development'
            ? ['error', 'warn']
            : ['error'],
    })
  }
  return prisma
}

export async function disconnectDb(): Promise<void> {
  if (prisma) {
    await prisma.$disconnect()
    prisma = undefined
  }
}
