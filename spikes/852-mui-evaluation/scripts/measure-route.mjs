// Archived from issue #852's spike. Usage (run from an app dir, e.g.
// apps/web, after `next build [--webpack]`):
//   node ../../spikes/852-mui-evaluation/scripts/measure-route.mjs . \
//     ".next/server/app/[locale]/vehicle/[id]/page_client-reference-manifest.js" \
//     "/[locale]/vehicle/[id]/page"
// Sums the raw + gzip size of every client JS chunk a route's RSC
// client-module manifest references — this is how section 5 of
// docs/design/852-mui-evaluation-spike.md's bundle-delta numbers were
// derived (Next 16's Turbopack build no longer prints a First Load JS
// table for any route).
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'

const [, , appDir, manifestPath, routeKey] = process.argv
const src = fs.readFileSync(path.join(appDir, manifestPath), 'utf8')
const markerRe = new RegExp(
  '__RSC_MANIFEST\\["' + routeKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '"\\]\\s*=\\s*',
)
const m = markerRe.exec(src)
if (!m) {
  console.error('marker not found; available:', src.match(/__RSC_MANIFEST\["([^"]+)"\]/g))
  process.exit(1)
}
let jsonStr = src.slice(m.index + m[0].length)
// It's followed by more statements; the manifest JSON ends right before the next
// top-level assignment or end of string. Use a JSON-aware scan by trying JSON.parse
// with progressively shorter suffixes is slow; instead find the matching closing brace.
let depth = 0
let end = -1
for (let i = 0; i < jsonStr.length; i++) {
  const ch = jsonStr[i]
  if (ch === '{') depth++
  else if (ch === '}') {
    depth--
    if (depth === 0) {
      end = i + 1
      break
    }
  }
}
jsonStr = jsonStr.slice(0, end)
const manifest = JSON.parse(jsonStr)

const chunkSet = new Set()
for (const key of Object.keys(manifest.clientModules || {})) {
  const mod = manifest.clientModules[key]
  for (const c of mod.chunks || []) {
    if (typeof c === 'string' && c.endsWith('.js')) chunkSet.add(c)
  }
}

let total = 0
let totalGz = 0
const details = []
for (const c of chunkSet) {
  const rel = decodeURIComponent(c).replace(/^\/_next\//, '')
  const p = path.join(appDir, '.next', rel)
  try {
    const buf = fs.readFileSync(p)
    const gz = zlib.gzipSync(buf).length
    total += buf.length
    totalGz += gz
    details.push([c, buf.length, gz])
  } catch {
    console.error('missing', p)
  }
}
details.sort((a, b) => b[1] - a[1])
console.log('route:', routeKey)
console.log('chunk count:', chunkSet.size)
console.log('total bytes (raw):', total, (total / 1024).toFixed(1) + 'KB')
console.log('total bytes (gzip):', totalGz, (totalGz / 1024).toFixed(1) + 'KB')
console.log('top chunks:')
for (const [c, s, gz] of details.slice(0, 15)) {
  console.log('  ', (s / 1024).toFixed(1) + 'KB raw /', (gz / 1024).toFixed(1) + 'KB gz', c)
}
