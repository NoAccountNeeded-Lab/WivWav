import type { FastifyPluginAsync } from 'fastify'
import type { QueueFactory } from '@wivwav/queue'
import { QUEUES } from '@wivwav/queue'
import type { SourceRepository } from '../repositories/index.js'

const KNOWN_QUEUE_NAMES = new Set<string>(Object.values(QUEUES))

interface AdminAiPluginOptions {
  sources: SourceRepository
  ollamaBaseUrl: string
  queueFactory: QueueFactory
}

interface OllamaModel {
  name: string
}

interface OllamaTagsResponse {
  models: OllamaModel[]
}

interface OllamaRunningModel {
  name?: string
  model?: string
  size?: number
  size_vram?: number
  processor?: string
  context?: number
  expires_at?: string
}

interface OllamaPsResponse {
  models?: OllamaRunningModel[]
}

interface OllamaGenerateResponse {
  response: string
  done: boolean
}

interface ExplainErrorBody {
  data?: {
    queue?: string
    jobId?: string
  }
}

const EXPLAIN_MODEL = 'llama3.2'
// Local Ollama completions can be slow on CPU-only hosts; keep this generous
// but bounded so the panel never hangs indefinitely if the daemon stalls.
const EXPLAIN_TIMEOUT_MS = 30_000

const explainErrorBodySchema = {
  type: 'object',
  properties: {
    data: {
      type: 'object',
      properties: {
        queue: { type: 'string', minLength: 1 },
        jobId: { type: 'string', minLength: 1 },
      },
      required: ['queue', 'jobId'],
      additionalProperties: false,
    },
  },
  required: ['data'],
  additionalProperties: false,
} as const

function buildExplainPrompt(params: {
  stage: string
  jobId: string
  failedReason: string
  attemptsMade: number
}): { system: string; user: string } {
  const system =
    'You are an operations assistant explaining pipeline job failures to an engineer. '
    + 'Explain in plain language what the error means and its likely cause, scoped strictly '
    + 'to explanation and triage. Do not propose or write code changes, and do not claim your '
    + 'explanation is a verified fix — only describe the likely cause and, if helpful, what to '
    + 'check next.'
  const user =
    `Pipeline stage: ${params.stage}\n`
    + `Job ID: ${params.jobId}\n`
    + `Attempts made: ${params.attemptsMade}\n`
    + `Error / stack trace:\n${params.failedReason}`
  return { system, user }
}

export const adminAiRoutes: FastifyPluginAsync<AdminAiPluginOptions> = async (
  app,
  { sources, ollamaBaseUrl, queueFactory },
) => {
  // GET /admin/ai/status — Ollama health, loaded models, installed models, and sources flagged for remapping
  app.get('/status', async (_req, reply) => {
    let available = false
    let models: string[] = []
    let runningModels: Array<{
      name: string
      sizeBytes: number | null
      vramBytes: number | null
      processor: string | null
      contextWindow: number | null
      expiresAt: string | null
    }> = []

    try {
      const res = await fetch(`${ollamaBaseUrl}/api/tags`, {
        signal: AbortSignal.timeout(2000),
      })
      if (res.ok) {
        available = true
        const data = (await res.json()) as OllamaTagsResponse
        models = (data.models ?? []).map(m => m.name)
      }
    } catch {
      // Ollama unreachable — leave defaults
    }

    if (available) {
      try {
        const res = await fetch(`${ollamaBaseUrl}/api/ps`, {
          signal: AbortSignal.timeout(2000),
        })
        if (res.ok) {
          const data = (await res.json()) as OllamaPsResponse
          runningModels = (data.models ?? []).map(m => ({
            name: m.model ?? m.name ?? 'unknown',
            sizeBytes: typeof m.size === 'number' ? m.size : null,
            vramBytes: typeof m.size_vram === 'number' ? m.size_vram : null,
            processor: m.processor ?? null,
            contextWindow: typeof m.context === 'number' ? m.context : null,
            expiresAt: m.expires_at ?? null,
          }))
        }
      } catch {
        // Runtime model stats are best-effort; availability comes from /api/tags.
      }
    }

    const sourcesNeedingRemap = await sources.findNeedingRemapping()

    return reply.send({
      data: {
        ollama: { available, baseUrl: ollamaBaseUrl, models, runningModels },
        sourcesNeedingRemap,
      },
    })
  })

  // POST /admin/ai/explain-error — plain-language explanation of a failed job,
  // for the "Explain this error" action on the per-source pipeline view (#555).
  // Scoped strictly to explanation/triage; the prompt explicitly forbids the
  // model from proposing code changes, since local-model fix suggestions are
  // not reliable enough to act on during an outage.
  app.post<{ Body: ExplainErrorBody }>(
    '/explain-error',
    { schema: { body: explainErrorBodySchema } },
    async (req, reply) => {
      const queueName = req.body.data?.queue
      const jobId = req.body.data?.jobId
      if (!queueName || !jobId) {
        return reply.code(400).send({
          error: { code: 'BAD_REQUEST', message: 'data.queue and data.jobId are required' },
        })
      }
      // Only allow explaining jobs from known, registered queues — reject
      // arbitrary queue names before they reach queueFactory.createQueue,
      // which would otherwise lazily instantiate a new BullMQ queue for any
      // client-supplied string.
      if (!KNOWN_QUEUE_NAMES.has(queueName)) {
        return reply.notFound(`Queue "${queueName}" not found`)
      }

      let job
      try {
        const q = queueFactory.createQueue(queueName)
        const failedJobs = await q.getJobs(['failed'])
        job = failedJobs.find((j) => j.id === jobId)
      } catch (err) {
        app.log.error(err, 'Failed to load job for explain-error')
        return reply.code(503).send({ error: { code: 'SERVICE_UNAVAILABLE', message: 'Queue service is unavailable' } })
      }

      if (!job) {
        return reply.notFound(`Failed job "${jobId}" not found in queue "${queueName}"`)
      }
      if (!job.failedReason) {
        return reply.code(400).send({
          error: { code: 'BAD_REQUEST', message: 'This job has no recorded failure reason to explain' },
        })
      }

      const { system, user } = buildExplainPrompt({
        stage: queueName,
        jobId,
        failedReason: job.failedReason,
        attemptsMade: job.attemptsMade,
      })

      try {
        const res = await fetch(`${ollamaBaseUrl}/api/generate`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            model: EXPLAIN_MODEL,
            system,
            prompt: user,
            stream: false,
            options: { num_predict: 512, temperature: 0.1 },
          }),
          signal: AbortSignal.timeout(EXPLAIN_TIMEOUT_MS),
        })
        if (!res.ok) {
          return reply.code(502).send({
            error: { code: 'OLLAMA_ERROR', message: `Ollama request failed: ${res.status} ${res.statusText}` },
          })
        }
        const body = (await res.json()) as OllamaGenerateResponse
        return reply.send({ data: { explanation: body.response, model: EXPLAIN_MODEL } })
      } catch (err) {
        app.log.warn(err, 'Ollama explain-error request failed or timed out')
        return reply.code(503).send({
          error: { code: 'OLLAMA_UNAVAILABLE', message: 'Ollama is unreachable or timed out. Confirm it is running and try again.' },
        })
      }
    },
  )
}
