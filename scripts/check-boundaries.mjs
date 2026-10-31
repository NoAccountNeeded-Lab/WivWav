#!/usr/bin/env node
/**
 * Private control plane guard (#1225, decision record
 * docs/design/eliminate-admin-urls-private-ops-control-plane.md §9).
 * Fails with file:line output when:
 *  - a WivWav-owned runtime/doc file uses a retired `/admin` or `/api/bff` URL literal;
 *  - OPS_API_SECRET appears anywhere in apps/web;
 *  - docker-compose.prod.yml host-publishes the API, starts ops by default,
 *    or injects OPS_API_SECRET into web.
 * Exceptions are exact paths in ALLOWED, each with a reason.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const SCANNED = /\.(ts|tsx|mjs|js|json|sh|ya?ml|md|conf|inc)$/
const RETIRED_URL = /(?<![\w.:-])\/(admin|api\/bff)(?=[/'"`\s)\]:,.]|$)/

export const ALLOWED = new Map([
  ['docs/design/eliminate-admin-urls-private-ops-control-plane.md', 'historical decision record'],
  ['docs/risk/proprietary-data-evaluation.md', 'third-party robots.txt facts'],
  ['scripts/edge-smoke.sh', 'negative probes proving the edge 404s retired routes'],
  ['scripts/check-boundaries.test.mjs', 'scanner test fixtures'],
  ['scripts/check-boundaries.mjs', 'scanner patterns'],
  ['AGENTS.md', 'states the rule against new /admin URLs'],
  ['apps/ops/src/middleware.ts', 'list of retired prefixes that return 404'],
])
const isAllowed = (file) =>
  ALLOWED.has(file) ||
  /\.test\.[cm]?[jt]sx?$/.test(file) || // negative tests that retired routes 404
  file.startsWith('docs/plans/') || // execution plans quote retired routes
  file.startsWith('.claude/plans/') || // agent working notes
  file.startsWith('spikes/') || // frozen experiment corpora
  /(^|\/)fixtures\//.test(file) // captured third-party pages

/** @param {{file: string, text: string}[]} files */
export function scanFiles(files) {
  const problems = []
  for (const { file, text } of files) {
    const lines = text.split('\n')
    lines.forEach((line, i) => {
      if (!isAllowed(file) && RETIRED_URL.test(line)) {
        problems.push(`${file}:${i + 1}: retired /admin or /api/bff URL literal`)
      }
      if (file.startsWith('apps/web/') && line.includes('OPS_API_SECRET')) {
        problems.push(`${file}:${i + 1}: OPS_API_SECRET must never be referenced in apps/web`)
      }
    })
  }
  return problems
}

/** Returns the indented block of one compose service, or '' when absent. */
function serviceBlock(compose, name) {
  const m = compose.match(new RegExp(`^  ${name}:\\n((?:(?:    .*|\\s*)\\n?)*)`, 'm'))
  return m ? (m[1] ?? '') : ''
}

export function scanCompose(compose, file = 'docker-compose.prod.yml') {
  const problems = []
  const api = serviceBlock(compose, 'api')
  if (!api) problems.push(`${file}: api service not found`)
  if (/^    ports:/m.test(api)) problems.push(`${file}: api must not host-publish a port; use edge or worker-ingress`)
  const ops = serviceBlock(compose, 'ops')
  if (!ops) problems.push(`${file}: ops service not found`)
  else if (!/^    profiles:\s*\[[^\]]*\bops\b/m.test(ops)) problems.push(`${file}: ops must be behind the stopped-by-default "ops" profile`)
  if (serviceBlock(compose, 'web').includes('OPS_API_SECRET')) problems.push(`${file}: web must not receive OPS_API_SECRET`)
  if (/^    ports:/m.test(ops) && /INTERNAL_API_SECRET/.test(ops)) problems.push(`${file}: ops must not hold INTERNAL_API_SECRET`)
  return problems
}

function main() {
  const tracked = execFileSync('git', ['ls-files', '-co', '--exclude-standard'], { encoding: 'utf8', maxBuffer: 64e6 })
    .split('\n')
    .filter((f) => f && SCANNED.test(f))
  const files = tracked.flatMap((file) => {
    try {
      return [{ file, text: readFileSync(file, 'utf8') }]
    } catch {
      return [] // deleted in the working tree
    }
  })
  const problems = [
    ...scanFiles(files),
    ...scanCompose(readFileSync('docker-compose.prod.yml', 'utf8')),
  ]
  if (problems.length) {
    console.error(problems.join('\n'))
    console.error(`check:boundaries failed with ${problems.length} problem(s)`)
    process.exit(1)
  }
  console.log(`check:boundaries ok (${files.length} files)`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main()
