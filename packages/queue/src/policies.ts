import { QUEUES, type QueueName } from './queues.js'

export interface QueueRetentionPolicy {
  completed: number
  failed: number
}

export interface QueuePolicy {
  concurrency: number
  retention: QueueRetentionPolicy
}

const DEFAULT_RETENTION: QueueRetentionPolicy = {
  completed: 100,
  failed: 500,
}

function policy(
  concurrency: number,
  retention: Partial<QueueRetentionPolicy> = {},
): QueuePolicy {
  return {
    concurrency,
    retention: {
      completed: retention.completed ?? DEFAULT_RETENTION.completed,
      failed: retention.failed ?? DEFAULT_RETENTION.failed,
    },
  }
}

export const QUEUE_POLICIES: Record<QueueName, QueuePolicy> = {
  [QUEUES.SOURCE_SCRAPE]: policy(1, { completed: 50, failed: 200 }),
  [QUEUES.DETAIL_CRAWL]: policy(2, { completed: 100, failed: 300 }),
  [QUEUES.DETAIL_EXTRACT]: policy(2, { completed: 100, failed: 300 }),
  [QUEUES.GEOCODE]: policy(1),
  [QUEUES.DEDUPLICATE]: policy(1),
  [QUEUES.VIN_ENRICH]: policy(1),
  [QUEUES.NHTSA_RECALLS]: policy(1),
  [QUEUES.NHTSA_COMPLAINTS]: policy(1),
  [QUEUES.NHTSA_SAFETY_RATINGS]: policy(1),
  [QUEUES.NHTSA_INVESTIGATIONS]: policy(1),
  [QUEUES.NHTSA_MANUFACTURER_COMMUNICATIONS]: policy(1),
  [QUEUES.DEALER_ENRICH]: policy(1),
  [QUEUES.VEHICLE_STATS_REFRESH]: policy(1, { completed: 20, failed: 100 }),
  [QUEUES.MODEL_RESEARCH]: policy(1),
  [QUEUES.LISTING_SYNC]: policy(1, { completed: 20, failed: 100 }),
  [QUEUES.LISTING_INDEX_POLL]: policy(1, { completed: 20, failed: 100 }),
  [QUEUES.LISTING_RESOLVE]: policy(2, { completed: 100, failed: 300 }),
  [QUEUES.RAWPAGE_CLEANUP]: policy(1, { completed: 20, failed: 100 }),
  [QUEUES.CONVERSION_BRANDS_SEED]: policy(1, { completed: 20, failed: 100 }),
  [QUEUES.NMEDA_DEALERS_SEED]: policy(1, { completed: 20, failed: 100 }),
  [QUEUES.FUELECONOMY_MSRP]: policy(1),
}

export function getQueuePolicy(name: string): QueuePolicy {
  const known = QUEUE_POLICIES[name as QueueName]
  return known ?? policy(1)
}
