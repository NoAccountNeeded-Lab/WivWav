import { z } from 'zod'
import { DEFAULT_INDEX_NAME, validateIndexName } from '@wivwav/search'

// Compose files pass unset optional variables as "" (`${VAR:-}`). For URL variables with a
// default, "" is never valid, so treat it as unset (#1150). Variables where "" is meaningful
// (MEILISEARCH_API_KEY, CORS_ORIGIN) are deliberately left alone.
const urlWithDefault = (fallback: string) =>
  z.preprocess((value) => (value === '' ? undefined : value), z.url().default(fallback))

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(4001),
  HOST: z.string().default('0.0.0.0'),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(100),
  DATABASE_URL: z.url(),
  WAV_SHOPPING_FILTERS_ENABLED: z.enum(['true', 'false']).default('false').transform((value) => value === 'true'),
  MEILISEARCH_HOST: urlWithDefault('http://localhost:7700'),
  MEILISEARCH_API_KEY: z.string(),
  MEILISEARCH_INDEX_NAME: z
    .string()
    .optional()
    .transform((value) => value ?? DEFAULT_INDEX_NAME)
    .refine((value) => {
      try {
        validateIndexName(value)
        return true
      } catch {
        return false
      }
    }, 'MEILISEARCH_INDEX_NAME must contain only letters, numbers, underscores, and hyphens'),
  VALKEY_URL: z.string().default('redis://localhost:6379'),
  OLLAMA_BASE_URL: urlWithDefault('http://localhost:11434'),
  OLLAMA_REQUIRED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  // Loki log aggregation — used by the /internal/ops/logs proxy endpoint
  LOKI_URL: urlWithDefault('http://localhost:3100'),
  LOKI_AUTHORIZATION: z.string().optional(),
  // Grafana — used by the /internal/v1/grafana/alerts proxy endpoint (#890).
  // GRAFANA_API_TOKEN is optional: local dev's Grafana runs with anonymous
  // admin access (see docker-compose.yml's `obs` profile).
  GRAFANA_URL: urlWithDefault('http://localhost:3003'),
  GRAFANA_API_TOKEN: z.string().optional(),
  // Sentry issues API — used by the /internal/v1/sentry/issues proxy endpoint
  // (#890). Deliberately distinct from apps/web's SENTRY_AUTH_TOKEN/
  // SENTRY_ORG/SENTRY_PROJECT (build-time-only, source-map upload scope) —
  // this is a separate, narrower-scoped read token for apps/api. All three
  // are optional; the route reports itself unavailable rather than failing
  // to start when any are unset.
  SENTRY_ISSUES_AUTH_TOKEN: z.string().optional(),
  SENTRY_ISSUES_ORG: z.string().optional(),
  SENTRY_ISSUES_PROJECT: z.string().optional(),
  CORS_ORIGIN: z
    .string()
    .default('http://localhost:4000,http://localhost:3000')
    .transform((v) => (v.includes(',') ? v.split(',').map((s) => s.trim()) : v)),
  // 32-byte hex string — required for secret config entries (AES-256-GCM encryption)
  CONFIG_ENCRYPTION_SECRET: z
    .string()
    .regex(
      /^[0-9a-fA-F]{64}$/,
      'CONFIG_ENCRYPTION_SECRET must be a 64-character hex string (32 bytes)',
    )
    .optional(),
  // Web product and bounded model-config reads only.
  // This credential never authorizes operator or diagnostic routes.
  INTERNAL_API_SECRET: z.string().min(16).optional(),
  // Existing worker protocol identity, held by API and worker clients only.
  WORKER_API_SECRET: z.string().min(16).optional(),
  // Operator identity; provision only to API and ops, never the web service.
  OPS_API_SECRET: z.string().min(16).optional(),
  // Narrow read-only desktop AI identity. Diagnostics also accepts OPS,
  // but never INTERNAL; missing diagnostic identity fails closed in production.
  DIAGNOSTIC_API_SECRET: z.string().min(16).optional(),
  // Signing secret for the Stripe webhook (`POST /webhooks/stripe`), from the
  // Stripe Dashboard's webhook endpoint config. When unset, the webhook
  // endpoint refuses all requests with 503 rather than accepting unverifiable payloads.
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  // #948 worker gateway: when 'true', apps/api registers as the BullMQ
  // consumer for the three browser-job queues and exposes the /internal/workers
  // WS dispatch endpoint + /internal/scraper ingest routes. Production must
  // set this true after #953; default false keeps local/test API startup
  // opt-in. apps/scraper no longer provides fallback browser-job consumers.
  WORKER_GATEWAY_ENABLED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  // Set only when every request arrives through a trusted proxy (the production
  // edge) that overwrites X-Forwarded-For; otherwise clients could spoof req.ip.
  TRUST_PROXY: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  // How long the coordinator waits for a dispatched remote job's completion
  // callback before failing the queue job so BullMQ retries it. Browser jobs
  // legitimately run for many minutes (batched crawls + rate-limit sleeps).
  WORKER_JOB_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(45 * 60_000),
  JOB_RUN_MAX_AGE_MS: z.coerce.number().int().positive().default(6 * 60 * 60_000),
  // Deployed commit SHA, set by the deploy pipeline (e.g. `GIT_SHA=$(git rev-parse HEAD)`
  // as a build/run arg). Surfaced verbatim by `GET /diagnostics/diagnostic-context`
  // (#775) as fixed-size revision metadata; 'unknown' in local dev where no
  // pipeline sets it.
  GIT_SHA: z.string().default('unknown'),
}).superRefine((config, context) => {
  const identities = ['INTERNAL_API_SECRET', 'OPS_API_SECRET', 'DIAGNOSTIC_API_SECRET', 'WORKER_API_SECRET'] as const
  for (let i = 0; i < identities.length; i++) {
    for (const other of identities.slice(i + 1)) {
      const identity = identities[i]
      if (identity && config[identity] && config[identity] === config[other]) {
        context.addIssue({ code: 'custom', path: [other], message: 'Service identities must use distinct credentials' })
      }
    }
  }
})

export type Config = z.infer<typeof schema>

export function loadConfig(): Config {
  const result = schema.safeParse(process.env)
  if (!result.success) {
    const missing = result.error.issues.map((i) => i.path.join('.')).join(', ')
    throw new Error(`Invalid environment configuration. Missing or invalid: ${missing}`)
  }
  return result.data
}
