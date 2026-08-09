import type { WivWavLogger } from '@wivwav/logger'

export interface HttpClientOptions {
  baseUrl: string
  token: string
  logger?: WivWavLogger
  /** Total attempts (including the first) for a network-failure retry. Default: 3. */
  maxAttempts?: number
  /** Base backoff delay in ms; doubles each attempt. Default: 300. */
  baseDelayMs?: number
  fetchImpl?: typeof fetch
}

export class HttpRequestError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body: unknown,
  ) {
    super(message)
    this.name = 'HttpRequestError'
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Thin HTTP client for the coordinator's `/internal/scraper/*` and
 * `/internal/workers/*` surfaces (#948/#951/#952). Every route the worker
 * calls is idempotent by design (see docs/api-routes.md and
 * scraper-gateway.ts's schema docstrings), so retrying on network failure —
 * as opposed to an application-level 4xx/5xx, which is a real failure and is
 * never retried here — is always safe.
 */
export class HttpClient {
  private readonly baseUrl: string
  private readonly token: string
  private readonly logger: WivWavLogger | undefined
  private readonly maxAttempts: number
  private readonly baseDelayMs: number
  private readonly fetchImpl: typeof fetch

  constructor(options: HttpClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '')
    this.token = options.token
    this.logger = options.logger
    this.maxAttempts = options.maxAttempts ?? 3
    this.baseDelayMs = options.baseDelayMs ?? 300
    this.fetchImpl = options.fetchImpl ?? fetch
  }

  async request<T = unknown>(
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`

    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      let response: Response
      try {
        response = await this.fetchImpl(url, {
          method,
          headers: {
            Authorization: `Bearer ${this.token}`,
            ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
          },
          ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        })
      } catch (err) {
        if (attempt < this.maxAttempts) {
          const delay = this.baseDelayMs * 2 ** (attempt - 1)
          this.logger?.warn(
            { event: 'http.retry', url, attempt, err: err instanceof Error ? err.message : String(err) },
            `[http-client] network error calling ${method} ${path}; retrying in ${delay}ms`,
          )
          await sleep(delay)
          continue
        }
        throw new Error(
          `[http-client] ${method} ${path} failed after ${this.maxAttempts} attempts: ${
            err instanceof Error ? err.message : String(err)
          }`,
          { cause: err },
        )
      }

      if (!response.ok) {
        let parsedBody: unknown
        try {
          parsedBody = await response.json()
        } catch {
          parsedBody = undefined
        }
        throw new HttpRequestError(
          `[http-client] ${method} ${path} returned ${response.status}`,
          response.status,
          parsedBody,
        )
      }

      if (response.status === 204) return undefined as T
      const json = (await response.json()) as { data: T }
      return json.data
    }

    // Unreachable — the loop above always returns or throws.
    throw new Error(`[http-client] ${method} ${path} failed with no attempts recorded`)
  }

  get<T = unknown>(path: string): Promise<T> {
    return this.request<T>('GET', path)
  }

  post<T = unknown>(path: string, body?: unknown): Promise<T> {
    return this.request<T>('POST', path, body ?? {})
  }
}
