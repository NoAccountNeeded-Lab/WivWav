#!/usr/bin/env node
// Fails fast with a clear message when the running Node.js major does not
// match the supported runtime documented in the root package.json
// `engines.node` range (#809: align Node contracts across development, CI,
// Docker, and production). This runs as a `preinstall` hook so a mismatched
// Node install is rejected before any package resolution happens, in both
// npm and pnpm, and independent of the `engine-strict` setting.

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const rootDir = path.dirname(fileURLToPath(import.meta.url))
const pkg = JSON.parse(readFileSync(path.join(rootDir, '..', 'package.json'), 'utf8'))
const requiredRange = pkg.engines?.node

if (!requiredRange) {
  throw new Error('package.json engines.node is missing; cannot verify the Node.js runtime.')
}

const supportedMajor = requiredRange.match(/>=(\d+)/)?.[1]
const currentMajor = process.versions.node.split('.')[0]

if (!supportedMajor || currentMajor !== supportedMajor) {
  console.error(
    `\nUnsupported Node.js version: this project requires Node ${requiredRange} ` +
      `(major ${supportedMajor ?? '?'}), but the active runtime is Node ${process.version}.\n` +
      'Install the supported major (e.g. via nvm: `nvm install 24 && nvm use 24`) and re-run install.\n',
  )
  process.exit(1)
}
