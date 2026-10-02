import { getServerApiBaseUrl } from './api-url'
import { apiFetch } from './api-fetch'

export interface EbayCredentials {
  appId: string
  certId: string
  environment: 'production' | 'sandbox'
}

/**
 * Resolves the eBay Motors Browse API credentials via the API's
 * server-to-server-only `/admin/config/:key/decrypt` endpoint (#999) —
 * mirrors resolve-ollama-config.ts's pattern of letting an ops server route
 * pull decrypted config through `apiFetch` rather than giving apps/ops its
 * own Prisma/ConfigService access. Returns null when the app-id/cert-id
 * keys aren't configured yet (not an error — the source may simply not be
 * set up in this environment).
 */
export async function resolveEbayCredentials(): Promise<EbayCredentials | null> {
  const apiBase = getServerApiBaseUrl()

  const [appIdRes, certIdRes, envRes] = await Promise.all([
    apiFetch(`${apiBase}/admin/config/ebay.motors.app-id/decrypt`, { cache: 'no-store' }),
    apiFetch(`${apiBase}/admin/config/ebay.motors.cert-id/decrypt`, { cache: 'no-store' }),
    apiFetch(`${apiBase}/admin/config/ebay.motors.environment`, { cache: 'no-store' }),
  ])

  if (!appIdRes.ok || !certIdRes.ok) return null

  const appIdBody = (await appIdRes.json()) as { data: { value: string } }
  const certIdBody = (await certIdRes.json()) as { data: { value: string } }
  const envBody = envRes.ok ? ((await envRes.json()) as { data: { value: unknown } }) : null

  return {
    appId: appIdBody.data.value,
    certId: certIdBody.data.value,
    environment: envBody?.data.value === 'production' ? 'production' : 'sandbox',
  }
}
