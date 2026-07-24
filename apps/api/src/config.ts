import { z } from 'zod'
import { DEFAULT_INDEX_NAME, validateIndexName } from '@wivwav/search'

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(4001),
  HOST: z.string().default('0.0.0.0'),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(100),
  DATABASE_URL: z.url(),
  MEILISEARCH_HOST: z.url().default('http://localhost:7700'),
  MEILISEARCH_API_KEY: z.string(),
  MEILISEARCH_INDEX_NAME: z.string().default(DEFAULT_INDEX_NAME).refine((value) => {
    try {
      validateIndexName(value)
      return true
    } catch {
      return false
    }
  }, 'MEILISEARCH_INDEX_NAME must contain only letters, numbers, underscores, and hyphens'),
  VALKEY_URL: z.string().default('redis://localhost:6379'),
  OLLAMA_BASE_URL: z.url().default('http://localhost:11434'),
  OLLAMA_REQUIRED: z.enum(['true', 'false']).default('false').transform(value => value === 'true'),
  // Loki log aggregation — used by the /admin/logs proxy endpoint
  LOKI_URL: z.url().default('http://localhost:3100'),
  // Grafana — used by the /internal/v1/grafana/alerts proxy endpoint (#890).
  // GRAFANA_API_TOKEN is optional: local dev's Grafana runs with anonymous
  // admin access (see docker-compose.yml's `obs` profile).
  GRAFANA_URL: z.url().default('http://localhost:3003'),
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
  CORS_ORIGIN: z.string().default('http://localhost:4000,http://localhost:3000').transform(v =>
    v.includes(',') ? v.split(',').map(s => s.trim()) : v
  ),
  // 32-byte hex string — required for secret config entries (AES-256-GCM encryption)
  CONFIG_ENCRYPTION_SECRET: z
    .string()
    .regex(/^[0-9a-fA-F]{64}$/, 'CONFIG_ENCRYPTION_SECRET must be a 64-character hex string (32 bytes)')
    .optional(),
  // Shared secret for server-to-server calls to /admin, /internal, and the
  // apps/web SSR bypass on /v1 (#453). Set the same value in every service
  // (web, CLI) that calls these endpoints. When unset, /admin is
  // unauthenticated in non-production and the /v1 bypass simply never
  // matches — only acceptable in local dev.
  INTERNAL_API_SECRET: z.string().min(16).optional(),
  // Signing secret for the Stripe webhook (`POST /webhooks/stripe`), from the
  // Stripe Dashboard's webhook endpoint config. When unset, the webhook
  // endpoint refuses all requests with 503 rather than accepting unverifiable payloads.
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
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
