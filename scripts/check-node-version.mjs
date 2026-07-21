#!/usr/bin/env node
// Fails fast with a clear message when the running Node.js major does not
// match the supported runtime documented in the root package.json
// `engines.node` range (#809: align Node contracts across development, CI,
// Docker, and production). This runs as a `preinstall` hook, so a mismatched
// Node install is rejected before pnpm links or builds any package (though
// after it has already fetched the lockfile graph), in both npm and pnpm,
// and independent of the `engine-strict` setting.

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const rootDir = path.dirname(fileURLToPath(import.meta.url))
const pkg = JSON.parse(readFileSync(path.join(rootDir, '..', 'package.json'), 'utf8'))
const requiredRange = pkg.engines?.node

if (!requiredRange) {
  throw new Error('package.json engines.node is missing; cannot verify the Node.js runtime.')
}

// Only understands a leading lower bound (e.g. ">=26 <27"). If engines.node
// is ever rewritten to a form without a leading ">=NN" (e.g. "26.x" or
// "^26.0.0"), update this extraction to match — otherwise the guard fails
// closed with an unhelpful "major ?" message even on a correct install.
const supportedMajor = requiredRange.match(/>=(\d+)/)?.[1]
const currentMajor = process.versions.node.split('.')[0]

if (!supportedMajor || currentMajor !== supportedMajor) {
  console.error(
    `\nUnsupported Node.js version: this project requires Node ${requiredRange} ` +
      `(major ${supportedMajor ?? '?'}), but the active runtime is Node ${process.version}.\n` +
      `Install the supported major (e.g. via nvm: \`nvm install ${supportedMajor ?? '26'} && nvm use ${supportedMajor ?? '26'}\`) and re-run install.\n`,
  )
  process.exit(1)
}
