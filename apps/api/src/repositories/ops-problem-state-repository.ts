import type { OpsProblemSource, PrismaClient } from '@wivwav/db'

export type ProblemSource = `${OpsProblemSource}`

export interface ObservedProblemInput {
  fingerprint: string
  source: ProblemSource
}

export interface OpsProblemStateRow {
  fingerprint: string
  source: ProblemSource
  firstSeenAt: Date
  lastSeenAt: Date
  occurrenceCount: number
  acknowledgedAt: Date | null
  acknowledgedBy: string | null
}

export interface OpsProblemStateRepository {
  /**
   * Persist one aggregation pass. A problem is "active" only when it appears in
   * the current pass (N=1 absent pass); rows are intentionally never deleted so
   * acknowledgement history survives resolved or flapping fingerprints.
   */
  recordPass(problems: ObservedProblemInput[], observedAt?: Date): Promise<OpsProblemStateRow[]>
  setAcknowledgement(input: {
    fingerprint: string
    acknowledged: boolean
    acknowledgedBy?: string | null
    acknowledgedAt?: Date
  }): Promise<OpsProblemStateRow | null>
}

export class PrismaOpsProblemStateRepository implements OpsProblemStateRepository {
  constructor(private readonly db: PrismaClient) {}

  async recordPass(
    problems: ObservedProblemInput[],
    observedAt = new Date(),
  ): Promise<OpsProblemStateRow[]> {
    const unique = dedupeObservedProblems(problems)

    return Promise.all(unique.map(problem => (
      this.db.opsProblemState.upsert({
        where: { fingerprint: problem.fingerprint },
        create: {
          fingerprint: problem.fingerprint,
          source: problem.source,
          firstSeenAt: observedAt,
          lastSeenAt: observedAt,
          occurrenceCount: 1,
        },
        update: {
          source: problem.source,
          lastSeenAt: observedAt,
          occurrenceCount: { increment: 1 },
        },
      })
    )))
  }

  async setAcknowledgement(input: {
    fingerprint: string
    acknowledged: boolean
    acknowledgedBy?: string | null
    acknowledgedAt?: Date
  }): Promise<OpsProblemStateRow | null> {
    const existing = await this.db.opsProblemState.findUnique({
      where: { fingerprint: input.fingerprint },
    })

    if (!existing) return null

    return this.db.opsProblemState.update({
      where: { fingerprint: input.fingerprint },
      data: input.acknowledged
        ? {
            acknowledgedAt: input.acknowledgedAt ?? new Date(),
            acknowledgedBy: input.acknowledgedBy ?? null,
          }
        : {
            acknowledgedAt: null,
            acknowledgedBy: null,
          },
    })
  }
}

function dedupeObservedProblems(problems: ObservedProblemInput[]): ObservedProblemInput[] {
  const byFingerprint = new Map<string, ObservedProblemInput>()
  for (const problem of problems) {
    if (!byFingerprint.has(problem.fingerprint)) {
      byFingerprint.set(problem.fingerprint, problem)
    }
  }
  return [...byFingerprint.values()]
}
