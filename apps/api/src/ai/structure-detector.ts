import type { CompletionProvider } from './completion-provider.js'
import type { FieldMapping } from '@wivwav/types'

const SYSTEM_PROMPT = `You are an expert at analyzing HTML structure and deriving CSS selectors for data extraction.
Given a previous field mapping and updated HTML from a WAV (wheelchair accessible vehicle) listing page,
output new CSS selectors that correctly target the same data fields.
Always respond with valid JSON matching the schema provided. No markdown, no explanation — only JSON.`

interface RemapResult {
  mappings: FieldMapping[]
  confidence: number
  notes: string
}

const RAW_RESPONSE_SNIPPET_LENGTH = 500

function snippet(text: string): string {
  const collapsed = text.replace(/\s+/g, ' ').trim()
  const truncated = collapsed.length > RAW_RESPONSE_SNIPPET_LENGTH
  return `${collapsed.slice(0, RAW_RESPONSE_SNIPPET_LENGTH)}${truncated ? '…' : ''}`
}

export class StructureDetector {
  constructor(private readonly provider: CompletionProvider) {}

  async remapFields(options: {
    sourceName: string
    previousMappings: FieldMapping[]
    sampleHtml: string
  }): Promise<RemapResult> {
    const userPrompt = `Source: ${options.sourceName}

Previous mappings:
${JSON.stringify(options.previousMappings, null, 2)}

Updated HTML sample (first 32000 chars):
${options.sampleHtml.slice(0, 32000)}

Return JSON: { "mappings": [{ "targetField": string, "selector": string, "attribute": string|null, "transform": string|null }], "confidence": 0-1, "notes": string }`

    const text = await this.provider.complete(SYSTEM_PROMPT, userPrompt)

    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (!jsonMatch?.[0]) {
      throw new Error(`AI provider did not return valid JSON. Raw response: ${snippet(text)}`)
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(jsonMatch[0])
    } catch (err) {
      const parseErrMsg = err instanceof Error ? err.message : String(err)
      throw new Error(`AI remap response was not valid JSON (${parseErrMsg}). Raw response: ${snippet(text)}`, { cause: err })
    }
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      typeof (parsed as Record<string, unknown>).confidence !== 'number' ||
      !Number.isFinite((parsed as Record<string, unknown>).confidence as number) ||
      !Array.isArray((parsed as Record<string, unknown>).mappings) ||
      typeof (parsed as Record<string, unknown>).notes !== 'string'
    ) {
      throw new Error(
        `AI remap response missing/invalid fields — expected numeric 'confidence', array 'mappings', and string 'notes'; got: ${JSON.stringify(parsed)}`
      )
    }

    return parsed as RemapResult
  }
}
