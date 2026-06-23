/**
 * WivWav Scraper AI Extraction Eval Runner
 *
 * Runs the StructureDetector extraction prompt against two candidate models:
 *   - Anthropic claude-haiku-4-5-20251001
 *   - Ollama llama3.2:3b (local)
 *
 * For each fixture in promptfoo.yaml, the runner:
 *   1. Reads the HTML fixture and expected.json ground truth
 *   2. Calls each model with the StructureDetector prompt
 *   3. Parses the returned JSON and compares selectors field-by-field
 *   4. Computes field-level accuracy = matched fields / expected fields
 *   5. Writes a JSON report to evals/report.json
 *   6. Exits non-zero if any model falls below ACCURACY_THRESHOLD
 *
 * Usage:
 *   pnpm eval
 *   ANTHROPIC_API_KEY=sk-... pnpm eval
 *   OLLAMA_BASE_URL=http://localhost:11434 pnpm eval
 *
 * Adding a new fixture:
 *   See promptfoo.yaml — add the HTML + expected.json pair and a test case entry.
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SCRAPER_ROOT = resolve(__dirname, '..')
const REPORT_PATH = resolve(__dirname, 'report.json')

/** Minimum field-level accuracy for a model to pass. Range: 0–1. */
const ACCURACY_THRESHOLD = 0.75

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface FieldMapping {
  targetField: string
  selector: string
  attribute: string | null
  transform: string | null
}

interface ExpectedOutput {
  mappings: FieldMapping[]
  confidence: number
  notes: string
}

interface ModelResult {
  mappings: FieldMapping[]
  confidence: number
  notes: string
}

interface FixtureResult {
  fixture: string
  description: string
  modelResults: Record<string, {
    accuracy: number
    matchedFields: number
    totalExpected: number
    latencyMs: number
    error?: string
    raw?: string
  }>
}

interface EvalReport {
  runAt: string
  threshold: number
  fixtures: FixtureResult[]
  summary: Record<string, {
    averageAccuracy: number
    passedFixtures: number
    failedFixtures: number
    passed: boolean
  }>
}

// ---------------------------------------------------------------------------
// Prompt building
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You are an expert at analyzing HTML structure and deriving CSS selectors for data extraction.
Given a previous field mapping and updated HTML from a WAV (wheelchair accessible vehicle) listing page,
output new CSS selectors that correctly target the same data fields.
Always respond with valid JSON matching the schema provided. No markdown, no explanation — only JSON.`

function buildUserPrompt(sourceName: string, previousMappings: string, htmlSample: string): string {
  return `Source: ${sourceName}

Previous mappings:
${previousMappings}

Updated HTML sample (first 32000 chars):
${htmlSample.slice(0, 32000)}

Return JSON: { "mappings": [{ "targetField": string, "selector": string, "attribute": string|null, "transform": string|null }], "confidence": 0-1, "notes": string }`
}

// ---------------------------------------------------------------------------
// Model providers
// ---------------------------------------------------------------------------

async function callAnthropic(userPrompt: string): Promise<string> {
  const apiKey = process.env['ANTHROPIC_API_KEY']
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set — skipping Anthropic model')

  const model = process.env['ANTHROPIC_MODEL'] ?? 'claude-haiku-4-5-20251001'
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: 2048,
      temperature: 0.1,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userPrompt }],
    }),
  })

  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(`Anthropic request failed: ${response.status}${text ? ` — ${text}` : ''}`)
  }

  interface AnthropicMsg { content: Array<{ type: string; text: string }> }
  const data = (await response.json()) as AnthropicMsg
  return data.content?.[0]?.text ?? ''
}

async function callOllama(userPrompt: string): Promise<string> {
  const baseUrl = process.env['OLLAMA_BASE_URL'] ?? 'http://localhost:11434'
  const model = process.env['OLLAMA_MODEL'] ?? 'llama3.2:3b'

  const response = await fetch(`${baseUrl}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      system: SYSTEM_PROMPT,
      prompt: userPrompt,
      stream: false,
      options: { num_predict: 2048, temperature: 0.1 },
    }),
    signal: AbortSignal.timeout(60_000),
  })

  if (!response.ok) {
    throw new Error(`Ollama request failed: ${response.status} ${response.statusText}`)
  }

  interface OllamaResp { response: string }
  const data = (await response.json()) as OllamaResp
  return data.response
}

// ---------------------------------------------------------------------------
// Accuracy scoring
// ---------------------------------------------------------------------------

function parseModelOutput(raw: string): ModelResult | null {
  try {
    const jsonMatch = raw.match(/\{[\s\S]*\}/)
    if (!jsonMatch?.[0]) return null
    return JSON.parse(jsonMatch[0]) as ModelResult
  } catch {
    return null
  }
}

/**
 * Computes field-level accuracy between model output and expected ground truth.
 *
 * A field is considered "matched" when the model returns a mapping for that
 * targetField AND the selector matches the expected selector exactly.
 * Selectors are compared case-insensitively and whitespace-normalized.
 */
function scoreAccuracy(model: ModelResult | null, expected: ExpectedOutput): number {
  if (!model?.mappings) return 0
  const modelMap = new Map(
    model.mappings.map(m => [
      m.targetField.toLowerCase(),
      m.selector.toLowerCase().replace(/\s+/g, ' ').trim(),
    ]),
  )

  let matched = 0
  for (const exp of expected.mappings) {
    const modelSelector = modelMap.get(exp.targetField.toLowerCase())
    const expectedSelector = exp.selector.toLowerCase().replace(/\s+/g, ' ').trim()
    if (modelSelector === expectedSelector) matched++
  }

  return expected.mappings.length > 0 ? matched / expected.mappings.length : 0
}

// ---------------------------------------------------------------------------
// Fixture loading
// ---------------------------------------------------------------------------

interface Fixture {
  name: string
  description: string
  sourceName: string
  htmlFile: string
  expectedFile: string
  previousMappings: string
}

function loadFixtures(): Fixture[] {
  // Load from promptfoo.yaml tests section
  const yamlPath = resolve(SCRAPER_ROOT, 'promptfoo.yaml')
  const yaml = readFileSync(yamlPath, 'utf-8')

  // Parse test cases via a minimal YAML reader (avoid adding yaml dep)
  const fixtures: Fixture[] = []
  const testBlocks = yaml.split(/^  - description:/m).slice(1)

  for (const block of testBlocks) {
    const descMatch = block.match(/^[^\n"]*"([^"]+)"/)
    const sourceMatch = block.match(/sourceName:\s*"([^"]+)"/)
    const htmlMatch = block.match(/htmlFile:\s*"([^"]+)"/)
    const expectedMatch = block.match(/expectedFile:\s*"([^"]+)"/)
    const prevMatch = block.match(/previousMappings:\s*"([^"]+)"/)

    if (!descMatch || !sourceMatch || !htmlMatch || !expectedMatch) continue

    fixtures.push({
      name: htmlMatch[1]!,
      description: descMatch[1]!,
      sourceName: sourceMatch[1]!,
      htmlFile: htmlMatch[1]!,
      expectedFile: expectedMatch[1]!,
      previousMappings: prevMatch?.[1] ?? '[]',
    })
  }

  return fixtures
}

// ---------------------------------------------------------------------------
// Main runner
// ---------------------------------------------------------------------------

const MODELS: Record<string, (prompt: string) => Promise<string>> = {
  'claude-haiku-4-5-20251001': callAnthropic,
  'llama3.2:3b': callOllama,
}

async function runFixture(
  fixture: Fixture,
  modelName: string,
  callModel: (prompt: string) => Promise<string>,
): Promise<FixtureResult['modelResults'][string]> {
  const htmlPath = resolve(SCRAPER_ROOT, fixture.htmlFile)
  const expectedPath = resolve(SCRAPER_ROOT, fixture.expectedFile)

  const html = readFileSync(htmlPath, 'utf-8')
  const expected = JSON.parse(readFileSync(expectedPath, 'utf-8')) as ExpectedOutput
  const userPrompt = buildUserPrompt(fixture.sourceName, fixture.previousMappings, html)

  const start = Date.now()
  try {
    const raw = await callModel(userPrompt)
    const latencyMs = Date.now() - start
    const parsed = parseModelOutput(raw)
    const accuracy = scoreAccuracy(parsed, expected)
    return {
      accuracy,
      matchedFields: Math.round(accuracy * expected.mappings.length),
      totalExpected: expected.mappings.length,
      latencyMs,
      raw: raw.slice(0, 500),
    }
  } catch (err) {
    return {
      accuracy: 0,
      matchedFields: 0,
      totalExpected: 0,
      latencyMs: Date.now() - start,
      error: String(err),
    }
  }
}

async function main(): Promise<void> {
  console.log('WivWav scraper eval — loading fixtures from promptfoo.yaml...')
  const fixtures = loadFixtures()
  console.log(`Found ${fixtures.length} fixture(s). Testing ${Object.keys(MODELS).length} model(s).`)

  const report: EvalReport = {
    runAt: new Date().toISOString(),
    threshold: ACCURACY_THRESHOLD,
    fixtures: [],
    summary: {},
  }

  const modelAccumulators: Record<string, { totalAccuracy: number; passed: number; failed: number }> = {}
  for (const modelName of Object.keys(MODELS)) {
    modelAccumulators[modelName] = { totalAccuracy: 0, passed: 0, failed: 0 }
  }

  for (const fixture of fixtures) {
    console.log(`\n--- Fixture: ${fixture.description} ---`)
    const fixtureResult: FixtureResult = {
      fixture: fixture.htmlFile,
      description: fixture.description,
      modelResults: {},
    }

    for (const [modelName, callModel] of Object.entries(MODELS)) {
      process.stdout.write(`  ${modelName}: `)
      const result = await runFixture(fixture, modelName, callModel)
      fixtureResult.modelResults[modelName] = result

      const acc = modelAccumulators[modelName]!
      acc.totalAccuracy += result.accuracy

      if (result.error) {
        console.log(`ERROR — ${result.error}`)
        acc.failed++
      } else {
        const pct = (result.accuracy * 100).toFixed(0)
        const pass = result.accuracy >= ACCURACY_THRESHOLD ? 'PASS' : 'FAIL'
        console.log(`${pass} — ${pct}% accuracy (${result.matchedFields}/${result.totalExpected} fields) in ${result.latencyMs}ms`)
        if (result.accuracy >= ACCURACY_THRESHOLD) {
          acc.passed++
        } else {
          acc.failed++
        }
      }
    }

    report.fixtures.push(fixtureResult)
  }

  // Build summary
  let anyFailed = false
  for (const [modelName, acc] of Object.entries(modelAccumulators)) {
    const avgAccuracy = fixtures.length > 0 ? acc.totalAccuracy / fixtures.length : 0
    const passed = acc.failed === 0 && avgAccuracy >= ACCURACY_THRESHOLD
    report.summary[modelName] = {
      averageAccuracy: avgAccuracy,
      passedFixtures: acc.passed,
      failedFixtures: acc.failed,
      passed,
    }
    if (!passed) anyFailed = true
  }

  // Print summary table
  console.log('\n=== Summary ===')
  console.log(`Threshold: ${(ACCURACY_THRESHOLD * 100).toFixed(0)}%\n`)
  for (const [modelName, summary] of Object.entries(report.summary)) {
    const status = summary.passed ? 'PASS' : 'FAIL'
    const avg = (summary.averageAccuracy * 100).toFixed(1)
    console.log(`  ${status}  ${modelName}: avg ${avg}% accuracy (${summary.passedFixtures} passed, ${summary.failedFixtures} failed)`)
  }

  // Write JSON report
  writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2))
  console.log(`\nReport written to: ${REPORT_PATH}`)

  if (anyFailed) {
    console.error('\nOne or more models failed to meet the accuracy threshold. See report for details.')
    process.exit(1)
  }

  console.log('\nAll models passed.')
}

main().catch((err) => {
  console.error('Eval runner crashed:', err)
  process.exit(1)
})
