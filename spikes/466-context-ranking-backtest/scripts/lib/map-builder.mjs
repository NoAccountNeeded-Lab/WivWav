// map-builder.mjs — turns a ranked file order into a hard-budgeted packet,
// identically for every variant, per #466's "all variants obey the same
// hard 1K accounting and deterministic truncation contract" requirement.
//
// Contract:
//   - Rank unique files first (file-header entry), then compact symbols
//     within each file, round-robin across files so one file's symbol list
//     cannot crowd out project coverage (matches the issue's explicit rule).
//   - Entries are considered in a fixed, deterministic order; an entry that
//     doesn't fit the remaining budget is skipped (never included) and
//     scanning continues — repeated runs on identical input therefore
//     produce byte-identical output.
//   - The cap (default 1,000 estimated tokens) is never exceeded.
import { estimateTokens, ESTIMATOR_NAME, extractSymbols } from './token-estimate.mjs'

const DEFAULT_BUDGET_TOKENS = 1000
const MAX_SYMBOLS_PER_FILE_ROUND_ROBIN = 8

/**
 * @param {{path: string, score: number}[]} rankedFiles best-first order
 * @param {Map<string,string>} contentByPath file content, for symbol extraction
 * @param {number} budgetTokens
 */
export function buildMap(rankedFiles, contentByPath, budgetTokens = DEFAULT_BUDGET_TOKENS) {
  const symbolsByPath = new Map()
  for (const { path } of rankedFiles) {
    symbolsByPath.set(path, extractSymbols(path, contentByPath.get(path) ?? ''))
  }

  // Flatten to a deterministic round-robin candidate-entry order:
  // round 0 = every file header in rank order; round N = the Nth symbol of
  // each file (only for files that have one), in rank order.
  const entries = []
  for (const { path } of rankedFiles) {
    entries.push({ path, kind: 'file', text: path })
  }
  for (let round = 0; round < MAX_SYMBOLS_PER_FILE_ROUND_ROBIN; round += 1) {
    for (const { path } of rankedFiles) {
      const symbol = symbolsByPath.get(path)?.[round]
      if (symbol) entries.push({ path, kind: 'symbol', text: symbol.signature })
    }
  }

  let usedTokens = 0
  let usedBytes = 0
  const includedPaths = new Set()
  const includedSymbols = []
  let omittedSymbols = 0
  let omittedFileHeaders = 0

  for (const entry of entries) {
    const cost = estimateTokens(entry.text)
    if (usedTokens + cost > budgetTokens) {
      if (entry.kind === 'symbol') omittedSymbols += 1
      else omittedFileHeaders += 1
      continue
    }
    usedTokens += cost
    usedBytes += Buffer.byteLength(entry.text, 'utf8')
    if (entry.kind === 'file') includedPaths.add(entry.path)
    else includedSymbols.push(entry)
  }

  // Total symbols available (for the omitted-symbol accounting), across all
  // ranked files regardless of whether the file header made it into the map.
  const totalSymbols = [...symbolsByPath.values()].reduce((sum, arr) => sum + arr.length, 0)
  const includedSymbolCount = includedSymbols.length
  const omittedSymbolCount = totalSymbols - includedSymbolCount

  return {
    estimator: ESTIMATOR_NAME,
    budgetTokens,
    estimatedTokens: usedTokens,
    byteCount: usedBytes,
    includedFilePaths: [...includedPaths],
    includedSymbolCount,
    omittedSymbolCount,
    omittedFileHeaderCount: omittedFileHeaders,
    exceededCap: usedTokens > budgetTokens,
  }
}
