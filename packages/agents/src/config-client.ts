/** Trusted host-side CLI config reads. The credential never enters model prompts. */
export async function fetchAgentConfig(key: string, suffix: '' | '/decrypt' = ''): Promise<string | null> {
  const configApiUrl = process.env['CONFIG_API_URL']
  const secret = process.env['OPS_API_SECRET']
  if (!configApiUrl || !secret) return null
  try {
    const response = await fetch(`${configApiUrl}/internal/ops/config/${encodeURIComponent(key)}${suffix}`, {
      headers: { Authorization: `Bearer ${secret}` },
      redirect: 'error',
    })
    if (!response.ok) return null
    const body = await response.json() as { data?: { value?: unknown } }
    return typeof body.data?.value === 'string' ? body.data.value : null
  } catch {
    return null
  }
}
