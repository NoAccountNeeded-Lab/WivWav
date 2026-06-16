#!/usr/bin/env node
/**
 * WivWav SDLC CLI
 *
 * Provides `start`, `review`, `finish`, and `run-sprint` commands that encode the
 * issue workflow documented in AGENTS.md.
 *
 * Usage:
 *   pnpm wivwav start <issue>       -- label, branch, check-in comment
 *   pnpm wivwav review [issue]      -- validate changed files and produce review packet
 *   pnpm wivwav finish <issue>      -- full validation, commit, push, draft PR
 *   pnpm wivwav run-sprint [issue]  -- prepare sprint worker worktrees
 */
import { startCommand, type StartOptions } from './commands/start.js'
import { reviewCommand, type ReviewOptions } from './commands/review.js'
import { finishCommand, type FinishOptions } from './commands/finish.js'
import { runSprintCommand, type RunSprintOptions } from './commands/run-sprint.js'
import { CliError } from './lib/github.js'

function usage(): void {
  console.log(`
WivWav SDLC CLI

Commands:
  start <issue>     Start an issue: verify, label, branch, post check-in comment
  review [issue]    Review changed files: run checks, produce checklist review packet
  finish <issue>    Finish an issue: validate, commit, push, open draft PR
  run-sprint [issue] Prepare sprint worker worktrees for ready issues

Options (all commands):
  --dry-run         Print actions without executing them

Options (start):
  --branch <name>   Override the derived branch name

Options (review):
  --full            Run the full validation suite instead of affected-only

Options (finish):
  --type <type>     Commit type (feat|fix|chore|docs|refactor|test). Default: feat
  --scope <scope>   Commit scope. Default: derived from changed files
  --desc <text>     Short commit description. Default: derived from issue title
  --refs            Use "refs #N" instead of "fixes #N" in the commit message
  --agent-role <r>  Agent role for git trailers (e.g. worker)
  --agent-index <i> Agent index for git trailers
  --sprint-run <id> Sprint run ID for git trailers
  --co-author <s>   Co-Authored-By trailer value

Options (run-sprint):
  --limit <n>       Max ready issues to prepare in sequential mode
  --parallel <n>    Max ready issues to prepare with unique agent indexes
  -p <n>            Alias for --parallel

Examples:
  pnpm wivwav start 304
  pnpm wivwav review 304
  pnpm wivwav finish 304
  pnpm wivwav run-sprint 304
  pnpm wivwav run-sprint --parallel 3
  pnpm wivwav finish 304 --agent-role worker --agent-index 1 --sprint-run run-sprint/2026-06-15T05:18
	`.trim())
}

type FlagValue = string | boolean

function parseArgs(argv: string[]): {
  command: string | undefined
  args: string[]
  flags: Record<string, FlagValue>
} {
  const positional: string[] = []
  const flags: Record<string, FlagValue> = {}
  let i = 0
  while (i < argv.length) {
    const arg = argv[i]
    if (arg === undefined || arg === '--') { i++; continue }
    if (arg === '-p') {
      const next = argv[i + 1]
      if (next !== undefined && !next.startsWith('-')) {
        flags.parallel = next
        i += 2
      } else {
        flags.parallel = true
        i++
      }
      continue
    }
    if (arg.startsWith('--')) {
      const key = arg.slice(2)
      const next = argv[i + 1]
      if (next !== undefined && !next.startsWith('--')) {
        flags[key] = next
        i += 2
      } else {
        flags[key] = true
        i++
      }
    } else {
      positional.push(arg)
      i++
    }
  }
  const [command, ...args] = positional
  return { command, args, flags }
}

/** Return a string flag value, or undefined if absent/not a string. */
function strFlag(flags: Record<string, FlagValue>, key: string): string | undefined {
  const v = flags[key]
  return typeof v === 'string' ? v : undefined
}

/** Return true when a boolean flag is present. */
function boolFlag(flags: Record<string, FlagValue>, key: string): boolean {
  return flags[key] === true
}

async function main(): Promise<void> {
  // Skip node and script path
  const argv = process.argv.slice(2)
  const { command, args, flags } = parseArgs(argv)

  if (!command || command === 'help' || boolFlag(flags, 'help') || boolFlag(flags, 'h')) {
    usage()
    process.exit(0)
  }

  try {
    switch (command) {
      case 'start': {
        const issueNumber = parseInt(args[0] ?? '', 10)
        if (isNaN(issueNumber)) {
          throw new CliError('Usage: wivwav start <issue-number>')
        }
        const opts: StartOptions = { dryRun: boolFlag(flags, 'dry-run') }
        const branch = strFlag(flags, 'branch')
        if (branch !== undefined) opts.branch = branch
        const agentRole = strFlag(flags, 'agent-role')
        if (agentRole !== undefined) opts.agentRole = agentRole
        const agentIndexStr = strFlag(flags, 'agent-index')
        if (agentIndexStr !== undefined) opts.agentIndex = parseInt(agentIndexStr, 10)
        await startCommand(issueNumber, opts)
        break
      }

      case 'review': {
        const issueRaw = args[0] !== undefined ? parseInt(args[0], 10) : undefined
        const opts: ReviewOptions = { full: boolFlag(flags, 'full') }
        if (issueRaw !== undefined && !isNaN(issueRaw)) opts.issueNumber = issueRaw
        await reviewCommand(opts)
        break
      }

      case 'finish': {
        const issueNumber = parseInt(args[0] ?? '', 10)
        if (isNaN(issueNumber)) {
          throw new CliError('Usage: wivwav finish <issue-number>')
        }
        const opts: FinishOptions = {
          fixes: !boolFlag(flags, 'refs'),
          dryRun: boolFlag(flags, 'dry-run'),
          skipValidation: boolFlag(flags, 'skip-validation'),
        }
        const commitType = strFlag(flags, 'type')
        if (commitType !== undefined) opts.commitType = commitType
        const commitScope = strFlag(flags, 'scope')
        if (commitScope !== undefined) opts.commitScope = commitScope
        const description = strFlag(flags, 'desc')
        if (description !== undefined) opts.description = description
        const agentRole = strFlag(flags, 'agent-role')
        if (agentRole !== undefined) opts.agentRole = agentRole
        const agentIndexStr = strFlag(flags, 'agent-index')
        if (agentIndexStr !== undefined) opts.agentIndex = parseInt(agentIndexStr, 10)
        const sprintRun = strFlag(flags, 'sprint-run')
        if (sprintRun !== undefined) opts.sprintRun = sprintRun
        const coAuthoredBy = strFlag(flags, 'co-author')
        if (coAuthoredBy !== undefined) opts.coAuthoredBy = coAuthoredBy
        await finishCommand(issueNumber, opts)
        break
      }

      case 'run-sprint': {
        const issueRaw = args[0] !== undefined ? parseInt(args[0], 10) : undefined
        const opts: RunSprintOptions = { dryRun: boolFlag(flags, 'dry-run') }
        if (issueRaw !== undefined && !isNaN(issueRaw)) opts.issueNumber = issueRaw
        const limitStr = strFlag(flags, 'limit')
        if (limitStr !== undefined) opts.limit = parseInt(limitStr, 10)
        const parallelStr = strFlag(flags, 'parallel')
        if (parallelStr !== undefined) opts.parallel = parseInt(parallelStr, 10)
        await runSprintCommand(opts)
        break
      }

      default:
        console.error(`Unknown command: "${command}". Run "wivwav help" for usage.`)
        process.exit(1)
    }
  } catch (err: unknown) {
    if (err instanceof CliError) {
      console.error(`\nError: ${err.message}`)
      process.exit(1)
    }
    throw err
  }
}

main().catch((err: unknown) => {
  console.error('Unexpected error:', err instanceof Error ? err.message : String(err))
  process.exit(1)
})
