// git-tree.mjs — local git plumbing to read the repo tree/blob contents at a
// given commit, without checking it out. Used to reconstruct "the repo as it
// existed at PR baseRefOid" for the backtest, and to read file contents for
// lightweight symbol extraction (cached by blob sha so identical blobs across
// many commits are only read once).
import { execFileSync } from 'node:child_process'

const blobCache = new Map()

/** List of {path, blobSha} for every file in the tree at `sha`. */
export function listTree(sha) {
  const out = execFileSync('git', ['ls-tree', '-r', sha], {
    maxBuffer: 1024 * 1024 * 256,
    encoding: 'utf8',
  })
  const entries = []
  for (const line of out.split('\n')) {
    if (!line) continue
    // "<mode> blob <sha>\t<path>"
    const tab = line.indexOf('\t')
    const meta = line.slice(0, tab).split(' ')
    const blobSha = meta[2]
    const path = line.slice(tab + 1)
    entries.push({ path, blobSha })
  }
  return entries
}

/** Read blob content by sha, cached across calls. */
export function readBlob(blobSha) {
  if (blobCache.has(blobSha)) return blobCache.get(blobSha)
  let content
  try {
    content = execFileSync('git', ['cat-file', '-p', blobSha], {
      maxBuffer: 1024 * 1024 * 16,
      encoding: 'utf8',
    })
  } catch {
    content = ''
  }
  blobCache.set(blobSha, content)
  return content
}

export function blobCacheSize() {
  return blobCache.size
}
