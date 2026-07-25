import type { FastifyPluginAsync } from 'fastify'
import { queryLokiRange, type LogEntry } from '../services/loki-client.js'

interface AdminLogsPluginOptions {
  lokiUrl: string
}

export type { LogEntry }

interface LogsQuerystring {
  service?: string
  search?: string
  limit?: string
  start?: string
  end?: string
}

export const adminLogsRoutes: FastifyPluginAsync<AdminLogsPluginOptions> = async (
  app,
  { lokiUrl },
) => {
  /**
   * GET /admin/logs
   *
   * Query Loki for recent log lines. Returns a flat array of normalised LogEntry
   * objects in descending timestamp order.
   *
   * Query params:
   *   service  — filter by service label (e.g. "api", "scraper")
   *   search   — substring to include in LogQL |= filter
   *   limit    — max entries (default 200, max 500)
   *   start    — ISO / ns epoch start time (default: 1 hour ago)
   *   end      — ISO / ns epoch end time (default: now)
   */
  app.get<{ Querystring: LogsQuerystring }>('/', async (req, reply) => {
    const { service, search, limit: limitStr, start: startStr, end: endStr } = req.query

    const limitParsed = parseInt(limitStr ?? '200', 10)
    const limit = Math.min(isNaN(limitParsed) ? 200 : Math.max(1, limitParsed), 500)
    const nowMs = Date.now()
    const startMs = (() => {
      if (!startStr) return nowMs - 3_600_000
      const asNum = Number(startStr)
      if (!isNaN(asNum)) return Math.floor(asNum / 1_000_000)
      const asDate = new Date(startStr).getTime()
      return isNaN(asDate) ? nowMs - 3_600_000 : asDate
    })()
    const endMs = (() => {
      if (!endStr) return nowMs
      const asNum = Number(endStr)
      if (!isNaN(asNum)) return Math.floor(asNum / 1_000_000)
      const asDate = new Date(endStr).getTime()
      return isNaN(asDate) ? nowMs : asDate
    })()

    // Build LogQL selector — use {service=~".+"} as default so all Alloy-shipped streams match
    let selector = '{service=~".+"}'
    if (service) {
      // Escape backslashes and double-quotes before embedding in a label selector string
      const escapedService = service.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
      selector = `{service="${escapedService}"}`
    }

    let logql = selector
    if (search) {
      // Use LogQL backtick filter (raw string — no escape sequences) to safely embed arbitrary text.
      // Strip backtick characters since they cannot appear inside a LogQL backtick string.
      const safe = search.replace(/`/g, '')
      logql = selector + ' |= `' + safe + '`'
    }

    const result = await queryLokiRange(lokiUrl, { logql, startMs, endMs, limit })

    if (!result.ok) {
      if (result.unavailable) {
        return reply.code(503).send({ error: { code: 'LOG_BACKEND_UNAVAILABLE', message: result.message } })
      }
      return reply.code(502).send({ error: { code: 'LOG_BACKEND_ERROR', message: result.message } })
    }

    // Collect distinct service labels for the filter dropdown. queryLokiRange
    // already returns entries newest-first.
    const services = [...new Set(result.entries.map(e => e.service).filter(Boolean))] as string[]

    return reply.send({ data: { entries: result.entries, services } })
  })

  /**
   * GET /admin/logs/services
   * Return the set of known service labels from Loki label values.
   */
  app.get('/services', async (_req, reply) => {
    let lokiRes: Response
    try {
      lokiRes = await fetch(`${lokiUrl}/loki/api/v1/label/service/values`, {
        signal: AbortSignal.timeout(4_000),
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Loki unavailable'
      return reply.code(503).send({ error: { code: 'LOG_BACKEND_UNAVAILABLE', message: msg } })
    }

    if (!lokiRes.ok) {
      return reply.code(502).send({ error: { code: 'LOG_BACKEND_ERROR', message: `Loki responded ${lokiRes.status}` } })
    }

    const body = (await lokiRes.json()) as { data: string[] }
    return reply.send({ data: body.data ?? [] })
  })
}
