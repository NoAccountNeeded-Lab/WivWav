/** Spawns the operator's CLI for the local image-analysis providers (#1112). */

import { spawn } from 'node:child_process'

export interface ProcessRunOptions {
  cwd: string
  env: NodeJS.ProcessEnv
  timeoutMs: number
  stdin?: string
}

export interface ProcessRunResult {
  code: number | null
  stdout: string
  stderr: string
  timedOut: boolean
}

/** Injected for tests; the default spawns a real process. */
export type ProcessRunner = (command: string, args: string[], options: ProcessRunOptions) => Promise<ProcessRunResult>

export const spawnProcessRunner: ProcessRunner = (command, args, options) =>
  new Promise((resolve, reject) => {
    // detached: the child leads its own process group, so a timeout can kill
    // grandchildren (the CLIs spawn helpers) that would otherwise hold the pipes open.
    const child = spawn(command, args, { cwd: options.cwd, env: options.env, stdio: ['pipe', 'pipe', 'pipe'], detached: true })
    let stdout = ''
    let stderr = ''
    let timedOut = false
    const finish = (code: number | null): void => {
      clearTimeout(timer)
      resolve({ code, stdout, stderr, timedOut })
    }
    const timer = setTimeout(() => {
      timedOut = true
      try {
        process.kill(-child.pid!, 'SIGKILL')
      } catch {
        child.kill('SIGKILL')
      }
    }, options.timeoutMs)
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => { stdout += chunk })
    child.stderr.on('data', (chunk: string) => { stderr += chunk })
    child.on('error', (err: NodeJS.ErrnoException) => {
      clearTimeout(timer)
      reject(
        err.code === 'ENOENT'
          ? new Error(`"${command}" was not found on PATH; install it and sign in first`)
          : err,
      )
    })
    child.on('close', finish)
    // After a timeout, do not wait for `close`: a surviving grandchild could hold the pipes open.
    child.on('exit', (code) => { if (timedOut) finish(code) })
    child.stdin.on('error', () => {})
    child.stdin.end(options.stdin ?? '')
  })
