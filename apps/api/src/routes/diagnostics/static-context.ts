import type { AttentionConditionCode, AttentionSignalKey } from '@wivwav/types'

/**
 * Mostly-static content served by `GET /diagnostics/diagnostic-context`
 * (#775, Q1/Q7 from #757). This module is deliberately free of any DB/queue/
 * fetch calls — every export here is a plain literal so the route's response
 * is fixed-size and identical across requests within a deployment (the only
 * thing that varies between deployments is `revision`, assembled in
 * `context.ts` from `Config`, not from here).
 *
 * Bump `CONTENT_VERSION` whenever any literal below changes materially, so a
 * caller that cached a previous response can detect staleness.
 */
export const CONTENT_VERSION = 1

export interface ServiceGlossaryEntry {
  name: string
  kind: 'app' | 'queue' | 'infra'
  description: string
}

export const SERVICE_GLOSSARY: ServiceGlossaryEntry[] = [
  { name: 'api', kind: 'app', description: 'Fastify REST API. Owns /v1 public endpoints, /admin operator endpoints, and this /diagnostics gateway.' },
  { name: 'scraper', kind: 'app', description: 'Playwright-based scraper and Ollama-backed selector remapping. Runs as BullMQ workers, not an HTTP service.' },
  { name: 'ops', kind: 'app', description: 'Next.js operations UI. Calls the API as a client; never accesses the database directly.' },
  { name: 'web', kind: 'app', description: 'Next.js public-facing listing search UI. Calls the API as a client; never accesses the database directly.' },
  { name: 'source-scrape', kind: 'queue', description: 'Fetches a source\'s listing index page(s) and enqueues detail-crawl/detail-extract for each listing found.' },
  { name: 'detail-crawl', kind: 'queue', description: 'Playwright-renders a single listing detail page and stores the raw HTML for extraction.' },
  { name: 'detail-extract', kind: 'queue', description: 'Parses a stored raw listing page into structured fields, optionally invoking Ollama for AI-assisted extraction.' },
  { name: 'geocode', kind: 'queue', description: 'Resolves a listing\'s city/state into map coordinates.' },
  { name: 'deduplicate', kind: 'queue', description: 'VIN-based cross-source listing deduplication.' },
  { name: 'vin-enrich', kind: 'queue', description: 'Enriches a listing with NHTSA vPIC decode data from its VIN.' },
  { name: 'listing-sync', kind: 'queue', description: 'Rebuilds the Meilisearch search index from Postgres (versioned index + atomic swap).' },
  { name: 'nhtsa-recalls', kind: 'queue', description: 'Refreshes NHTSA recall data.' },
  { name: 'nhtsa-complaints', kind: 'queue', description: 'Refreshes NHTSA complaint data.' },
  { name: 'nhtsa-safety-ratings', kind: 'queue', description: 'Refreshes NHTSA safety rating data.' },
  { name: 'postgres', kind: 'infra', description: 'Primary datastore for listings, sources, runs, schedules, job-run lineage, and operator state.' },
  { name: 'valkey', kind: 'infra', description: 'Cache and BullMQ backing store.' },
  { name: 'meilisearch', kind: 'infra', description: 'Search index backing public listing search and facets.' },
  { name: 'ollama', kind: 'infra', description: 'Local LLM runtime used for AI-assisted selector remapping. Optional — its absence degrades, not blocks, scraping.' },
  { name: 'loki', kind: 'infra', description: 'Log aggregation queried by /admin/logs and this diagnostic gateway\'s get_correlation/get_system_snapshot.' },
]

export interface SignalGlossaryEntry {
  key: AttentionSignalKey
  description: string
}

/** Explains each key `get_system_snapshot`'s `signalAvailability` reports. */
export const SIGNAL_GLOSSARY: SignalGlossaryEntry[] = [
  { key: 'health', description: 'Whether GET /health (the aggregate service probe: postgres, meilisearch, valkey, ollama, scraper freshness) responded.' },
  { key: 'bullmq', description: 'Whether BullMQ queue state (stats, pause state) was readable.' },
  { key: 'db', description: 'Whether Postgres-backed reads (sources, scraper runs, schedule intents) succeeded.' },
  { key: 'loki', description: 'Whether the Loki log backend was reachable for this request.' },
]

export interface RunbookIndexEntry {
  /** The `AttentionCondition.code` this runbook entry addresses, when the
   *  condition maps to a known operator playbook. */
  conditionCode: AttentionConditionCode | null
  title: string
  symptom: string
  firstCheck: string
}

/**
 * A condensed index of the ops UI's runbooks (`apps/ops/src/app/ops/runbooks.ts`),
 * keyed by the condition code `get_system_snapshot` reports so a caller can
 * go straight from a condition to "what to check first" without needing
 * ops-UI-relative navigation (hrefs, button labels) that means nothing to an
 * external AI client. Full remediation steps live in the ops runbooks and
 * `docs/ops/*`; this is deliberately just an index.
 */
export const RUNBOOK_INDEX: RunbookIndexEntry[] = [
  { conditionCode: 'service_unhealthy', title: 'A service is unhealthy', symptom: 'health.services.<name>.status is degraded or down.', firstCheck: 'Read the service\'s message/lastRunAt/latencyMs; correlate with get_correlation(idType=requestId) for the failing request if one is known.' },
  { conditionCode: 'source_needs_remap', title: 'Source needs remapping', symptom: 'A source\'s status is needs_remapping.', firstCheck: 'Confirm Ollama is reachable (health.services.ollama) before assuming AI remapping can recover it.' },
  { conditionCode: 'source_error', title: 'A source stopped working', symptom: 'A source\'s status is error, or its last scrape produced no listings.', firstCheck: 'get_correlation(idType=sourceId) for that source\'s recent runs and pipeline stage failures.' },
  { conditionCode: 'source_inventory_discrepancy', title: 'Source inventory discrepancy', symptom: 'possiblyGoneCount is a large fraction of a source\'s active listingCount.', firstCheck: 'This is a safety brake, not necessarily a broken scraper — check whether the source\'s live index genuinely shrank before assuming a bug.' },
  { conditionCode: 'queue_failed_jobs', title: 'Jobs are failing', symptom: 'A queue reports stats.failed > 0.', firstCheck: 'get_correlation(idType=jobId) for a specific failed job id to see its failedReason plus surrounding logs.' },
  { conditionCode: 'queue_paused', title: 'A queue is paused', symptom: 'A queue reports paused: true.', firstCheck: 'Paused queues stop new work but do not fail existing jobs — confirm whether the pause was intentional before treating it as an incident.' },
  { conditionCode: 'schedule_disabled', title: 'A schedule is disabled', symptom: 'A schedule reports enabled: false.', firstCheck: 'Expected recurring work will not fire until re-enabled; check whether disablement was deliberate (e.g. incident response) first.' },
  { conditionCode: 'schedule_failed', title: 'A schedule has recent failures', symptom: 'A schedule reports recentFailureCount > 0.', firstCheck: 'Correlate the schedule\'s queue with get_correlation(idType=jobId) for its most recent failed job.' },
  { conditionCode: 'scraper_no_successful_run', title: 'No successful scrape on record', symptom: 'Recent run history has no completed successful run.', firstCheck: 'Check whether any source-scrape job has run at all recently, vs. every run failing.' },
  { conditionCode: 'scraper_stale_run', title: 'Stale scrape', symptom: 'The last successful scrape finished more than 24h (warning) or 48h (critical) ago.', firstCheck: 'Confirm the source-scrape schedule is enabled and its queue is not paused before investigating individual sources.' },
  { conditionCode: 'geocode_failed', title: 'Geocode jobs failing', symptom: 'The geocode queue reports stats.failed > 0.', firstCheck: 'Map pins may be incomplete for recently added listings; correlate a specific failed geocode jobId.' },
  { conditionCode: 'geocode_paused', title: 'Geocode paused', symptom: 'The geocode queue reports paused: true.', firstCheck: 'New listings will not receive coordinates until this queue resumes.' },
  { conditionCode: null, title: 'A backend is unreachable', symptom: 'signalAvailability reports a key as unavailable.', firstCheck: 'An unavailable signal means the corresponding condition set is incomplete, not that nothing is wrong — treat absence of a condition from that signal as unknown, not as "healthy".' },
]

/** Read-only, allow-listed-only constraints every /diagnostics/* route enforces. */
export const SAFETY_RULES: string[] = [
  'Every /diagnostics/* route is read-only: no route accepts a mutation, and none will ever be added to this scope.',
  'No route accepts arbitrary SQL, LogQL, URLs, or filesystem paths — only allow-listed typed filters (e.g. get_correlation\'s idType) with bounded time windows and result counts.',
  'No response includes decrypted configuration, credentials, cookies, or tokens. If a value looks credential-shaped in upstream data, treat its presence in a response as a bug, not a feature.',
  'get_system_snapshot windows are capped at 24 hours and default to 1 hour; get_correlation caps returned log lines at 100 with a truncation marker when more matched.',
  'DIAGNOSTIC_API_SECRET (this scope\'s credential) grants no access to /admin/*, /internal/v1/*, or /internal/ops/* — those require the separate, more privileged INTERNAL_API_SECRET.',
]

/**
 * The response shape an AI client calling this gateway should structure its
 * own findings in — informational only; the API does not enforce or parse
 * this from any request. Ratified in #757 (Q2).
 */
export const RESPONSE_PROTOCOL = {
  description: 'When reasoning over evidence from get_system_snapshot/get_correlation, structure findings as facts, hypotheses, unknowns, and next checks rather than asserting a diagnosis outright.',
  fields: {
    facts: 'Directly observed values from tool responses (condition codes, signalAvailability, log lines) — no inference.',
    hypotheses: 'Candidate explanations for the facts, each phrased so it could be disproven by a further check.',
    unknowns: 'Signals that were unavailable (per signalAvailability) or evidence that would help but was not fetched.',
    nextChecks: 'Specific follow-up tool calls (e.g. get_correlation with a particular idType/id) that would confirm or rule out a hypothesis.',
  },
} as const
