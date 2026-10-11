import type { FastifyInstance } from 'fastify'
import { sanitizeDiagnosticResponse, sanitizeString } from '@wivwav/observability'

const FAIL_CLOSED = JSON.stringify({
  error: { code: 'DIAGNOSTIC_UNSANITIZABLE', message: 'Response could not be sanitized' },
})

/**
 * Scoped `onSend` catch-all for the diagnostics plugin (#776): every payload
 * leaving a diagnostic route, including error envelopes (404 messages that echo
 * the requested id, thrown/framework errors), passes through the sanitizer.
 * Non-JSON, non-text payloads (streams) fail closed.
 */
export function addDiagnosticSanitizer(app: FastifyInstance): void {
  app.addHook('onSend', async (_req, reply, payload) => {
    if (payload === null || payload === undefined) return payload
    // Only JSON/text payloads are sanitized; anything else (binary, streams) fails closed.
    const ct = String(reply.getHeader('content-type') ?? '')
    const textual = /^(application\/([\w.+-]*\+)?json|text\/)/i.test(ct)
    const text = !textual ? null : typeof payload === 'string' ? payload : Buffer.isBuffer(payload) ? payload.toString('utf8') : null
    reply.removeHeader('content-length')
    if (text === null) {
      reply.type('application/json; charset=utf-8')
      return FAIL_CLOSED
    }
    try {
      return JSON.stringify(sanitizeDiagnosticResponse(JSON.parse(text) as unknown))
    } catch {
      return sanitizeString(text)
    }
  })
}
