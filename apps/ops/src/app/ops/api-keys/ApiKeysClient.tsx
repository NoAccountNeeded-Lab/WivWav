'use client'

import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Check, Copy, KeyRound, Plus, ShieldAlert, Trash2, X } from 'lucide-react'
import styles from './api-keys.module.css'
import opsStyles from '../ops.module.css'

interface ApiKeyRecord {
  id: string
  ownerEmail: string
  tier: 'FREE' | 'PRO' | 'ENTERPRISE'
  rateLimitRpm: number
  createdAt: string
  revokedAt: string | null
}

interface ApiKeysPayload {
  keys: ApiKeyRecord[]
  pagination: { limit: number; offset: number; total: number }
}

interface ApiKeysClientProps {
  apiBaseUrl: string
}

const PAGE_SIZE = 50

function formatDate(value: string): string {
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return 'Unknown'
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date)
}

async function readError(response: Response): Promise<string> {
  try {
    const body = await response.json() as { error?: { message?: unknown } }
    if (typeof body.error?.message === 'string') return body.error.message
  } catch {
    // Use the status-based fallback below for non-JSON API errors.
  }
  return `Request failed (${response.status})`
}

export function ApiKeysClient({ apiBaseUrl }: ApiKeysClientProps) {
  const [keys, setKeys] = useState<ApiKeyRecord[]>([])
  const [pagination, setPagination] = useState({ limit: PAGE_SIZE, offset: 0, total: 0 })
  const [offset, setOffset] = useState(0)
  const [reloadToken, setReloadToken] = useState(0)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [mutationError, setMutationError] = useState<string | null>(null)
  const [statusMessage, setStatusMessage] = useState<string | null>(null)
  const [ownerEmail, setOwnerEmail] = useState('')
  const [tier, setTier] = useState<ApiKeyRecord['tier']>('FREE')
  const [rateLimitRpm, setRateLimitRpm] = useState('')
  const [creating, setCreating] = useState(false)
  const [issuedKey, setIssuedKey] = useState<string | null>(null)
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle')
  const [revokeTarget, setRevokeTarget] = useState<ApiKeyRecord | null>(null)
  const [revokingId, setRevokingId] = useState<string | null>(null)

  const loadKeys = useCallback(async (signal: AbortSignal) => {
    setLoading(true)
    setLoadError(null)
    try {
      const query = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset) })
      const response = await fetch(`${apiBaseUrl}/admin/api-keys?${query.toString()}`, { cache: 'no-store', signal })
      if (!response.ok) throw new Error(await readError(response))
      const body = await response.json() as { data?: ApiKeysPayload }
      if (!body.data || !Array.isArray(body.data.keys) || !body.data.pagination) {
        throw new Error('The API returned an invalid API key list.')
      }
      setKeys(body.data.keys)
      setPagination(body.data.pagination)
    } catch (error) {
      if (signal.aborted) return
      setLoadError(error instanceof Error ? error.message : 'Could not load API keys.')
    } finally {
      if (!signal.aborted) setLoading(false)
    }
  }, [apiBaseUrl, offset])

  useEffect(() => {
    const controller = new AbortController()
    void loadKeys(controller.signal)
    return () => controller.abort()
  }, [loadKeys, reloadToken])

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (issuedKey) {
      setMutationError('Clear or store the currently displayed key before creating another.')
      return
    }
    setMutationError(null)
    setStatusMessage(null)

    const email = ownerEmail.trim()
    const parsedRateLimit = rateLimitRpm.trim() === '' ? undefined : Number(rateLimitRpm)
    if (parsedRateLimit !== undefined && (!Number.isSafeInteger(parsedRateLimit) || parsedRateLimit < 1)) {
      setMutationError('Rate limit must be a positive whole number.')
      return
    }

    setCreating(true)
    try {
      const payload: { ownerEmail: string; tier: ApiKeyRecord['tier']; rateLimitRpm?: number } = { ownerEmail: email, tier }
      if (parsedRateLimit !== undefined) payload.rateLimitRpm = parsedRateLimit
      const response = await fetch(`${apiBaseUrl}/admin/api-keys`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!response.ok) throw new Error(await readError(response))

      const body = await response.json() as { data?: { rawKey?: unknown } }
      if (typeof body.data?.rawKey !== 'string' || body.data.rawKey.length === 0) {
        throw new Error('The key was created, but the API did not return its one-time value. Revoke it from the list if needed.')
      }
      setIssuedKey(body.data.rawKey)
      setStatusMessage('Key created. Copy and store it now; it cannot be retrieved again.')
      setOwnerEmail('')
      setRateLimitRpm('')
      setOffset(0)
      setReloadToken(value => value + 1)
    } catch (error) {
      setMutationError(error instanceof Error ? error.message : 'Could not create API key.')
      setReloadToken(value => value + 1)
    } finally {
      setCreating(false)
    }
  }

  async function copyIssuedKey() {
    if (!issuedKey) return
    try {
      await navigator.clipboard.writeText(issuedKey)
      setCopyState('copied')
    } catch {
      setCopyState('failed')
    }
  }

  async function handleRevoke() {
    if (!revokeTarget) return
    const target = revokeTarget
    setRevokingId(target.id)
    setMutationError(null)
    setStatusMessage(null)
    try {
      const response = await fetch(`${apiBaseUrl}/admin/api-keys/${encodeURIComponent(target.id)}`, { method: 'DELETE' })
      if (!response.ok) throw new Error(await readError(response))
      setRevokeTarget(null)
      setStatusMessage(`Key for ${target.ownerEmail} was revoked.`)
      setReloadToken(value => value + 1)
    } catch (error) {
      setMutationError(error instanceof Error ? error.message : 'Could not revoke API key.')
    } finally {
      setRevokingId(null)
    }
  }

  function dismissIssuedKey() {
    setIssuedKey(null)
    setCopyState('idle')
    setStatusMessage('One-time key value cleared from this page.')
  }

  const hasPreviousPage = offset > 0
  const hasNextPage = offset + pagination.limit < pagination.total

  return (
    <main className={opsStyles.main}>
      <div className={opsStyles.container}>
        <header className={opsStyles.pageHeader}>
          <div>
            <h1 className={opsStyles.heading}>API keys</h1>
            <p className={opsStyles.pageIntro}>Create and revoke credentials for the public WivWav API.</p>
          </div>
        </header>

        <section className={styles.createSection} aria-labelledby="create-key-heading">
          <h2 id="create-key-heading">Create a key</h2>
          <p>New keys are shown once. Store the value securely before closing this page.</p>
          <form className={styles.createForm} onSubmit={handleCreate}>
            <label>
              Owner email
              <input
                autoComplete="email"
                type="email"
                name="ownerEmail"
                value={ownerEmail}
                onChange={event => setOwnerEmail(event.currentTarget.value)}
                required
                maxLength={254}
              />
            </label>
            <label>
              Tier
              <select value={tier} onChange={event => setTier(event.currentTarget.value as ApiKeyRecord['tier'])}>
                <option value="FREE">Free</option>
                <option value="PRO">Pro</option>
                <option value="ENTERPRISE">Enterprise</option>
              </select>
            </label>
            <label>
              Rate limit (requests/minute)
              <input
                type="number"
                min={1}
                step={1}
                inputMode="numeric"
                value={rateLimitRpm}
                onChange={event => setRateLimitRpm(event.currentTarget.value)}
                placeholder="Use tier default"
              />
            </label>
            <button type="submit" className={styles.primaryButton} disabled={creating || Boolean(issuedKey)}>
              <Plus size={17} aria-hidden="true" />
              {creating ? 'Creating…' : 'Create API key'}
            </button>
          </form>

          {issuedKey && (
            <div className={styles.issuedKey} aria-labelledby="issued-key-heading">
              <h3 id="issued-key-heading"><KeyRound size={18} aria-hidden="true" /> New key — copy it now</h3>
              <p>This value will not appear again after you clear it or leave this page.</p>
              <div className={styles.keyValueRow}>
                <code>{issuedKey}</code>
                <button type="button" className={styles.secondaryButton} onClick={copyIssuedKey}>
                  {copyState === 'copied' ? <Check size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />}
                  {copyState === 'copied' ? 'Copied' : 'Copy key'}
                </button>
                <button type="button" className={styles.secondaryButton} onClick={dismissIssuedKey}>
                  <X size={16} aria-hidden="true" />
                  Clear key
                </button>
              </div>
              {copyState === 'failed' && <p className={styles.inlineError}>Clipboard access failed. Select and copy the key manually.</p>}
            </div>
          )}
        </section>

        {mutationError && <p className={opsStyles.error} role="alert">{mutationError}</p>}
        {statusMessage && <p className={styles.statusMessage} role="status">{statusMessage}</p>}

        <section className={styles.listSection} aria-labelledby="key-list-heading">
          <div className={styles.listHeader}>
            <div>
              <h2 id="key-list-heading">Issued keys</h2>
              <p>{pagination.total} {pagination.total === 1 ? 'key' : 'keys'} total</p>
            </div>
            <button type="button" className={styles.secondaryButton} onClick={() => setReloadToken(value => value + 1)} disabled={loading}>
              Refresh list
            </button>
          </div>

          {loadError && <p className={opsStyles.error} role="alert">API keys could not load: {loadError}</p>}
          {loading ? (
            <p className={opsStyles.empty} role="status">Loading API keys…</p>
          ) : loadError ? null : keys.length === 0 ? (
            <p className={opsStyles.empty}>No API keys have been created yet.</p>
          ) : (
            <div className={styles.keyList}>
              {keys.map(key => (
                <article className={styles.keyCard} key={key.id}>
                  <div className={styles.keyCardHeader}>
                    <div>
                      <h3>{key.ownerEmail}</h3>
                      <p className={styles.keyId}>ID: <code>{key.id}</code></p>
                    </div>
                    <span className={styles.keyStatus} data-revoked={key.revokedAt ? 'true' : 'false'}>
                      {key.revokedAt ? 'Revoked' : 'Active'}
                    </span>
                  </div>
                  <dl className={styles.keyDetails}>
                    <div><dt>Tier</dt><dd>{key.tier}</dd></div>
                    <div><dt>Rate limit</dt><dd>{key.rateLimitRpm.toLocaleString()} requests/min</dd></div>
                    <div><dt>Created</dt><dd>{formatDate(key.createdAt)}</dd></div>
                    <div><dt>Revoked</dt><dd>{key.revokedAt ? formatDate(key.revokedAt) : '—'}</dd></div>
                  </dl>
                  {!key.revokedAt && (
                    revokeTarget?.id === key.id ? (
                      <div className={styles.confirmRevoke}>
                        <p><ShieldAlert size={16} aria-hidden="true" /> Revoke this key? Requests using it will be rejected immediately.</p>
                        <button type="button" className={styles.dangerButton} onClick={handleRevoke} disabled={revokingId === key.id}>
                          <Trash2 size={16} aria-hidden="true" />
                          {revokingId === key.id ? 'Revoking…' : 'Confirm revoke'}
                        </button>
                        <button type="button" className={styles.secondaryButton} onClick={() => setRevokeTarget(null)} disabled={revokingId === key.id}>Cancel</button>
                      </div>
                    ) : (
                      <button type="button" className={styles.dangerButton} onClick={() => setRevokeTarget(key)}>
                        <Trash2 size={16} aria-hidden="true" />
                        Revoke key
                      </button>
                    )
                  )}
                </article>
              ))}
            </div>
          )}

          <nav className={styles.pagination} aria-label="API key pages">
            <button type="button" className={styles.secondaryButton} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))} disabled={!hasPreviousPage || loading}>
              Previous
            </button>
            <span>Showing {pagination.total === 0 ? 0 : offset + 1}–{Math.min(offset + pagination.limit, pagination.total)} of {pagination.total}</span>
            <button type="button" className={styles.secondaryButton} onClick={() => setOffset(offset + PAGE_SIZE)} disabled={!hasNextPage || loading}>
              Next
            </button>
          </nav>
        </section>
      </div>
    </main>
  )
}
