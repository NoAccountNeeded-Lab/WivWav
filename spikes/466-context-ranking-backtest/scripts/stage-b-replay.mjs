#!/usr/bin/env node
// stage-b-replay.mjs — Stage B for #466: a REPLAYED (not live) pilot.
//
// IMPORTANT METHODOLOGY NOTE (read before trusting these numbers):
//
// #466 calls Stage B a "live/replayed agent pilot" and its pass thresholds
// include gates — first-pass completion, acceptance-criteria coverage,
// review-finding counts, stuck rate, re-review cycles — that only exist once
// an agent has actually attempted the issue. Building and running a true
// live paired-trial pilot (solve N real issues twice, once per condition,
// with a real coding agent, under an implemented --map-tokens flag) is
// outside what a single automated implementation worker can self-authorize
// inside one issue's worktree: it requires running the real sprint pipeline
// many times over, i.e. real further compute/cost, and #469 (the production
// ranked-map generator this would pilot) does not exist yet to run it with.
//
// This script instead computes the two thresholds that ARE derivable from
// the historical corpus by replay — exploratory-file-read reduction and
// pre-first-edit read-token reduction — using the Stage A rankings as a
// deterministic model of "what a worker would need to open to find the
// first changed source file":
//   - native/map-off condition: files opened in the CURRENT production
//     ranking (rankLikelyFileHints) order until the first changed source
//     file is reached (today's actual behavior — this IS what "map-off"
//     looks like today, not a hypothetical).
//   - map-on condition: 0 extra exploratory reads if the combined ranked
//     map already surfaces the first changed source file within budget;
//     otherwise the same fallback-by-rank-order cost as native.
//
// The remaining Stage B gates (completion rate, AC coverage, review
// findings, stuck rate, re-review cycles, total tokens through first green
// check) are reported as NOT MEASURED and are called out explicitly in the
// results and in the write-up decision — they are not estimated or guessed.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { classifyPath } from './lib/classify-path.mjs'
import { listTree, readBlob } from './lib/git-tree.mjs'
import { buildMap } from './lib/map-builder.mjs'
import { estimateTokens } from './lib/token-estimate.mjs'
import { keywordCandidates, rankCombined, rankDependencyCentrality, rankIssueKeyword, rankLikelyFileHints } from './lib/rank-variants.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))

function parseArgs(argv) {
  const opts = {
    corpus: `${__dirname}/../corpus/corpus.json`,
    out: `${__dirname}/../results/stage-b-results.json`,
    budget: 1000,
  }
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--corpus') opts.corpus = argv[++i]
    else if (argv[i] === '--out') opts.out = argv[++i]
    else if (argv[i] === '--budget') opts.budget = Number(argv[++i])
  }
  return opts
}

const treeCache = new Map()
function snapshotAt(sha) {
  if (treeCache.has(sha)) return treeCache.get(sha)
  const entries = listTree(sha)
  const sourcePaths = entries.filter((e) => classifyPath(e.path) === 'source').map((e) => e.path)
  const blobByPath = new Map(entries.map((e) => [e.path, e.blobSha]))
  const contentByPath = new Map(sourcePaths.map((p) => [p, readBlob(blobByPath.get(p))]))
  const allPathSet = new Set(entries.map((e) => e.path))
  const snapshot = { sourcePaths, contentByPath, allPathSet }
  treeCache.set(sha, snapshot)
  return snapshot
}

function median(values) {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
}

function replayOne(record, budget) {
  if (!record.baseRefOid) return null
  const snapshot = snapshotAt(record.baseRefOid)
  const groundTruth = [
    ...new Set(record.files.filter((f) => f.countsAsRankerTarget).map((f) => f.preChangePath)),
  ].filter((p) => snapshot.allPathSet.has(p))
  if (groundTruth.length === 0) return null
  const groundTruthSet = new Set(groundTruth)

  const keywords = keywordCandidates(record.issueTitle ?? '', record.issueBody ?? '', record.issueLabels ?? [])
  const nativeRanked = rankLikelyFileHints(snapshot.sourcePaths, keywords)
  const issueKeyword = rankIssueKeyword(snapshot.sourcePaths, keywords)
  const centrality = rankDependencyCentrality(snapshot.sourcePaths, snapshot.contentByPath)
  const combinedRanked = rankCombined(issueKeyword, centrality)
  const map = buildMap(combinedRanked, snapshot.contentByPath, budget)
  const mapIncludes = new Set(map.includedFilePaths)

  // Native: files opened in ranked order until the first ground-truth file.
  let nativeReads = 0
  let nativeReadTokens = 0
  for (const { path } of nativeRanked) {
    nativeReads += 1
    nativeReadTokens += estimateTokens(snapshot.contentByPath.get(path) ?? '')
    if (groundTruthSet.has(path)) break
  }

  // Map-on: 0 exploratory reads if the map already surfaces a ground-truth
  // file; otherwise fall back to the same rank-order search cost, but over
  // the combined ranking (what a worker would search next after the map
  // came up empty).
  const mapHasHit = groundTruth.some((p) => mapIncludes.has(p))
  let mapReads = 0
  let mapReadTokens = 0
  if (!mapHasHit) {
    for (const { path } of combinedRanked) {
      mapReads += 1
      mapReadTokens += estimateTokens(snapshot.contentByPath.get(path) ?? '')
      if (groundTruthSet.has(path)) break
    }
  }

  return {
    number: record.number,
    nativeExploratoryReads: nativeReads,
    mapExploratoryReads: mapReads,
    readReduction: nativeReads === 0 ? 0 : (nativeReads - mapReads) / nativeReads,
    nativeReadTokens,
    mapReadTokens: mapReadTokens + map.estimatedTokens, // map packet itself costs tokens too
    tokenReduction:
      nativeReadTokens === 0
        ? 0
        : (nativeReadTokens - (mapReadTokens + map.estimatedTokens)) / nativeReadTokens,
  }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2))
  const corpus = JSON.parse(readFileSync(opts.corpus, 'utf8'))

  const perPr = corpus.records.map((r) => replayOne(r, opts.budget)).filter(Boolean)
  const readReductions = perPr.map((p) => p.readReduction)
  const tokenReductions = perPr.map((p) => p.tokenReduction)

  const result = {
    generatedAt: new Date().toISOString(),
    methodology: 'REPLAYED proxy pilot over historical corpus — see file header comment. Not a live multi-agent trial.',
    budgetTokens: opts.budget,
    reproduceCommand: `node spikes/466-context-ranking-backtest/scripts/stage-b-replay.mjs --corpus ${opts.corpus} --budget ${opts.budget}`,
    sampleSize: perPr.length,
    medianExploratoryReadReduction: median(readReductions),
    medianReadTokenReduction: median(tokenReductions),
    meetsReadReductionThreshold15pct: median(readReductions) >= 0.15,
    meetsTokenReductionThreshold15pct: median(tokenReductions) >= 0.15,
    notMeasured: [
      'total input tokens through first green affected check (requires a real check run)',
      'first-pass completion rate (requires a real agent attempt)',
      'acceptance-criteria coverage (requires a real agent attempt)',
      'warning/critical review finding counts (requires a real reviewer pass)',
      'stuck rate (requires real multi-attempt sprint runs)',
      're-review cycle count (requires real review rounds)',
    ],
    perPr,
  }

  mkdirSync(dirname(opts.out), { recursive: true })
  writeFileSync(opts.out, JSON.stringify(result, null, 2))
  process.stderr.write(
    `Stage B replay (n=${result.sampleSize}): median read reduction=${(result.medianExploratoryReadReduction * 100).toFixed(1)}%, ` +
      `median token reduction=${(result.medianReadTokenReduction * 100).toFixed(1)}%. ` +
      `${result.notMeasured.length} gate(s) not measurable by replay.\n`,
  )
  process.stderr.write(`Wrote ${opts.out}\n`)
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
