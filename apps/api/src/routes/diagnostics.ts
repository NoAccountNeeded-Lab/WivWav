import type { FastifyPluginAsync } from 'fastify'

/**
 * Placeholder route for the `/diagnostics` scope (#773). This issue only
 * lands the fail-closed auth boundary (`plugins/diagnostic-auth.ts`) — no
 * real diagnostic endpoints exist yet. `GET /diagnostics/ping` exists solely
 * so the auth hook has a route to guard and can be exercised end-to-end;
 * remove it once the first real diagnostic route lands in a follow-up issue.
 */
export const diagnosticsRoutes: FastifyPluginAsync = async (app) => {
  app.get('/ping', async () => ({ data: { ok: true } }))
}
