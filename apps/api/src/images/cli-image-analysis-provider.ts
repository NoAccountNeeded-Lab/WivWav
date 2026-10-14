/**
 * Local-evaluation image-analysis providers that drive the operator's own
 * `claude` or `codex` CLI (#1112), so photo analysis can be tried from a
 * laptop on an existing subscription before a production provider is chosen.
 *
 * Not for production: subscription use is personal evaluation only, one call
 * at a time.
 *
 * Cost: the Claude path sends the photos inline (stream-json input) with no
 * tools, an empty settings list and a one-line system prompt. That removes
 * the CLI's own instruction/tool overhead (about 43k tokens per call) and the
 * extra Read-tool turn: measured $0.065 -> $0.009 for one photo, and about
 * $0.0067 per photo when four photos of a listing share one call. Image
 * bytes stay in memory. The Codex path can only attach a file, so it writes
 * the photo to a private temp directory for one call and deletes it in
 * `finally`, a narrow deviation from the contract's "never written to disk"
 * rule (docs/design/semantic-image-analysis-contract.md).
 *
 * The Codex child ignores the user's config.toml (MCP servers) and exec rules
 * and runs with its shell tool disabled, so text inside a photo cannot steer it
 * into reading files. Auth stays in the real CODEX_HOME so a token refresh
 * during a call is kept.
 *
 * API-key environment variables are removed from the child process so the
 * CLI authenticates with the subscription login and cannot silently bill an
 * API account.
 *
 * Errors throw; `analyzeListingImage` records them as `error` rows.
 */

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadSharp } from './load-sharp.js'
import { CliOutputError, CLAUDE_SYSTEM_PROMPT, buildAnalysisPrompt, claudeUsage, codexUsage, extractJsonArray, extractJsonObject, toAnalysisResult } from './cli-output-parsers.js'
import { spawnProcessRunner } from './cli-process-runner.js'
import type { ProcessRunResult, ProcessRunner } from './cli-process-runner.js'
import type {
  AnalysisUsage,
  ImageAnalysisInput,
  ImageAnalysisProvider,
  ImageAnalysisResult,
} from './image-analysis-provider.js'

export type { ProcessRunOptions, ProcessRunResult, ProcessRunner } from './cli-process-runner.js'

export type CliProviderKind = 'claude-cli' | 'codex-cli'

export const DEFAULT_CLI_TIMEOUT_MS = 120_000

/**
 * Long-edge size photos are shrunk to before being sent. Image tokens grow
 * with pixel count, and a 1920px listing photo costs several times what a
 * 1024px one does while the labels asked for stay readable.
 */
export const DEFAULT_MAX_IMAGE_EDGE_PX = 1024

const STRIPPED_ENV_KEYS = ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'OPENAI_API_KEY', 'CODEX_API_KEY']

/** Runs `fn` with a private temp directory that is always deleted afterwards. */
async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'wivwav-image-analysis-'))
  try {
    return await fn(dir)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

function extensionFor(contentType: string): string {
  const subtype = contentType.split(';')[0]?.split('/')[1]?.trim().toLowerCase() ?? ''
  if (subtype === 'jpeg' || subtype === 'jpg') return 'jpg'
  if (subtype === 'png' || subtype === 'webp' || subtype === 'gif') return subtype
  return 'jpg'
}

/** Keyed by `extensionFor`, which falls back to jpg for unknown types. */
const CLAUDE_MEDIA_TYPES: Record<string, string> = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif' }

/**
 * Shrinks an image so its longest edge is at most `maxEdgePx` (JPEG, quality 80).
 * Returns the original, untouched, when resizing is off, the image already
 * fits, or it cannot be decoded.
 */
export async function shrinkForModel(
  bytes: Uint8Array,
  contentType: string,
  maxEdgePx: number,
): Promise<{ bytes: Uint8Array; contentType: string }> {
  if (maxEdgePx <= 0) return { bytes, contentType }
  try {
    const sharp = await loadSharp()
    const meta = await sharp(bytes).metadata()
    if (Math.max(meta.width ?? 0, meta.height ?? 0) <= maxEdgePx) return { bytes, contentType }
    const out = await sharp(bytes)
      .rotate()
      .resize({ width: maxEdgePx, height: maxEdgePx, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 80 })
      .toBuffer()
    return out.length < bytes.length ? { bytes: out, contentType: 'image/jpeg' } : { bytes, contentType }
  } catch {
    return { bytes, contentType }
  }
}

export interface CliImageAnalysisProviderOptions {
  kind: CliProviderKind
  /** Passed to the CLI's model flag; the CLI's own default when omitted. */
  model?: string
  timeoutMs?: number
  /** Longest photo edge sent to the model; 0 sends the original. Defaults to `DEFAULT_MAX_IMAGE_EDGE_PX`. */
  maxImageEdgePx?: number
  runner?: ProcessRunner
  /** Overrides the base environment (tests). Defaults to `process.env`. */
  env?: NodeJS.ProcessEnv
}

export class CliImageAnalysisProvider implements ImageAnalysisProvider {
  readonly name: string
  readonly model: string | null
  private readonly kind: CliProviderKind
  private readonly timeoutMs: number
  private readonly maxImageEdgePx: number
  private readonly runner: ProcessRunner
  private readonly baseEnv: NodeJS.ProcessEnv
  private lastUsage: AnalysisUsage | null = null
  /** Present only for providers that can send several photos in one call. */
  readonly analyzeBatch?: (inputs: ImageAnalysisInput[]) => Promise<ImageAnalysisResult[]>

  constructor(options: CliImageAnalysisProviderOptions) {
    this.kind = options.kind
    this.name = options.kind
    this.model = options.model ?? null
    this.timeoutMs = options.timeoutMs ?? DEFAULT_CLI_TIMEOUT_MS
    this.maxImageEdgePx = options.maxImageEdgePx ?? DEFAULT_MAX_IMAGE_EDGE_PX
    this.runner = options.runner ?? spawnProcessRunner
    this.baseEnv = options.env ?? process.env
    if (options.kind === 'claude-cli') this.analyzeBatch = (inputs) => this.runClaudeBatch(inputs)
  }

  getLastUsage(): AnalysisUsage | null {
    return this.lastUsage
  }

  async analyze(input: ImageAnalysisInput): Promise<ImageAnalysisResult> {
    this.lastUsage = null
    if (this.kind === 'claude-cli') return this.analyzeWithClaude(input)
    return this.analyzeWithCodex(input)
  }

  private async analyzeWithClaude(input: ImageAnalysisInput): Promise<ImageAnalysisResult> {
    const [result] = await this.runClaudeBatch([input])
    return result!
  }

  private analyzeWithCodex(input: ImageAnalysisInput): Promise<ImageAnalysisResult> {
    return withTempDir(async (dir) => {
      const photo = await shrinkForModel(input.imageBytes, input.contentType, this.maxImageEdgePx)
      const fileName = `photo.${extensionFor(photo.contentType)}`
      await writeFile(join(dir, fileName), photo.bytes)
      const text = await this.runCodex(dir, fileName, this.childEnv())
      return toAnalysisResult(extractJsonObject(text), input.schemaVersion)
    })
  }

  /** Base environment with API keys removed so the CLI uses the subscription login. */
  private childEnv(): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = { ...this.baseEnv }
    for (const key of STRIPPED_ENV_KEYS) delete env[key]
    return env
  }

  private async runClaudeBatch(inputs: ImageAnalysisInput[]): Promise<ImageAnalysisResult[]> {
    this.lastUsage = null
    if (inputs.length === 0) return []
    const count = inputs.length
    const photos = await Promise.all(inputs.map((input) => shrinkForModel(input.imageBytes, input.contentType, this.maxImageEdgePx)))
    const content: unknown[] = photos.map((photo) => ({
      type: 'image',
      source: {
        type: 'base64',
        media_type: CLAUDE_MEDIA_TYPES[extensionFor(photo.contentType)],
        data: Buffer.from(photo.bytes).toString('base64'),
      },
    }))
    content.push({ type: 'text', text: buildAnalysisPrompt(count === 1 ? 'the attached photo' : 'the attached photos', count) })
    const message = JSON.stringify({ type: 'user', message: { role: 'user', content } })

    const env = this.childEnv()
    // An empty working directory so no project instructions can be picked up.
    return withTempDir(async (dir) => {
      const args = [
        '-p',
        '--input-format', 'stream-json',
        '--output-format', 'stream-json',
        '--verbose',
        '--tools', '',
        '--setting-sources', '',
        '--strict-mcp-config',
        '--no-session-persistence',
        '--disable-slash-commands',
        '--system-prompt', CLAUDE_SYSTEM_PROMPT,
        ...(this.model ? ['--model', this.model] : []),
      ]
      const result = await this.runner('claude', args, { cwd: dir, env, timeoutMs: this.timeoutMs, stdin: `${message}\n` })
      this.assertOk('claude', result)

      let final: Record<string, unknown> | null = null
      for (const line of result.stdout.split('\n')) {
        if (!line.includes('"type":"result"') && !line.includes('"type": "result"')) continue
        try {
          const event = JSON.parse(line) as Record<string, unknown>
          if (event['type'] === 'result') final = event
        } catch {
          // not a JSON event line
        }
      }
      if (!final) throw new Error('claude CLI returned no result event')
      if (final['is_error'] === true || typeof final['result'] !== 'string') {
        throw new Error(`claude CLI reported an error: ${String(final['result'] ?? 'no result').slice(0, 300)}`)
      }
      this.lastUsage = claudeUsage(final)

      const schemaVersion = inputs[0]!.schemaVersion
      if (count === 1) return [toAnalysisResult(extractJsonObject(final['result']), schemaVersion)]
      const items = extractJsonArray(final['result'])
      if (items.length !== count) throw new CliOutputError(`claude returned ${items.length} results for ${count} photos`)
      return items.map((item) => toAnalysisResult(item, schemaVersion))
    })
  }

  private async runCodex(dir: string, fileName: string, env: NodeJS.ProcessEnv): Promise<string> {
    const outFile = join(dir, 'last-message.txt')
    const prompt = buildAnalysisPrompt('the attached photo')
    const args = [
      'exec',
      '--skip-git-repo-check',
      '--ephemeral',
      '--json',
      '-s', 'read-only',
      // No user config (MCP servers), no exec rules, no shell tool: the model
      // only needs to look at the attached photo.
      '--ignore-user-config',
      '--ignore-rules',
      '--disable', 'shell_tool',
      '-C', dir,
      '-o', outFile,
      ...(this.model ? ['-m', this.model] : []),
      '-i', join(dir, fileName),
      // The prompt goes on stdin ("-") because `-i` accepts multiple values
      // and would swallow a trailing positional prompt.
      '-',
    ]
    const started = Date.now()
    const result = await this.runner('codex', args, { cwd: dir, env, timeoutMs: this.timeoutMs, stdin: prompt })
    this.assertOk('codex', result)
    this.lastUsage = codexUsage(result.stdout, this.model, Date.now() - started)
    try {
      return await readFile(outFile, 'utf8')
    } catch {
      throw new Error('codex CLI produced no final message')
    }
  }

  private assertOk(command: string, result: ProcessRunResult): void {
    if (result.timedOut) throw new Error(`${command} CLI timed out after ${this.timeoutMs}ms`)
    if (result.code !== 0) {
      const detail = (result.stderr || result.stdout).trim().slice(0, 300)
      throw new Error(`${command} CLI exited with code ${String(result.code)}${detail ? `: ${detail}` : ''}`)
    }
  }
}
