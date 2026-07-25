import type { FastifyPluginAsync } from 'fastify'
import {
  CONTENT_VERSION,
  RESPONSE_PROTOCOL,
  RUNBOOK_INDEX,
  SAFETY_RULES,
  SERVICE_GLOSSARY,
  SIGNAL_GLOSSARY,
} from './static-context.js'

export interface DiagnosticContextPluginOptions {
  /** Deployed commit SHA (`Config.GIT_SHA`) — the only per-deployment
   *  (not per-request) value in this route's response. */
  gitSha: string
  nodeEnv: string
}

/**
 * GET /diagnostics/diagnostic-context (#775, Q1/Q7 from #757)
 *
 * Mostly-static, fixed-size content: service/queue semantics, the signal
 * glossary, a runbook index, safety rules, and the facts/hypotheses/
 * unknowns/next-checks response protocol an AI caller should structure its
 * own findings in — plus live deployed revision metadata. Never touches the
 * DB, queues, or any other system state, so the response is identical
 * across requests within a deployment (`contentVersion` bumps only when the
 * static content itself changes; `revision` is the only part that varies,
 * and only across deployments, not requests).
 */
export const diagnosticContextRoutes: FastifyPluginAsync<DiagnosticContextPluginOptions> = async (app, { gitSha, nodeEnv }) => {
  app.get('/', async () => ({
    data: {
      contentVersion: CONTENT_VERSION,
      revision: {
        gitSha,
        nodeEnv,
      },
      serviceGlossary: SERVICE_GLOSSARY,
      signalGlossary: SIGNAL_GLOSSARY,
      runbookIndex: RUNBOOK_INDEX,
      safetyRules: SAFETY_RULES,
      responseProtocol: RESPONSE_PROTOCOL,
    },
  }))
}
