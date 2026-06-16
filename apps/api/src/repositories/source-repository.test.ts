import { describe, expect, it, vi } from 'vitest'
import { PrismaSourceRepository } from './source-repository.js'

function buildDb(overrides: Record<string, unknown> = {}) {
  return {
    source: {
      count: vi.fn(async () => 0),
      findMany: vi.fn(async () => []),
      findUnique: vi.fn(async () => null),
      ...overrides,
    },
  }
}

describe('PrismaSourceRepository.findManyByIds', () => {
  it('returns an empty array immediately without calling Prisma when ids is empty', async () => {
    const db = buildDb()
    const repo = new PrismaSourceRepository(db as never)
    const result = await repo.findManyByIds([])
    expect(result).toEqual([])
    expect(db.source.findMany).not.toHaveBeenCalled()
  })

  it('calls Prisma with an IN filter when ids are provided', async () => {
    const rows = [{ id: 'src-1', name: 'Source One' }]
    const db = buildDb({ findMany: vi.fn(async () => rows) })
    const repo = new PrismaSourceRepository(db as never)
    const result = await repo.findManyByIds(['src-1'])
    expect(result).toEqual(rows)
    expect(db.source.findMany).toHaveBeenCalledWith({
      where: { id: { in: ['src-1'] } },
      select: { id: true, name: true },
    })
  })
})

describe('PrismaSourceRepository.count / countActive', () => {
  it('count calls Prisma without a where clause', async () => {
    const db = buildDb({ count: vi.fn(async () => 5) })
    const repo = new PrismaSourceRepository(db as never)
    expect(await repo.count()).toBe(5)
    expect(db.source.count).toHaveBeenCalledWith()
  })

  it('countActive calls Prisma with status:active filter', async () => {
    const db = buildDb({ count: vi.fn(async () => 3) })
    const repo = new PrismaSourceRepository(db as never)
    expect(await repo.countActive()).toBe(3)
    expect(db.source.count).toHaveBeenCalledWith({ where: { status: 'active' } })
  })
})
