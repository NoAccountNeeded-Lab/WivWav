#!/usr/bin/env node
// enrich-corpus-with-issues.mjs — second pass over corpus.json that attaches
// each record's linked-issue title/body/labels (the actual ranking input:
// the CLI ranks against the *issue* text, not the PR text). Kept as a
// separate pass from extract-corpus.mjs so the PR/file-change extraction and
// the issue-text enrichment are independently re-runnable and auditable.
import { readFileSync, writeFileSync } from 'node:fs'
import { issue, repoNameWithOwner } from './lib/github.mjs'

const path = process.argv[2] ?? `${import.meta.dirname}/../corpus/corpus.json`
const corpus = JSON.parse(readFileSync(path, 'utf8'))
const repo = corpus.repo ?? repoNameWithOwner()

let missing = 0
for (const [index, record] of corpus.records.entries()) {
  process.stderr.write(`[${index + 1}/${corpus.records.length}] issue #${record.linkedIssue}\n`)
  const data = issue(repo, record.linkedIssue)
  if (!data) {
    missing += 1
    record.issueTitle = ''
    record.issueBody = ''
    record.issueLabels = []
    continue
  }
  record.issueTitle = data.title ?? ''
  record.issueBody = data.body ?? ''
  record.issueLabels = (data.labels ?? []).map((l) => (typeof l === 'string' ? l : l.name))
}

corpus.issueEnrichedAt = new Date().toISOString()
corpus.issuesMissing = missing
writeFileSync(path, JSON.stringify(corpus, null, 2))
process.stderr.write(`Enriched ${corpus.records.length} records (${missing} missing issue data).\n`)
