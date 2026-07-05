import { matchMultiWordModelTokenCount } from '@wivwav/search'

export interface ParsedVehicleTitle {
  year: number
  make: string
  model: string
  trim: string | null
}

/**
 * Tokenizes a listing title body — e.g. "2024 Chrysler Town & Country
 * Touring" — into year/make/model/trim.
 *
 * The caller is responsible for stripping any leading condition prefix
 * ("Used"/"New"/"Certified Pre-Owned"/etc.) before calling this.
 *
 * Refs #618: naively assuming `model` is always exactly one token corrupts
 * both `model` and `trim` for multi-word models — e.g. the title above used
 * to yield `model: "Town"`, `trim: "& Country Touring"`. This checks the
 * tokens starting at the model position against the known multi-word models
 * in `@wivwav/search`'s model-alias table (`matchMultiWordModelTokenCount`)
 * before falling back to the single-token assumption. Shared by every
 * list-page adapter that parses `"year make model trim"` titles so the fix
 * (and any future multi-word models) lives in exactly one place.
 */
export function parseVehicleTitle(titleBody: string): ParsedVehicleTitle {
  const parts = titleBody.trim().split(/\s+/)
  const year = parseInt(parts[0] ?? '0', 10)
  const make = parts[1] ?? ''

  const modelTokens = parts.slice(2)
  const upperModelTokens = modelTokens.map((token) => token.toUpperCase())
  const multiWordCount = matchMultiWordModelTokenCount(upperModelTokens)
  const modelTokenCount = multiWordCount > 0 ? multiWordCount : 1

  const model = modelTokens.slice(0, modelTokenCount).join(' ')
  const trim = modelTokens.slice(modelTokenCount).join(' ') || null

  return { year, make, model, trim }
}
