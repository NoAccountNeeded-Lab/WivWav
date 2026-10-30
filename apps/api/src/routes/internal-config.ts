import type { FastifyPluginAsync } from 'fastify'
import type { PrismaClient } from '@wivwav/db'
import type { CacheService } from '../services/cache/index.js'
import { ConfigService } from '../services/config-service.js'

interface InternalConfigOptions {
  db: PrismaClient
  cache: CacheService
  internalApiSecret: string | undefined
  opsApiSecret: string | undefined
  nodeEnv: 'development' | 'test' | 'production'
}

/** Least-privilege service read: no arbitrary keys, config metadata, or secrets. */
export const internalConfigRoutes: FastifyPluginAsync<InternalConfigOptions> = async (
  app, { db, cache, internalApiSecret, opsApiSecret, nodeEnv },
) => {
  app.addHook('onRequest', async (req, reply) => {
    const secrets = [internalApiSecret, opsApiSecret].filter((secret): secret is string => Boolean(secret))
    if (nodeEnv === 'production' && secrets.length === 0) {
      return reply.code(503).send({ error: { code: 'CONFIG_DISABLED', message: 'Service config reads are disabled' } })
    }
    if (secrets.length > 0 && !secrets.some(secret => req.headers.authorization === `Bearer ${secret}`)) {
      return reply.code(401).send({ error: { code: 'UNAUTHORIZED', message: 'Valid service credential required' } })
    }
    return undefined
  })
  const service = new ConfigService(db, cache, undefined)
  app.get('/ai.intake.model', async (_req, reply) => {
    const entry = await service.get('ai.intake.model')
    if (!entry || entry.type !== 'string' || typeof entry.value !== 'string') {
      return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Config value not found' } })
    }
    return reply.send({ data: { key: 'ai.intake.model', value: entry.value } })
  })
}
