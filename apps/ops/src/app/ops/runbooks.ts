export const OPS_RUNBOOK_IDS = [
  'listings-missing-from-map',
  'search-results-look-stale',
  'source-stopped-working',
  'source-quality-drift',
  'jobs-are-failing',
  'schedules-are-disabled',
  'ai-remapping-unavailable',
] as const

export const DEPLOYMENT_RUNBOOK_IDS = [
  'crawl-freshness-deployment',
] as const

export type OpsRunbookId = (typeof OPS_RUNBOOK_IDS)[number]
export type DeploymentRunbookId = (typeof DEPLOYMENT_RUNBOOK_IDS)[number]

export interface OpsRunbookStep {
  text: string
  href?: string
  actionLabel?: string
}

export interface OpsRunbook {
  id: OpsRunbookId | DeploymentRunbookId
  title: string
  symptom: string
  steps: OpsRunbookStep[]
  escalation: string
}

export const OPS_RUNBOOKS: Record<OpsRunbookId, OpsRunbook> = {
  'listings-missing-from-map': {
    id: 'listings-missing-from-map',
    title: 'Listings missing from map',
    symptom: 'New listings are searchable, but pins do not appear on the map.',
    steps: [
      {
        text: 'Confirm the source has fresh listings or run the source scrape.',
        href: '/ops/sources',
        actionLabel: 'Open sources',
      },
      {
        text: 'Open Queues, find geocode, and use Trigger to fill missing coordinates.',
        href: '/ops/queues',
        actionLabel: 'Trigger geocode',
      },
      {
        text: 'After geocoding completes, use Sync Meilisearch on the Queues page so coordinates reach search.',
        href: '/ops/queues',
        actionLabel: 'Sync Meilisearch',
      },
    ],
    escalation: 'If pins are still missing, check Logs for geocode errors and source locations without city/state.',
  },
  'search-results-look-stale': {
    id: 'search-results-look-stale',
    title: 'Search results look stale',
    symptom: 'The source table or database changed, but public search still shows old listings or counts.',
    steps: [
      {
        text: 'Check recent scraper runs for the source and run it now if needed.',
        href: '/ops/runs',
        actionLabel: 'Review runs',
      },
      {
        text: 'Open Queues and use Sync Meilisearch to rebuild the search index from Postgres.',
        href: '/ops/queues',
        actionLabel: 'Sync Meilisearch',
      },
      {
        text: 'Refresh the user-facing search after the sync success message reports the listing count.',
        href: '/filters',
        actionLabel: 'Open search',
      },
    ],
    escalation: 'If sync fails or counts still disagree, inspect Logs for API, scraper, or search-index errors.',
  },
  'source-stopped-working': {
    id: 'source-stopped-working',
    title: 'A source stopped working',
    symptom: 'A source shows error or needs_remapping, or the last scrape stopped producing listings.',
    steps: [
      {
        text: 'Open Sources and read the status, last scraped time, listing count, and error message.',
        href: '/ops/sources',
        actionLabel: 'Open sources',
      },
      {
        text: 'Use Run Now after a transient outage or source fix, then watch progress on Scraper Runs.',
        href: '/ops/sources',
        actionLabel: 'Run source',
      },
      {
        text: 'If the source needs remapping, open AI and use Remap Now after confirming AI is available.',
        href: '/ops/ai',
        actionLabel: 'Open AI',
      },
    ],
    escalation: 'If Run Now keeps failing, filter Logs by scraper and search for the source name before changing selectors.',
  },
  'source-quality-drift': {
    id: 'source-quality-drift',
    title: 'Source paused for quality drift',
    symptom: 'A run failed with "Source quality drifted abruptly" and the source shows status paused. This is a safety brake, not necessarily a broken scraper: it fires when a run\'s error or missing-field rate jumps more than 15 points above that source\'s rolling baseline.',
    steps: [
      {
        text: 'Read the failure reason on the run for the exact rate comparison (e.g. missing rate 40% vs baseline 24%), then spot-check a few of that source\'s live listing pages to see whether the site actually changed (new price-hiding pattern, layout change) or the scraper selectors broke.',
        href: '/ops/runs',
        actionLabel: 'Review scraper runs',
      },
      {
        text: 'If the site genuinely changed and the scraper is extracting correctly (e.g. more listings now legitimately have no price), no code fix is needed — use Run Now a few times to let the rolling baseline catch up, or edit the source to accept the new baseline immediately.',
        href: '/ops/sources',
        actionLabel: 'Open sources',
      },
      {
        text: 'If selectors broke instead, treat it like the source-stopped-working runbook: fix extraction, then Run Now to confirm the rate returns to baseline before leaving it unattended.',
        href: '/ops/sources',
        actionLabel: 'Open sources',
      },
    ],
    escalation: 'If the rate keeps drifting run over run with no clear site change, check Logs for the source for other quality issues before assuming it is safe to let the baseline re-adapt.',
  },
  'jobs-are-failing': {
    id: 'jobs-are-failing',
    title: 'Jobs are failing',
    symptom: 'A queue or schedule shows recent failures, failed job counts, or repeated error messages.',
    steps: [
      {
        text: 'Open Queues and expand Activity for the affected row to read recent failure reasons and logs.',
        href: '/ops/queues',
        actionLabel: 'Open queues',
      },
      {
        text: 'Use Bull Board from the Queues page only when you need the full payload, retry count, or stack trace.',
        href: '/ops/queues',
        actionLabel: 'Open Bull Board',
      },
      {
        text: 'Check Logs for the same queue, jobId, sourceId, or requestId before retrying.',
        href: '/ops/logs',
        actionLabel: 'Open logs',
      },
    ],
    escalation: 'Pause only the affected queue if failures are causing bad writes; otherwise keep healthy queues running.',
  },
  'schedules-are-disabled': {
    id: 'schedules-are-disabled',
    title: 'Schedules are disabled',
    symptom: 'Expected recurring work is not firing, or a schedule row is marked Disabled.',
    steps: [
      {
        text: 'Open Schedules and confirm the disabled row, next run, last run, and recent failures.',
        href: '/ops/schedules',
        actionLabel: 'Open schedules',
      },
      {
        text: 'Use Enable to restore the schedule, or Edit if the cron pattern is wrong.',
        href: '/ops/schedules',
        actionLabel: 'Enable schedule',
      },
      {
        text: 'Use Queues to trigger the job immediately when waiting for the next scheduled run would delay recovery.',
        href: '/ops/queues',
        actionLabel: 'Trigger job',
      },
    ],
    escalation: 'If a restored schedule disables again, inspect recent failures before editing the cron pattern.',
  },
  'ai-remapping-unavailable': {
    id: 'ai-remapping-unavailable',
    title: 'AI remapping is unavailable',
    symptom: 'Remap Now cannot recover a source because Ollama, the selected model, or AI config is unavailable.',
    steps: [
      {
        text: 'Open AI and confirm Ollama is available and the selected remapping model is installed.',
        href: '/ops/ai',
        actionLabel: 'Open AI',
      },
      {
        text: 'Open AI Config when provider, model, or secret references need correction.',
        href: '/ops/config',
        actionLabel: 'Open AI Config',
      },
      {
        text: 'Check Logs for scraper.structure or scraper.remap errors before running the source again.',
        href: '/ops/logs',
        actionLabel: 'Open logs',
      },
    ],
    escalation: 'If AI remains unavailable, avoid repeated remap attempts and leave the source visible as needs_remapping.',
  },
}

export const DEPLOYMENT_RUNBOOKS: Record<DeploymentRunbookId, OpsRunbook> = {
  'crawl-freshness-deployment': {
    id: 'crawl-freshness-deployment',
    title: 'Crawl freshness deployment (issue #514)',
    symptom: 'Deploying the crawl-freshness migration (#514) or rolling it back. Also covers post-release smoke checks when possibly_gone counts seem wrong.',
    steps: [
      {
        text: 'DEPLOY: Run the Prisma migration (20260629120000_add_crawl_freshness_tracking) on the target database before starting the new scraper. The migration is additive — existing rows are unaffected until the backfill runs.',
        href: '/ops/runs',
        actionLabel: 'Review scraper runs',
      },
      {
        text: 'BACKFILL: After deployment, run the backfill-missing-count job once to set missingFromCompleteCount=1 for all pre-existing possibly_gone rows. This prevents the detail-extract job from falsely restoring them to active. The job reports candidate counts per source before writing.',
        href: '/ops/queues',
        actionLabel: 'Trigger backfill-missing-count',
      },
      {
        text: 'SMOKE CHECK: Open Sources and verify that lastFullCrawlAt is populated after the next scheduled scrape runs. The possiblyGoneCount column should trend downward as complete crawls confirm gone status.',
        href: '/ops/sources',
        actionLabel: 'Open sources',
      },
      {
        text: 'SMOKE CHECK: Confirm no mass false-gone transition occurred: check that the gone count for BLVD and MobilityWorks did not spike by more than ~10% in a single run. If it did, pause the source-scrape schedule and investigate.',
        href: '/ops/runs',
        actionLabel: 'Review scraper runs',
      },
      {
        text: 'ROLLBACK: If a rollback is needed, redeploy the previous scraper image. The new columns (lastFullCrawlAt, lastObservedAt, missingFromCompleteCount, lastSeenInCompleteCrawlAt) are nullable/defaulted and can be left in place — they will simply be ignored by the old code.',
        href: '/ops/runs',
        actionLabel: 'Review scraper runs',
      },
    ],
    escalation: 'If possibly_gone rows are not resolving after 3 scheduled full crawls, check that lastFullCrawlAt is being updated and that the full-crawl interval (default 24h) has elapsed.',
  },
}

export const OVERVIEW_RUNBOOK_IDS = OPS_RUNBOOK_IDS

export const QUEUE_RUNBOOK_IDS: OpsRunbookId[] = [
  'listings-missing-from-map',
  'search-results-look-stale',
  'jobs-are-failing',
  'schedules-are-disabled',
]

export const SOURCE_RUNBOOK_IDS: OpsRunbookId[] = [
  'source-stopped-working',
  'source-quality-drift',
  'listings-missing-from-map',
  'search-results-look-stale',
  'ai-remapping-unavailable',
]

export const SCHEDULE_RUNBOOK_IDS: OpsRunbookId[] = [
  'schedules-are-disabled',
  'jobs-are-failing',
]

export const LOG_RUNBOOK_IDS: OpsRunbookId[] = [
  'jobs-are-failing',
  'source-stopped-working',
  'source-quality-drift',
  'ai-remapping-unavailable',
]

export const AI_RUNBOOK_IDS: OpsRunbookId[] = [
  'ai-remapping-unavailable',
  'source-stopped-working',
]

export function getOpsRunbooks(ids: readonly OpsRunbookId[]): OpsRunbook[] {
  return ids.map(id => OPS_RUNBOOKS[id])
}
