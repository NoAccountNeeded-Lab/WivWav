#!/usr/bin/env node
// stage-a-backtest.mjs — Stage A offline ranking backtest for #466.
//
// Usage:
//   node scripts/stage-a-backtest.mjs [--corpus corpus/corpus.json] [--out results/stage-a-results.json] [--budget 1000]
//
// For every PR in the frozen corpus, builds a hard-1000-token-budget map
// (scripts/lib/map-builder.mjs) from five ranking variants over the repo
// snapshot at the PR's baseRefOid, and reports the Stage A metrics defined
// in issue #466: hit@1K, recall@1K, MRR, unique relevant files per 1K
// tokens, domain/risk breakdowns, and a bootstrap 95% CI on the combined-vs-
// baseline recall improvement. Also reproduces the same analysis over the
// marker-backed subset (see extract-corpus.mjs) as a separate sensitivity
// report, and re-runs the full computation twice to verify byte-identical
// determinism.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { classifyPath } from './lib/classify-path.mjs'
import { listTree, readBlob } from './lib/git-tree.mjs'
import { buildMap } from './lib/map-builder.mjs'
import {
  keywordCandidates,
  rankCombined,
  rankDependencyCentrality,
  rankIssueKeyword,
  rankLikelyFileHints,
  rankRandomControl,
} from './lib/rank-variants.mjs'
import { bootstrapPairedDiffCI, mean } from './lib/stats.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))

function parseArgs(argv) {
  const opts = {
    corpus: `${__dirname}/../corpus/corpus.json`,
    out: `${__dirname}/../results/stage-a-results.json`,
    budget: 1000,
  }
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--corpus') opts.corpus = argv[++i]
    else if (argv[i] === '--out') opts.out = argv[++i]
    else if (argv[i] === '--budget') opts.budget = Number(argv[++i])
  }
  return opts
}

const VARIANTS = ['likelyFileHints', 'dependencyCentrality', 'issueKeyword', 'combined', 'random']

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

function domainOf(path) {
  const parts = path.split('/')
  if (parts[0] === 'apps' || parts[0] === 'packages') return `${parts[0]}/${parts[1]}`
  return parts[0]
}

function riskOf(record) {
  const riskLabel = (record.issueLabels ?? []).find((l) => /^(risk|priority):/i.test(l))
  if (riskLabel) return riskLabel
  if (record.changedFileCount <= 5) return 'heuristic:low (<=5 files)'
  if (record.changedFileCount <= 20) return 'heuristic:medium (6-20 files)'
  return 'heuristic:high (>20 files)'
}

function rankAllVariants(sourcePaths, contentByPath, keywords, prNumber) {
  const likelyFileHints = rankLikelyFileHints(sourcePaths, keywords)
  const issueKeyword = rankIssueKeyword(sourcePaths, keywords)
  const dependencyCentrality = rankDependencyCentrality(sourcePaths, contentByPath)
  const combined = rankCombined(issueKeyword, dependencyCentrality)
  const random = rankRandomControl(sourcePaths, prNumber)
  return { likelyFileHints, dependencyCentrality, issueKeyword, combined, random }
}

/** Reciprocal rank of the first ground-truth path in a full (untruncated) ranking. */
function reciprocalRank(ranked, groundTruthSet) {
  for (let i = 0; i < ranked.length; i += 1) {
    if (groundTruthSet.has(ranked[i].path)) return 1 / (i + 1)
  }
  return 0
}

function evaluateRecord(record, { budget, useMarker }) {
  const sha = useMarker ? record.markerBaseSha : record.baseRefOid
  if (!sha) return null
  const snapshot = snapshotAt(sha)

  const rawGroundTruth = record.files.filter((f) => f.countsAsRankerTarget).map((f) => f.preChangePath)
  const groundTruth = [...new Set(rawGroundTruth)].filter((p) => snapshot.allPathSet.has(p))
  if (groundTruth.length === 0) return null
  const groundTruthSet = new Set(groundTruth)

  const keywords = keywordCandidates(record.issueTitle ?? '', record.issueBody ?? '', record.issueLabels ?? [])
  const rankings = rankAllVariants(snapshot.sourcePaths, snapshot.contentByPath, keywords, record.number)

  const perVariant = {}
  for (const variant of VARIANTS) {
    const ranked = rankings[variant]
    const map = buildMap(ranked, snapshot.contentByPath, budget)
    const includedSet = new Set(map.includedFilePaths)
    const hitCount = groundTruth.filter((p) => includedSet.has(p)).length
    perVariant[variant] = {
      hit: hitCount > 0 ? 1 : 0,
      recall: hitCount / groundTruth.length,
      mrr: reciprocalRank(ranked, groundTruthSet),
      uniqueRelevantPer1K: hitCount / (map.estimatedTokens / 1000 || 1),
      estimatedTokens: map.estimatedTokens,
      exceededCap: map.exceededCap,
      includedSymbolCount: map.includedSymbolCount,
      omittedSymbolCount: map.omittedSymbolCount,
    }
  }

  return {
    number: record.number,
    linkedIssue: record.linkedIssue,
    groundTruthCount: groundTruth.length,
    domains: [...new Set(groundTruth.map(domainOf))],
    risk: riskOf(record),
    perVariant,
  }
}

function aggregate(evaluated) {
  const byVariant = {}
  for (const variant of VARIANTS) {
    byVariant[variant] = {
      hitAt1K: mean(evaluated.map((e) => e.perVariant[variant].hit)),
      recallAt1K: mean(evaluated.map((e) => e.perVariant[variant].recall)),
      mrr: mean(evaluated.map((e) => e.perVariant[variant].mrr)),
      uniqueRelevantPer1K: mean(evaluated.map((e) => e.perVariant[variant].uniqueRelevantPer1K)),
      capExceededCount: evaluated.filter((e) => e.perVariant[variant].exceededCap).length,
    }
  }

  const domains = [...new Set(evaluated.flatMap((e) => e.domains))].sort()
  const domainBreakdown = {}
  for (const domain of domains) {
    const inDomain = evaluated.filter((e) => e.domains.includes(domain))
    domainBreakdown[domain] = {
      prCount: inDomain.length,
      likelyFileHintsRecall: mean(inDomain.map((e) => e.perVariant.likelyFileHints.recall)),
      combinedRecall: mean(inDomain.map((e) => e.perVariant.combined.recall)),
    }
  }

  const risks = [...new Set(evaluated.map((e) => e.risk))].sort()
  const riskBreakdown = {}
  for (const risk of risks) {
    const inRisk = evaluated.filter((e) => e.risk === risk)
    riskBreakdown[risk] = {
      prCount: inRisk.length,
      likelyFileHintsRecall: mean(inRisk.map((e) => e.perVariant.likelyFileHints.recall)),
      combinedRecall: mean(inRisk.map((e) => e.perVariant.combined.recall)),
    }
  }

  const ci = bootstrapPairedDiffCI(
    evaluated.map((e) => e.perVariant.combined.recall),
    evaluated.map((e) => e.perVariant.likelyFileHints.recall),
  )

  const recallImprovement = byVariant.combined.recallAt1K - byVariant.likelyFileHints.recallAt1K
  const hitRegression = byVariant.combined.hitAt1K < byVariant.likelyFileHints.hitAt1K
  const domainRegression = Object.entries(domainBreakdown)
    .filter(([, d]) => d.combinedRecall < d.likelyFileHintsRecall - 0.05)
    .map(([name]) => name)
  const capExceeded = VARIANTS.some((v) => byVariant[v].capExceededCount > 0)

  const conditions = {
    recallImprovementAtLeast10pp: recallImprovement >= 0.1,
    ciLowerBoundAboveZero: ci.lower > 0,
    noHitRegression: !hitRegression,
    noDomainRegressionOver5pp: domainRegression.length === 0,
    capNeverExceeded: !capExceeded,
  }
  const pass = Object.values(conditions).every(Boolean)

  return {
    sampleSize: evaluated.length,
    byVariant,
    domainBreakdown,
    riskBreakdown,
    bootstrapCI: ci,
    recallImprovementCombinedVsLikelyFileHints: recallImprovement,
    domainsRegressed: domainRegression,
    conditions,
    stageAPass: pass,
  }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2))
  const corpus = JSON.parse(readFileSync(opts.corpus, 'utf8'))

  const evaluatedAll = corpus.records
    .map((r) => evaluateRecord(r, { budget: opts.budget, useMarker: false }))
    .filter(Boolean)
  const evaluatedMarker = corpus.records
    .filter((r) => r.markerBaseSha)
    .map((r) => evaluateRecord(r, { budget: opts.budget, useMarker: true }))
    .filter(Boolean)

  const resultAll = aggregate(evaluatedAll)
  const resultMarker = aggregate(evaluatedMarker)

  // Determinism check: rebuild the all-120 aggregate a second time and
  // compare byte-for-byte JSON output.
  const evaluatedAllRerun = corpus.records
    .map((r) => evaluateRecord(r, { budget: opts.budget, useMarker: false }))
    .filter(Boolean)
  const resultAllRerun = aggregate(evaluatedAllRerun)
  const deterministic = JSON.stringify(resultAll) === JSON.stringify(resultAllRerun)

  const output = {
    generatedAt: new Date().toISOString(),
    classifierVersion: corpus.classifierVersion,
    budgetTokens: opts.budget,
    estimator: 'bytes/4',
    reproduceCommand: `node spikes/466-context-ranking-backtest/scripts/stage-a-backtest.mjs --corpus ${opts.corpus} --budget ${opts.budget}`,
    allPrBase: resultAll,
    markerBackedSensitivity: resultMarker,
    deterministic,
    perPr: evaluatedAll,
  }

  mkdirSync(dirname(opts.out), { recursive: true })
  writeFileSync(opts.out, JSON.stringify(output, null, 2))

  process.stderr.write(
    `Stage A (all-${resultAll.sampleSize}-PR base): pass=${resultAll.stageAPass} ` +
      `recallImprovement=${(resultAll.recallImprovementCombinedVsLikelyFileHints * 100).toFixed(1)}pp ` +
      `CI=[${(resultAll.bootstrapCI.lower * 100).toFixed(1)}, ${(resultAll.bootstrapCI.upper * 100).toFixed(1)}]pp\n`,
  )
  process.stderr.write(
    `Stage A (marker-backed ${resultMarker.sampleSize}-PR sensitivity): pass=${resultMarker.stageAPass} ` +
      `recallImprovement=${(resultMarker.recallImprovementCombinedVsLikelyFileHints * 100).toFixed(1)}pp\n`,
  )
  process.stderr.write(`Deterministic rerun match: ${deterministic}\n`)
  process.stderr.write(`Wrote ${opts.out}\n`)
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
