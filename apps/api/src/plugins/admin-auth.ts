import type { FastifyPluginAsync } from 'fastify'

export interface AdminAuthPluginOptions {
  /** Shared secret required in `Authorization: Bearer <secret>` for worker coordinator traffic. */
  internalApiSecret: string | undefined
  /** Current runtime environment. */
  nodeEnv: 'development' | 'test' | 'production'
}

/**
 * Existing INTERNAL identity guard for worker coordinator routes only.
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
