/** Prompt building and CLI-output parsing for the local image-analysis providers (#1112). */

import { IMAGE_LABELS, PHOTO_QUALITIES, VIEW_ANGLES } from './image-analysis-provider.js'
import type { AnalysisUsage, ImageAnalysisExtras, ImageAnalysisResult } from './image-analysis-provider.js'

/** The model's reply was unusable (no JSON, malformed, wrong count); a retry may help, unlike a timeout or exit failure. */
export class CliOutputError extends Error {
  override readonly name = 'CliOutputError'
}

export const MAX_ALT_TEXT_CHARS = 125
export const MAX_SUMMARY_CHARS = 300

export const CLAUDE_SYSTEM_PROMPT = 'You label photos from used wheelchair-accessible vehicle listings. Reply with JSON only.'

const RESULT_SHAPE =
  '{"altText": string|null, "summary": string|null, "labels": [{"label": string, "confidence": number}], "fieldClaims": [{"field": string, "claimedValue": string, "confidence": number}], "color": string|null, "conversionManufacturer": string|null, "viewAngle": string|null, "photoQuality": string|null}'

export function buildAnalysisPrompt(subject: string, count = 1): string {
  return [
    count === 1
      ? `Analyze ${subject}. Return ONLY one JSON object, with no commentary and no code fences, in exactly this shape:`
      : `Analyze each of the ${count} photos in ${subject}, in order. Return ONLY a JSON array of exactly ${count} objects, one per photo in the same order, with no commentary and no code fences. Each object has exactly this shape:`,
    RESULT_SHAPE,
    '',
    `"label" must be one of: ${IMAGE_LABELS.join(', ')}. Include a label only if clearly visible; omit it otherwise.`,
    'Meaning of labels: exterior = whole-vehicle outside shot; interior = cabin or cargo area; ramp = a deployed or stowed wheelchair ramp is visible; lift = a platform lift; lowered_floor = lowered-floor conversion visible; tie_downs = wheelchair securement; hand_controls = driver hand controls; transfer_seat = transfer seat; odometer = readable odometer; vin_plate = readable VIN plate; window_sticker = window sticker; damage = visible body damage; dealer_branding = dealer logo or signage.',
    '"confidence" is 0 to 1 and must reflect how sure you are from that photo alone.',
    '',
    'fieldClaims are only for these two fields, and only when that photo shows it clearly:',
    '- field "conversionType", claimedValue "rear_entry" or "side_entry" (where the wheelchair enters)',
    '- field "rampType", claimedValue "in_floor", "fold_out" or "fold_in"',
    'Use an empty fieldClaims array when unsure. Do not guess.',
    '',
    `"color" is the vehicle body color in one or two lowercase words, or null. "conversionManufacturer" is the conversion maker only when a badge or logo is legible (for example BraunAbility, VMI, Vantage), otherwise null. "viewAngle" is one of: ${VIEW_ANGLES.join(', ')}. "photoQuality" is one of: ${PHOTO_QUALITIES.join(', ')} (watermark_or_placeholder = stock image, placeholder or heavy watermark).`,
    '"altText" is one factual sentence of at most 125 characters for screen readers. "summary" is at most one short sentence. Use null for either when the photo is not a vehicle photo.',
  ].join('\n')
}

/**
 * Pulls the first JSON object out of model text that may be wrapped in
 * fences or surrounded by prose.
 */
export function extractJsonObject(text: string): unknown {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end <= start) throw new CliOutputError('No JSON object found in CLI output')
  try {
    return JSON.parse(text.slice(start, end + 1))
  } catch {
    throw new CliOutputError('CLI output contained malformed JSON')
  }
}

/** Pulls the first JSON array out of model text, for batched replies. */
export function extractJsonArray(text: string): unknown[] {
  const start = text.indexOf('[')
  const end = text.lastIndexOf(']')
  if (start === -1 || end <= start) throw new CliOutputError('No JSON array found in CLI output')
  let parsed: unknown
  try {
    parsed = JSON.parse(text.slice(start, end + 1))
  } catch {
    throw new CliOutputError('CLI output contained malformed JSON')
  }
  if (!Array.isArray(parsed)) throw new CliOutputError('CLI output was not a JSON array')
  return parsed
}

/**
 * Keeps schema validation meaningful without letting one out-of-taxonomy
 * label discard an otherwise good result: unknown labels and claim fields
 * cannot back a claim, so they are dropped here. Everything else is passed
 * through for `validateImageAnalysisResult` to judge.
 */
export function toAnalysisResult(raw: unknown, schemaVersion: string): ImageAnalysisResult {
  if (typeof raw !== 'object' || raw === null) throw new CliOutputError('CLI output was not a JSON object')
  const value = raw as Record<string, unknown>
  const knownLabels = IMAGE_LABELS as readonly string[]
  const knownFields = ['conversionType', 'rampType']
  const labels = Array.isArray(value['labels'])
    ? value['labels'].filter(
        (entry): entry is { label: ImageAnalysisResult['labels'][number]['label']; confidence: number } =>
          typeof entry === 'object' && entry !== null && knownLabels.includes((entry as { label?: unknown }).label as string),
      )
    : []
  const fieldClaims = Array.isArray(value['fieldClaims'])
    ? value['fieldClaims'].filter(
        (entry): entry is ImageAnalysisResult['fieldClaims'][number] =>
          typeof entry === 'object' && entry !== null && knownFields.includes((entry as { field?: unknown }).field as string),
      )
    : []
  return {
    schemaVersion,
    altText: typeof value['altText'] === 'string' ? value['altText'].slice(0, MAX_ALT_TEXT_CHARS) : null,
    summary: typeof value['summary'] === 'string' ? value['summary'].slice(0, MAX_SUMMARY_CHARS) : null,
    labels,
    fieldClaims,
    extras: toExtras(value),
  }
}

function oneOf<T extends string>(allowed: readonly T[], value: unknown): T | null {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : null
}

function shortText(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim().slice(0, 60) : null
}

export function toExtras(value: Record<string, unknown>): ImageAnalysisExtras {
  return {
    color: shortText(value['color']),
    conversionManufacturer: shortText(value['conversionManufacturer']),
    viewAngle: oneOf(VIEW_ANGLES, value['viewAngle']),
    photoQuality: oneOf(PHOTO_QUALITIES, value['photoQuality']),
  }
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/** Usage from `claude -p --output-format json`; cost is the CLI's API-equivalent figure. */
export function claudeUsage(envelope: Record<string, unknown>): AnalysisUsage {
  const usage = (envelope['usage'] ?? {}) as Record<string, unknown>
  const modelUsage = envelope['modelUsage']
  const models = typeof modelUsage === 'object' && modelUsage !== null ? Object.keys(modelUsage) : []
  const cacheRead = num(usage['cache_read_input_tokens'])
  const cacheWrite = num(usage['cache_creation_input_tokens'])
  const input = num(usage['input_tokens'])
  return {
    model: models[0] ?? null,
    costUsd: num(envelope['total_cost_usd']),
    inputTokens: input === null && cacheRead === null && cacheWrite === null ? null : (input ?? 0) + (cacheRead ?? 0) + (cacheWrite ?? 0),
    outputTokens: num(usage['output_tokens']),
    cachedInputTokens: cacheRead,
    durationMs: num(envelope['duration_ms']),
  }
}

/** Usage from `codex exec --json` JSONL; Codex reports tokens but no cost. */
export function codexUsage(jsonl: string, model: string | null, durationMs: number): AnalysisUsage {
  let usage: Record<string, unknown> = {}
  for (const line of jsonl.split('\n')) {
    if (!line.includes('turn.completed')) continue
    try {
      const event = JSON.parse(line) as { type?: string; usage?: Record<string, unknown> }
      if (event.type === 'turn.completed' && event.usage) usage = event.usage
    } catch {
      // not a JSON event line
    }
  }
  return {
    model,
    costUsd: null,
    inputTokens: num(usage['input_tokens']),
    outputTokens: num(usage['output_tokens']),
    cachedInputTokens: num(usage['cached_input_tokens']),
    durationMs,
  }
}
