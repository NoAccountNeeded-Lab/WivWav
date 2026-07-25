import type { FastifyPluginAsync } from 'fastify'

export interface DiagnosticAuthPluginOptions {
  /** Shared secret required in `Authorization: Bearer <secret>` for diagnostic traffic. */
  diagnosticApiSecret: string | undefined
  /**
   * Also accepted on `/diagnostics/*` so the ops BFF and other existing
   * server-to-server callers can proxy diagnostic calls without new secret
   * wiring. Intentionally asymmetric: the reverse never holds — see
   * `admin-auth.ts`, which does not accept `diagnosticApiSecret`.
   */
  internalApiSecret: string | undefined
  /** Current runtime environment. */
  nodeEnv: 'development' | 'test' | 'production'
}

/**
 * Fail-closed guard for the `/diagnostics` surface (read-only AI diagnostic
 * gateway routes, #757/#773). Mirrors `admin-auth.ts`'s fail-closed pattern,
 * but with its own, narrower-scoped credential — `DIAGNOSTIC_API_SECRET` is
 * deliberately distinct from `INTERNAL_API_SECRET` because diagnostic routes
 * are designed to be called from desktop AI clients (Claude/ChatGPT desktop
 * apps), whose MCP config stores the bearer token in a plaintext file.
 * `INTERNAL_API_SECRET` unlocks queue mutation, schedule changes, and
 * `GET /admin/config/:key/decrypt` — handing that to a desktop AI client is
 * unacceptable, so it must never be the credential those clients hold.
 *
 * Credential relationship is intentionally asymmetric:
 * - `DIAGNOSTIC_API_SECRET` is accepted only here, on `/diagnostics/*`.
 * - `INTERNAL_API_SECRET` is *also* accepted here (so the ops BFF can proxy
 *   diagnostic calls without provisioning a second secret), but this
 *   plugin is never applied to `/admin/*` — `admin-auth.ts` (which this
 *   plugin does not call or wrap) never checks `DIAGNOSTIC_API_SECRET`, so
 *   that credential can never unlock admin routes.
 *
 * Behaviour otherwise matches `adminAuthPlugin`:
 * - In production with no `DIAGNOSTIC_API_SECRET` configured: every request
 *   is refused (503) rather than silently serving diagnostic surfaces
 *   unauthenticated. Operators must configure the secret to unlock
 *   diagnostic access in production, even if `INTERNAL_API_SECRET` happens
 *   to be set.
 * - When `DIAGNOSTIC_API_SECRET` and/or `INTERNAL_API_SECRET` is configured:
 *   requests must present a matching `Authorization: Bearer <secret>`
 *   header (either secret works), or receive 401.
 * - In non-production environments with neither secret configured: requests
 *   pass through unauthenticated. This permissive mode exists only for
 *   local development and CI and is never reachable when NODE_ENV is
 *   "production".
 *
 * IMPORTANT: call this function directly — `await diagnosticAuthPlugin(diagnosticScope, opts)`
 * — inside the parent plugin body, rather than `diagnosticScope.register(diagnosticAuthPlugin, opts)`.
 * See `admin-auth.ts`'s docstring for why: `.register()` creates a *new*
 * nested Fastify encapsulation context, so the `onRequest` hook it adds
 * would only guard routes registered inside that nested context, not
 * sibling routes registered directly on `diagnosticScope` afterwards.
 */
export const diagnosticAuthPlugin: FastifyPluginAsync<DiagnosticAuthPluginOptions> = async (
  app,
  { diagnosticApiSecret, internalApiSecret, nodeEnv },
) => {
  app.addHook('onRequest', async (req, reply) => {
    if (nodeEnv === 'production' && !diagnosticApiSecret) {
      return reply.code(503).send({
        error: {
          code: 'DIAGNOSTIC_DISABLED',
          message: 'Diagnostic surfaces are disabled: no diagnostic credential configured',
        },
      })
    }

    if (diagnosticApiSecret || internalApiSecret) {
      const auth = req.headers.authorization
      const isValid =
        (diagnosticApiSecret !== undefined && auth === `Bearer ${diagnosticApiSecret}`) ||
        (internalApiSecret !== undefined && auth === `Bearer ${internalApiSecret}`)
      if (!isValid) {
        return reply.code(401).send({
          error: {
            code: 'UNAUTHORIZED',
            message: 'Valid Authorization header required for diagnostic access',
          },
        })
      }
    }

    return undefined
  })
}
