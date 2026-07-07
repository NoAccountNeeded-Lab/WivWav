import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const supportDir = path.dirname(fileURLToPath(import.meta.url))

export const rootDir = path.resolve(supportDir, '../..')
export const e2eDir = path.resolve(rootDir, 'e2e')

export const e2eEnv = {
  projectName: process.env['WIVWAV_E2E_PROJECT'] ?? 'wivwav-e2e',
  webPort: process.env['WIVWAV_E2E_WEB_PORT'] ?? '53000',
  apiPort: process.env['WIVWAV_E2E_API_PORT'] ?? '53001',
  postgresPort: process.env['WIVWAV_E2E_POSTGRES_PORT'] ?? '55432',
  valkeyPort: process.env['WIVWAV_E2E_VALKEY_PORT'] ?? '56379',
  meiliPort: process.env['WIVWAV_E2E_MEILI_PORT'] ?? '57700',
  internalApiSecret:
    process.env['WIVWAV_E2E_INTERNAL_API_SECRET'] ??
    '41ddf2d6dfad63f18a7fa42d4ddc82da47fd7ac0f9e6c55530078f7c2ca941c2',
} as const

export function webBaseUrl(): string {
  return process.env['WIVWAV_E2E_WEB_URL'] ?? `http://127.0.0.1:${e2eEnv.webPort}`
}

export function apiBaseUrl(): string {
  return process.env['WIVWAV_E2E_API_URL'] ?? `http://127.0.0.1:${e2eEnv.apiPort}`
}

export function databaseUrl(): string {
  return `postgresql://wav:wav@127.0.0.1:${e2eEnv.postgresPort}/wivwav`
}

function composeEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    WIVWAV_E2E_WEB_PORT: e2eEnv.webPort,
    WIVWAV_E2E_API_PORT: e2eEnv.apiPort,
    WIVWAV_E2E_POSTGRES_PORT: e2eEnv.postgresPort,
    WIVWAV_E2E_VALKEY_PORT: e2eEnv.valkeyPort,
    WIVWAV_E2E_MEILI_PORT: e2eEnv.meiliPort,
    WIVWAV_E2E_INTERNAL_API_SECRET: e2eEnv.internalApiSecret,
  }
}

export function composeArgs(args: string[]): string[] {
  return [
    'compose',
    '--project-name',
    e2eEnv.projectName,
    '-f',
    path.join(rootDir, 'docker-compose.yml'),
    '-f',
    path.join(e2eDir, 'docker-compose.e2e.yml'),
    ...args,
  ]
}

export function runDockerCompose(args: string[]): void {
  execFileSync('docker', composeArgs(args), {
    cwd: rootDir,
    env: composeEnv(),
    stdio: 'inherit',
  })
}

export function composeDown(): void {
  runDockerCompose(['down', '--volumes', '--remove-orphans'])
}
