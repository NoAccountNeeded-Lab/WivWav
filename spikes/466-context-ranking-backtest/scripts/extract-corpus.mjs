#!/usr/bin/env node
// extract-corpus.mjs — build the frozen, reproducible PR corpus for the #466
// backtest.
//
// Usage:
//   node scripts/extract-corpus.mjs [--size 120] [--scan-limit 500] [--out corpus/corpus.json]
//
// Selection: the most recent `--size` merged PRs (newest mergedAt first) that
// link a GitHub issue via a closing keyword ("fixes/closes/resolves #N") in
// the PR body, scanning back at most `--scan-limit` merged PRs. The result is
// written to `--out` as a single frozen JSON file so re-running Stage A/B
// against the *same* corpus does not depend on repo growth after this file
// was generated — regenerate deliberately with a new `--out` to refresh it.
//
// For each selected PR this records: baseRefOid/headRefOid, the full file
// change list classified by scripts/lib/classify-path.mjs, and — where
// derivable — a "marker" commit approximating the literal work-start point
// (see MARKER METHODOLOGY below), for the 100-PR sensitivity subset in
// Stage A.
//
// MARKER METHODOLOGY: a PR's linked issue is considered "marker-backed" when
// its GitHub timeline contains a `labeled` event adding `status:in-progress`
// (this repo's convention for "work started", see .claude/roles/worker.md).
// The marker commit is the oldest commit reachable from the PR's base branch
// at or after that label event's timestamp. This is an approximation of "the
// tree as it stood when work began" and is reported as a sensitivity subset,
// never presented as more precise than `baseRefOid`.
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { classifyPrFile, CLASSIFIER_VERSION } from './lib/classify-path.mjs'
import { issueTimeline, linkedIssueNumbers, listMergedPrs, prDetail, prFiles, repoNameWithOwner } from './lib/github.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))

function parseArgs(argv) {
  const opts = { size: 120, scanLimit: 500, out: `${__dirname}/../corpus/corpus.json` }
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--size') opts.size = Number(argv[++i])
    else if (argv[i] === '--scan-limit') opts.scanLimit = Number(argv[++i])
    else if (argv[i] === '--out') opts.out = argv[++i]
  }
  return opts
}

function markerBaseSha(repo, issueNumber, baseRefName, mergedAt) {
  const timeline = issueTimeline(repo, issueNumber)
  const labelEvent = timeline
    .filter((event) => event.event === 'labeled' && event.label?.name === 'status:in-progress')
    .sort((a, b) => new Date(a.created_at) - new Date(b.created_at))[0]
  if (!labelEvent) return null

  try {
    const out = execFileSync(
      'git',
      [
        'rev-list',
        '--reverse',
        `--since=${labelEvent.created_at}`,
        `--until=${mergedAt}`,
        `origin/${baseRefName}`,
      ],
      { encoding: 'utf8', maxBuffer: 1024 * 1024 * 16 },
    ).trim()
    const first = out.split('\n')[0]
    return first || null
  } catch {
    return null
  }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2))
  const repo = repoNameWithOwner()
  process.stderr.write(`Repo: ${repo}\n`)

  const candidates = listMergedPrs(opts.scanLimit)
  process.stderr.write(`Scanned ${candidates.length} merged PRs.\n`)

  const selected = []
  for (const pr of candidates) {
    if (selected.length >= opts.size) break
    const linked = linkedIssueNumbers(pr.body)
    if (linked.length === 0) continue
    selected.push({ ...pr, linkedIssue: linked[0], allLinkedIssues: linked })
  }
  process.stderr.write(`Selected ${selected.length} issue-linked merged PRs (target ${opts.size}).\n`)

  const records = []
  let markerBacked = 0
  for (const [index, pr] of selected.entries()) {
    process.stderr.write(`[${index + 1}/${selected.length}] PR #${pr.number}\n`)
    const detail = prDetail(repo, pr.number)
    const rawFiles = prFiles(repo, pr.number)
    const files = rawFiles.map((f) => classifyPrFile(f))
    const marker = markerBaseSha(repo, pr.linkedIssue, pr.baseRefName, pr.mergedAt)
    if (marker) markerBacked += 1

    records.push({
      number: pr.number,
      title: pr.title,
      mergedAt: pr.mergedAt,
      linkedIssue: pr.linkedIssue,
      baseRefName: pr.baseRefName,
      baseRefOid: detail.base.sha,
      headRefOid: detail.head.sha,
      markerBaseSha: marker,
      changedFileCount: files.length,
      files,
    })
  }

  const strataTotals = {}
  for (const record of records) {
    for (const file of record.files) {
      strataTotals[file.status] = (strataTotals[file.status] ?? 0) + 1
    }
  }

  const corpus = {
    classifierVersion: CLASSIFIER_VERSION,
    generatedAt: new Date().toISOString(),
    repo,
    prCount: records.length,
    changedFileCount: records.reduce((sum, r) => sum + r.changedFileCount, 0),
    statusTotals: strataTotals,
    markerBackedCount: markerBacked,
    maxFilesInSinglePr: Math.max(...records.map((r) => r.changedFileCount)),
    records,
  }

  mkdirSync(dirname(opts.out), { recursive: true })
  writeFileSync(opts.out, JSON.stringify(corpus, null, 2))
  process.stderr.write(
    `Wrote ${opts.out}: ${corpus.prCount} PRs, ${corpus.changedFileCount} changed files, ` +
      `${markerBacked}/${records.length} marker-backed, max files/PR ${corpus.maxFilesInSinglePr}.\n`,
  )
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
