// token-estimate.mjs — deterministic token estimator shared by every ranking
// variant, so the 1,000-token budget is enforced identically regardless of
// which ranking produced the candidate list (per #466's "hard 1K accounting"
// requirement).
//
// Estimator: ceil(utf8ByteLength / 4). This is the same rough heuristic
// widely used for English/code text token counts; it is not a real
// tokenizer, and that is reported explicitly alongside every result
// (`estimator: 'bytes/4'`) rather than presented as exact.
export const ESTIMATOR_NAME = 'bytes/4'

export function estimateTokens(text) {
  return Math.ceil(Buffer.byteLength(text, 'utf8') / 4)
}

/**
 * Lightweight, regex-based exported-symbol extractor. Not a real parser —
 * documented as a simplification for this spike; #469 (the production
 * implementation, gated on this issue) is required to use a real
 * parser/TypeScript compiler API instead.
 *
 * Returns compact "signature" strings, one per exported symbol, in source
 * order.
 */
const SYMBOL_RE =
  /^export\s+(?:default\s+)?(?:declare\s+)?(async\s+)?(function|class|interface|type|const|let|enum)\s+([A-Za-z0-9_$]+)/gm

export function extractSymbols(path, content) {
  if (!content) return []
  const symbols = []
  for (const match of content.matchAll(SYMBOL_RE)) {
    const [, isAsync, kind, name] = match
    symbols.push({
      name,
      kind,
      signature: `${path}#${name}${isAsync ? ' (async)' : ''} [${kind}]`,
    })
  }
  return symbols
}
