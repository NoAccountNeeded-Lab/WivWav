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
/**
 * #619 investigation: some `trim` values in the live facet distribution are
 * cut off mid-word (e.g. "...w/Sliding Passenger Sid", "...Mobility Handi"),
 * with no ellipsis. Confirmed source-side, not a pipeline bug — this
 * function performs no slicing of its own, and neither does any caller
 * (checked blvd.ts, blvd-detail.ts, mobilityworks.ts, mobilityworks-detail.ts,
 * and packages/search's indexing path). Live BLVD listings reproduce the same
 * truncation in the dealer's own detail-page <h1> and <title> tags — e.g.
 * VIN 1FDES6PM1HKA99449 ("...w/Sliding Passenger Sid") and VIN
 * 1FTBW2XG5KKB19787 ("...Mobility Handi") both show the identical truncated
 * string on BLVD's own detail page, not just the list-page card. The full
 * text does not exist anywhere we can scrape it from.
 *
 * Deliberately NOT filtering these out of the `trim` facet: the truncation
 * point is not a fixed source-wide length (observed cutoffs range from ~40 to
 * ~65 raw title characters across different dealers), and a length-based
 * heuristic would misfire — e.g. "159 WB Medium Roof Mobility Handicap Van"
 * is a complete, untruncated 40-character trim from the same marketplace, the
 * same length as some genuinely truncated examples. Any shape-based filter
 * risks silently hiding legitimate long trims. Garbled tails are left as-is;
 * operators can spot them via the facet distribution if needed.
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
