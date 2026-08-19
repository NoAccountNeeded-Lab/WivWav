import { BullMQQueueFactory } from '@wivwav/queue'
import type { QueueFactory } from '@wivwav/queue'

let factory: QueueFactory | undefined

/**
 * Lazily-constructed singleton `QueueFactory`, mirroring `lib/meili.ts`'s
 * singleton pattern so operational read-only jobs (e.g. the listing-quality
 * audit's queue-backlog check) can query queue stats without every caller
 * standing up its own Redis connection.
 */
export function getQueueFactory(): QueueFactory {
  factory ??= new BullMQQueueFactory()
  return factory
}
