import { describe, it, expect, vi } from 'vitest'
import { existsSync } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { CliImageAnalysisProvider, shrinkForModel, type ProcessRunner } from './cli-image-analysis-provider.js'
import {
  CLAUDE_SYSTEM_PROMPT,
  CliOutputError,
  claudeUsage,
  codexUsage,
  extractJsonArray,
  extractJsonObject,
  toAnalysisResult,
} from './cli-output-parsers.js'
import { spawnProcessRunner } from './cli-process-runner.js'
import { validateImageAnalysisResult } from './semantic-image-analysis.js'

const input = { imageBytes: new Uint8Array([1, 2, 3]), contentType: 'image/jpeg', schemaVersion: '1' }
const GOOD = { altText: 'A van with a ramp.', summary: null, labels: [{ label: 'ramp', confidence: 0.9 }], fieldClaims: [] }

function streamOut(result: string, extra: Record<string, unknown> = {}, isError = false): string {
  return [
    JSON.stringify({ type: 'system', subtype: 'init' }),
    JSON.stringify({ type: 'assistant', message: {} }),
    JSON.stringify({ type: 'result', subtype: 'success', is_error: isError, result, ...extra }),
  ].join('\n')
}

function claudeRunner(result: string, overrides: Partial<{ code: number | null; timedOut: boolean }> = {}): ProcessRunner {
  return vi.fn(async () => ({
    code: overrides.code ?? 0,
    stdout: streamOut(result),
    stderr: '',
    timedOut: overrides.timedOut ?? false,
  }))
}

describe('extractJsonObject', () => {
  it('reads a fenced object surrounded by prose', () => {
    expect(extractJsonObject('Here you go:\n```json\n{"a":1}\n```')).toEqual({ a: 1 })
  })
  it('throws when there is no object', () => {
    expect(() => extractJsonObject('no json here')).toThrow(/No JSON object/)
  })
  it('throws on malformed JSON', () => {
    expect(() => extractJsonObject('{"a": }')).toThrow(/malformed/)
  })
})

describe('extractJsonArray', () => {
  it('reads a fenced array', () => {
    expect(extractJsonArray('```json\n[{"a":1},{"a":2}]\n```')).toHaveLength(2)
  })
  it('throws when there is no array or it is malformed', () => {
    expect(() => extractJsonArray('nothing')).toThrow(/No JSON array/)
    expect(() => extractJsonArray('[1,')).toThrow()
  })
})

describe('toAnalysisResult', () => {
  it('forces the schema version and drops out-of-taxonomy labels and fields', () => {
    const result = toAnalysisResult(
      {
        schemaVersion: '999',
        altText: 'x',
        summary: 'y',
        labels: [{ label: 'ramp', confidence: 0.8 }, { label: 'banana', confidence: 0.9 }],
        fieldClaims: [
          { field: 'rampType', claimedValue: 'in_floor', confidence: 0.7 },
          { field: 'price', claimedValue: '1', confidence: 0.9 },
        ],
      },
      '1',
    )
    expect(result.schemaVersion).toBe('1')
    expect(result.labels).toEqual([{ label: 'ramp', confidence: 0.8 }])
    expect(result.fieldClaims).toHaveLength(1)
    expect(validateImageAnalysisResult(result)).not.toBeNull()
  })

  it('caps alt text at 125 characters and summary at 300', () => {
    const result = toAnalysisResult({ ...GOOD, altText: 'a'.repeat(500), summary: 's'.repeat(900) }, '1')
    expect(result.altText).toHaveLength(125)
    expect(result.summary).toHaveLength(300)
  })
})

describe('CliImageAnalysisProvider (claude-cli)', () => {
  it('returns a validated result from the stream-json result event', async () => {
    const runner = claudeRunner('```json\n' + JSON.stringify(GOOD) + '\n```')
    const provider = new CliImageAnalysisProvider({ kind: 'claude-cli', runner, env: {} })
    const result = await provider.analyze(input)
    expect(validateImageAnalysisResult(result)).not.toBeNull()
    expect(result.labels).toEqual([{ label: 'ramp', confidence: 0.9 }])
  })

  it('sends the photo inline with no tools, no settings and a one-line system prompt, and writes nothing to disk', async () => {
    const runner = claudeRunner(JSON.stringify(GOOD))
    const provider = new CliImageAnalysisProvider({ kind: 'claude-cli', runner, env: {}, model: 'haiku' })
    await provider.analyze(input)
    const [command, args, options] = vi.mocked(runner).mock.calls[0]!
    expect(command).toBe('claude')
    expect(args).toEqual(expect.arrayContaining(['--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--strict-mcp-config', '--no-session-persistence', '--model', 'haiku']))
    expect(args[args.indexOf('--tools') + 1]).toBe('')
    expect(args[args.indexOf('--setting-sources') + 1]).toBe('')
    expect(args[args.indexOf('--system-prompt') + 1]).toBe(CLAUDE_SYSTEM_PROMPT)
    const sent = JSON.parse(options.stdin!.trim()) as { message: { content: Array<{ type: string; source?: { data: string; media_type: string } }> } }
    expect(sent.message.content[0]).toMatchObject({ type: 'image', source: { media_type: 'image/jpeg', data: Buffer.from([1, 2, 3]).toString('base64') } })
    expect(sent.message.content.at(-1)!.type).toBe('text')
  })

  it('removes API key variables from the child environment and runs from an empty directory that is cleaned up', async () => {
    let cwd = ''
    const runner: ProcessRunner = vi.fn(async (_c, _a, options) => {
      cwd = options.cwd
      expect(options.env).toEqual({ PATH: '/bin' })
      return { code: 0, stdout: streamOut(JSON.stringify(GOOD)), stderr: '', timedOut: false }
    })
    const provider = new CliImageAnalysisProvider({
      kind: 'claude-cli',
      runner,
      env: { PATH: '/bin', ANTHROPIC_API_KEY: 'k', OPENAI_API_KEY: 'k', CODEX_API_KEY: 'k', ANTHROPIC_AUTH_TOKEN: 'k' },
    })
    await provider.analyze(input)
    expect(cwd).toContain('wivwav-image-analysis-')
    expect(existsSync(cwd)).toBe(false)
  })

  it('parses the extra details and ignores values outside the allowed sets', async () => {
    const runner = claudeRunner(
      JSON.stringify({ ...GOOD, color: 'Silver ', conversionManufacturer: 'BraunAbility', viewAngle: 'side', photoQuality: 'excellent' }),
    )
    const result = await new CliImageAnalysisProvider({ kind: 'claude-cli', runner, env: {} }).analyze(input)
    expect(result.extras).toEqual({ color: 'Silver', conversionManufacturer: 'BraunAbility', viewAngle: 'side', photoQuality: null })
  })

  it('analyzes several photos in one call and returns results in order', async () => {
    const runner = claudeRunner(JSON.stringify([GOOD, { ...GOOD, altText: 'second' }]))
    const provider = new CliImageAnalysisProvider({ kind: 'claude-cli', runner, env: {} })
    const results = await provider.analyzeBatch!([input, input])
    expect(results.map((r) => r.altText)).toEqual(['A van with a ramp.', 'second'])
    expect(runner).toHaveBeenCalledTimes(1)
    const sent = JSON.parse(vi.mocked(runner).mock.calls[0]![2].stdin!.trim()) as { message: { content: Array<{ type: string }> } }
    expect(sent.message.content.filter((c) => c.type === 'image')).toHaveLength(2)
  })

  it('throws when a batch returns the wrong number of results', async () => {
    const runner = claudeRunner(JSON.stringify([GOOD]))
    const provider = new CliImageAnalysisProvider({ kind: 'claude-cli', runner, env: {} })
    await expect(provider.analyzeBatch!([input, input])).rejects.toThrow(/1 results for 2 photos/)
    await expect(provider.analyzeBatch!([input, input])).rejects.toBeInstanceOf(CliOutputError)
  })

  it('returns nothing for an empty batch without calling the CLI', async () => {
    const runner = claudeRunner(JSON.stringify(GOOD))
    const provider = new CliImageAnalysisProvider({ kind: 'claude-cli', runner, env: {} })
    await expect(provider.analyzeBatch!([])).resolves.toEqual([])
    expect(runner).not.toHaveBeenCalled()
  })

  it.each([
    ['non-zero exit', claudeRunner('x', { code: 1 }), /exited with code 1/],
    ['timeout', claudeRunner('x', { timedOut: true }), /timed out/],
    ['no JSON in text', claudeRunner('I cannot see an image'), /No JSON object/],
  ])('throws on %s and still removes the temp directory', async (_name, runner, pattern) => {
    let dir = ''
    const wrapped: ProcessRunner = async (c, a, o) => {
      dir = o.cwd
      return runner(c, a, o)
    }
    await expect(new CliImageAnalysisProvider({ kind: 'claude-cli', runner: wrapped, env: {} }).analyze(input)).rejects.toThrow(pattern)
    expect(existsSync(dir)).toBe(false)
  })

  it('throws a clear error when the CLI reports an error result or no result event', async () => {
    const errored: ProcessRunner = async () => ({ code: 0, stdout: streamOut('Not logged in', {}, true), stderr: '', timedOut: false })
    await expect(new CliImageAnalysisProvider({ kind: 'claude-cli', runner: errored, env: {} }).analyze(input)).rejects.toThrow(/Not logged in/)
    const silent: ProcessRunner = async () => ({ code: 0, stdout: '{"type":"system"}', stderr: '', timedOut: false })
    await expect(new CliImageAnalysisProvider({ kind: 'claude-cli', runner: silent, env: {} }).analyze(input)).rejects.toThrow(/no result event/)
  })

  it('surfaces a missing binary', async () => {
    const runner: ProcessRunner = async () => {
      throw new Error('"claude" was not found on PATH; install it and sign in first')
    }
    await expect(new CliImageAnalysisProvider({ kind: 'claude-cli', runner, env: {} }).analyze(input)).rejects.toThrow(/not found/)
  })

  it('codex has no batch support', () => {
    expect(new CliImageAnalysisProvider({ kind: 'codex-cli', env: {} }).analyzeBatch).toBeUndefined()
  })
})

describe('CliImageAnalysisProvider (codex-cli)', () => {
  async function codexHome(): Promise<string> {
    const home = await mkdtemp(join(tmpdir(), 'codex-src-'))
    await writeFile(join(home, 'auth.json'), '{"token":"t"}')
    await writeFile(join(home, 'config.toml'), '[mcp_servers.x]')
    return home
  }

  it('ignores user config and rules, disables the shell tool, and keeps the real CODEX_HOME', async () => {
    const runner: ProcessRunner = vi.fn(async (_c, args) => {
      await writeFile(args[args.indexOf('-o') + 1]!, JSON.stringify(GOOD))
      return { code: 0, stdout: '', stderr: '', timedOut: false }
    })
    await new CliImageAnalysisProvider({ kind: 'codex-cli', runner, env: { CODEX_HOME: '/real/home' } }).analyze(input)
    const [, args, options] = vi.mocked(runner).mock.calls[0]!
    expect(args).toEqual(expect.arrayContaining(['--ignore-user-config', '--ignore-rules']))
    expect(args[args.indexOf('--disable') + 1]).toBe('shell_tool')
    expect(options.env['CODEX_HOME']).toBe('/real/home')
  })

  it.each([
    ['success', 0],
    ['non-zero exit', 1],
  ])('removes the temp directory after %s', async (_name, code) => {
    const source = await codexHome()
    let dir = ''
    const runner: ProcessRunner = async (_c, args, options) => {
      dir = options.cwd
      await writeFile(args[args.indexOf('-o') + 1]!, JSON.stringify(GOOD))
      return { code, stdout: '', stderr: '', timedOut: false }
    }
    const run = new CliImageAnalysisProvider({ kind: 'codex-cli', runner, env: { CODEX_HOME: source } }).analyze(input)
    if (code === 0) await run
    else await expect(run).rejects.toThrow(/exited with code 1/)
    expect(dir).toContain('wivwav-image-analysis-')
    expect(existsSync(dir)).toBe(false)
    await rm(source, { recursive: true, force: true })
  })


  it('sends the prompt on stdin, attaches the image and reads the last-message file', async () => {
    const runner: ProcessRunner = vi.fn(async (_c, args, options) => {
      const outFile = args[args.indexOf('-o') + 1]!
      await writeFile(outFile, JSON.stringify(GOOD))
      expect(options.stdin).toContain('Return ONLY one JSON object')
      return { code: 0, stdout: '', stderr: '', timedOut: false }
    })
    const source = await codexHome()
    const provider = new CliImageAnalysisProvider({ kind: 'codex-cli', runner, env: { CODEX_HOME: source }, model: 'some-model' })
    const result = await provider.analyze(input)
    const args = vi.mocked(runner).mock.calls[0]![1]
    expect(args[args.indexOf('-i') + 1]).toMatch(/photo\.jpg$/)
    expect(args.at(-1)).toBe('-')
    expect(args).toContain('some-model')
    expect(result.labels).toHaveLength(1)
  })

  it('throws when codex produced no final message', async () => {
    const runner: ProcessRunner = async () => ({ code: 0, stdout: '', stderr: '', timedOut: false })
    const env = { CODEX_HOME: await codexHome() }
    await expect(new CliImageAnalysisProvider({ kind: 'codex-cli', runner, env }).analyze(input)).rejects.toThrow(/no final message/)
  })
})

describe('spawnProcessRunner', () => {
  const base = { cwd: tmpdir(), env: process.env }

  it('kills a hung process and resolves as timed out', async () => {
    const started = Date.now()
    const result = await spawnProcessRunner(process.execPath, ['-e', 'setTimeout(()=>{},1e4)'], { ...base, timeoutMs: 50 })
    expect(result.timedOut).toBe(true)
    expect(Date.now() - started).toBeLessThan(5000)
  })

  it('collects output from a process that exits normally', async () => {
    const result = await spawnProcessRunner(process.execPath, ['-e', 'process.stdout.write("hi")'], { ...base, timeoutMs: 10_000 })
    expect(result).toMatchObject({ code: 0, stdout: 'hi', timedOut: false })
  })

  it('reports a missing binary clearly', async () => {
    await expect(spawnProcessRunner('wivwav-no-such-binary', [], { ...base, timeoutMs: 1000 })).rejects.toThrow(/not found on PATH/)
  })
})

describe('usage reporting', () => {
  it('reads cost, tokens, duration and model from the claude envelope', () => {
    const usage = claudeUsage({
      total_cost_usd: 0.047,
      duration_ms: 1757,
      usage: { input_tokens: 2, cache_read_input_tokens: 8000, cache_creation_input_tokens: 3000, output_tokens: 90 },
      modelUsage: { 'claude-sonnet-5-5': {} },
    })
    expect(usage).toEqual({
      model: 'claude-sonnet-5-5',
      costUsd: 0.047,
      inputTokens: 11002,
      outputTokens: 90,
      cachedInputTokens: 8000,
      durationMs: 1757,
    })
  })

  it('returns nulls when the envelope has no usage', () => {
    expect(claudeUsage({})).toMatchObject({ model: null, costUsd: null, inputTokens: null, outputTokens: null })
  })

  it('reads tokens from the last codex turn.completed event and reports no cost', () => {
    const jsonl = [
      '{"type":"thread.started"}',
      'not json',
      '{"type":"turn.completed","usage":{"input_tokens":46705,"cached_input_tokens":2816,"output_tokens":87}}',
    ].join('\n')
    expect(codexUsage(jsonl, null, 5000)).toEqual({
      model: null,
      costUsd: null,
      inputTokens: 46705,
      outputTokens: 87,
      cachedInputTokens: 2816,
      durationMs: 5000,
    })
  })

  it('exposes usage after a successful claude call and clears it on the next attempt', async () => {
    const runner: ProcessRunner = async () => ({
      code: 0,
      stdout: streamOut(JSON.stringify(GOOD), { total_cost_usd: 0.02, modelUsage: { m: {} } }),
      stderr: '',
      timedOut: false,
    })
    const provider = new CliImageAnalysisProvider({ kind: 'claude-cli', runner, env: {} })
    expect(provider.getLastUsage()).toBeNull()
    await provider.analyze(input)
    expect(provider.getLastUsage()).toMatchObject({ costUsd: 0.02, model: 'm' })
    const failing = new CliImageAnalysisProvider({ kind: 'claude-cli', runner: async () => ({ code: 1, stdout: '', stderr: '', timedOut: false }), env: {} })
    await expect(failing.analyze(input)).rejects.toThrow()
    expect(failing.getLastUsage()).toBeNull()
  })
})

describe('shrinkForModel', () => {
  async function photo(width: number, height: number) {
    return sharp({ create: { width, height, channels: 3, background: { r: 120, g: 80, b: 40 } } }).jpeg({ quality: 95 }).toBuffer()
  }

  it('shrinks a large photo so its longest edge fits', async () => {
    const original = await photo(2000, 1000)
    const result = await shrinkForModel(original, 'image/jpeg', 500)
    const meta = await sharp(result.bytes).metadata()
    expect(meta.width).toBe(500)
    expect(meta.height).toBe(250)
    expect(result.contentType).toBe('image/jpeg')
  })

  it('returns the original when resizing is off, the image is already small, or it cannot be decoded', async () => {
    const original = await photo(300, 200)
    expect((await shrinkForModel(original, 'image/jpeg', 0)).bytes).toBe(original)
    expect((await shrinkForModel(original, 'image/jpeg', 1024)).bytes).toBe(original)
    const junk = new Uint8Array([1, 2, 3])
    expect((await shrinkForModel(junk, 'image/png', 500))).toEqual({ bytes: junk, contentType: 'image/png' })
  })

  it('sends the shrunk photo to claude', async () => {
    const original = await photo(2000, 1000)
    const runner = claudeRunner(JSON.stringify(GOOD))
    const provider = new CliImageAnalysisProvider({ kind: 'claude-cli', runner, env: {}, maxImageEdgePx: 400 })
    await provider.analyze({ ...input, imageBytes: original })
    const sent = JSON.parse(vi.mocked(runner).mock.calls[0]![2].stdin!.trim()) as { message: { content: Array<{ source?: { data: string } }> } }
    const meta = await sharp(Buffer.from(sent.message.content[0]!.source!.data, 'base64')).metadata()
    expect(meta.width).toBe(400)
  })
})
