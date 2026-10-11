import type { JobRecord, QueueAdapter } from '@wivwav/queue'
import { QUEUES } from '@wivwav/queue'

export const SOURCE_SCOPED_QUEUES = new Set<string>([
  QUEUES.DETAIL_CRAWL,
  QUEUES.DETAIL_EXTRACT,
])

export function latestByCreatedAt(jobs: JobRecord[]): JobRecord | undefined {
  return [...jobs].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0]
}

export function isJobForSource(job: JobRecord, sourceId: string): boolean {
  const data = job.data
  return typeof data === 'object' && data !== null && (data as Record<string, unknown>)['sourceId'] === sourceId
}

export function getQueueOrThrow(queues: Map<string, QueueAdapter>, name: string): QueueAdapter {
  const queue = queues.get(name)
  if (!queue) throw new Error(`Queue "${name}" is not registered`)
  return queue
}
