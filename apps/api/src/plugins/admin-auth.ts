import type { FastifyPluginAsync } from 'fastify'

export interface AdminAuthPluginOptions {
  /** Shared secret required in `Authorization: Bearer <secret>` for worker coordinator traffic. */
  internalApiSecret: string | undefined
  /** Current runtime environment. */
  nodeEnv: 'development' | 'test' | 'production'
}

/**
 * WORKER_API_SECRET identity guard for worker coordinator routes only.
 * Operator traffic uses opsAuthPlugin instead. Call directly in the parent
 * Fastify scope so the onRequest hook guards sibling route registrations.
 * Production fails closed when the credential is absent; configured credentials
 * are mandatory in every environment. Local unconfigured tests remain permissive.
 */
export const adminAuthPlugin: FastifyPluginAsync<AdminAuthPluginOptions> = async (
  app,
  { internalApiSecret, nodeEnv },
) => {
  app.addHook('onRequest', async (req, reply) => {
    if (nodeEnv === 'production' && !internalApiSecret) {
      return reply.code(503).send({
        error: {
          code: 'WORKER_DISABLED',
          message: 'Worker surfaces are disabled: no worker credential configured',
        },
      })
    }

    if (internalApiSecret) {
      const auth = req.headers.authorization
      if (auth !== `Bearer ${internalApiSecret}`) {
        return reply.code(401).send({
          error: {
            code: 'UNAUTHORIZED',
            message: 'Valid Authorization header required for worker access',
          },
        })
      }
    }

    return undefined
  })
}
