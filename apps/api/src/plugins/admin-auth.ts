import type { FastifyPluginAsync } from 'fastify'

export interface AdminAuthPluginOptions {
  /** Shared secret required in `Authorization: Bearer <secret>` for admin traffic. */
  internalApiSecret: string | undefined
  /** Current runtime environment. */
  nodeEnv: 'development' | 'test' | 'production'
}

/**
 * Fail-closed guard for the `/admin` surface (queue mutation, schedules,
 * config, logs, vehicle-identity decisions, AI operations, and Bull Board).
 *
 * Behaviour:
 * - In production with no `INTERNAL_API_SECRET` configured: every request is
 *   refused (503) rather than silently serving admin surfaces unauthenticated.
 *   Operators must configure the secret to unlock admin access in production.
 * - When a secret is configured (any environment): requests must present a
 *   matching `Authorization: Bearer <secret>` header, or receive 401.
 * - In non-production environments with no secret configured: requests pass
 *   through unauthenticated. This permissive mode exists only for local
 *   development and CI and is never reachable when NODE_ENV is "production".
 *
 * IMPORTANT: call this function directly — `await adminAuthPlugin(adminScope, opts)`
 * — inside the parent plugin body, rather than `adminScope.register(adminAuthPlugin, opts)`.
 * `.register()` creates a *new* nested Fastify encapsulation context, so the
 * `onRequest` hook it adds would only guard routes registered inside that
 * nested context — not sibling routes registered directly on `adminScope`
 * afterwards, which is how `app.ts` mounts adminRoutes/adminConfigRoutes/the
 * Bull Board adapter/etc. Calling this function directly attaches the hook to
 * `adminScope` itself, so it covers every route in that scope. See app.ts for
 * the correct usage.
 */
export const adminAuthPlugin: FastifyPluginAsync<AdminAuthPluginOptions> = async (
  app,
  { internalApiSecret, nodeEnv },
) => {
  app.addHook('onRequest', async (req, reply) => {
    if (nodeEnv === 'production' && !internalApiSecret) {
      return reply.code(503).send({
        error: {
          code: 'ADMIN_DISABLED',
          message: 'Admin surfaces are disabled: no internal credential configured',
        },
      })
    }

    if (internalApiSecret) {
      const auth = req.headers.authorization
      if (auth !== `Bearer ${internalApiSecret}`) {
        return reply.code(401).send({
          error: {
            code: 'UNAUTHORIZED',
            message: 'Valid Authorization header required for admin access',
          },
        })
      }
    }

    return undefined
  })
}
