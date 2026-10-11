/**
 * Command-line entry for the host-side runner for trying semantic image analysis from a laptop (#1112).
 *
 * Runs outside Docker and outside BullMQ, so it can use the operator's own
 * `claude` / `codex` CLI login. It writes nothing to the database unless
 * `--persist` is given.
 *
 * Usage (from the repo root; DATABASE_URL must reach the dev database from
 * the host, e.g. postgresql://wav:wav@localhost:5432/wivwav):
 *   pnpm tsx apps/api/src/jobs/semantic-image-analyze-local-cli.ts --provider claude-cli --url <image-url>
 *   pnpm tsx apps/api/src/jobs/semantic-image-analyze-local-cli.ts --provider codex-cli --limit 5
 *   pnpm tsx apps/api/src/jobs/semantic-image-analyze-local-cli.ts --provider claude-cli --limit 5 --persist
 *
 * Modes:
 *   --url <image-url>  Analyze one image. No database access at all.
 *   (default)          Dry run over eligible images from the database: calls
 *                      the provider, validates each result, writes a JSON
 *                      report, and stores nothing.
 *   --persist          Also writes `listing_image_semantic_analysis` rows and
 *                      marks the image analyzed. Rows are keyed by image,
 *                      content hash and version, NOT provider; an existing
 *                      row (including an error row) is never overwritten and
 *                      blocks a re-run for that image; images that already have
 *                      a row for the current version are dropped before --limit
 *                      is applied, so no model call is spent on them. Dry-run first.
 *
 * Eligible images need `listing_image` rows, created by
 * `image-integrity-backfill.ts --apply [--source <id>] --limit N`. Run that
 * first on a small scope.
 *
 * Photos are meant to come last. By default only listings that the other stages
 * left with an unknown conversion or ramp type are analyzed, and listings whose
 * source has a detail crawl that has not reached them yet are skipped
 * (--include-resolved / --include-unfinished override each).
 *
 * --plan lists the images that would be analyzed (no download, no model call,
 * nothing stored) so the scope can be checked before spending any calls.
 *
 * Options: --provider noop|claude-cli|codex-cli (required), --model <name>,
 *   --limit N (default 5; 0 = every eligible image), --per-listing N (default 4,
 *   gallery order; 0 = all photos), --max-edge N (longest photo edge sent to the
 *   model, default 1024; 0 = original), --source <sourceId>, --out <report.json>,
 *   --timeout-seconds N (default 120).
 *
 * Rollback after --persist:
 *   DELETE FROM "listing_image_semantic_analysis" WHERE "provider" = '<provider>';
 *   UPDATE "listing_image" li SET "semanticAnalysisVersion" = NULL
 *     WHERE NOT EXISTS (SELECT 1 FROM "listing_image_semantic_analysis" a
 *                       WHERE a."listingImageId" = li."id");
 *
 * Do NOT run `semantic-image-analyze-backfill.ts --apply` to "try it": the
 * queue worker uses the Noop provider, which stores empty `success` rows and
 * marks every image analyzed.
 *
 * @module
 */

import '../lib/load-env.js'

import { writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  createImageAnalysisProvider,
  isImageAnalysisProviderName,
} from '../images/image-analysis-provider-factory.js'
import { runLocalAnalysis, summarizeUsage } from './semantic-image-analyze-local.js'
import type { LocalRunOptions } from './semantic-image-analyze-local.js'

function arg(argv: string[], name: string): string | undefined {
  const index = argv.indexOf(name)
  return index >= 0 ? argv[index + 1] : undefined
}

/**
 * Flags from `ANALYZE_*` environment variables, so `make analyze-images` can pass values
 * (a URL with a quote in it) without building a shell command line around them.
 */
export function argvFromEnv(env: NodeJS.ProcessEnv): string[] {
  const value = (name: string, flag: string) => (env[name] ? [flag, env[name]!] : [])
  const flag = (name: string, option: string) => (env[name] ? [option] : [])
  return [
    ...value('ANALYZE_PROVIDER', '--provider'),
    ...value('ANALYZE_LIMIT', '--limit'),
    ...value('ANALYZE_URL', '--url'),
    ...value('ANALYZE_SOURCE', '--source'),
    ...value('ANALYZE_MODEL', '--model'),
    ...value('ANALYZE_PER_LISTING', '--per-listing'),
    ...value('ANALYZE_MAX_EDGE', '--max-edge'),
    ...flag('ANALYZE_PERSIST', '--persist'),
    ...flag('ANALYZE_PLAN', '--plan'),
    ...flag('ANALYZE_INCLUDE_RESOLVED', '--include-resolved'),
    ...flag('ANALYZE_INCLUDE_UNFINISHED', '--include-unfinished'),
  ]
}

export function parseArgs(argv: string[]): LocalRunOptions {
  const providerName = arg(argv, '--provider')
  if (!providerName || !isImageAnalysisProviderName(providerName)) {
    throw new Error('--provider noop|claude-cli|codex-cli is required')
  }
  const limit = Number.parseInt(arg(argv, '--limit') ?? '5', 10)
  if (!Number.isInteger(limit) || limit < 0) throw new Error('--limit must be a whole number (0 = no limit)')
  const perListing = Number.parseInt(arg(argv, '--per-listing') ?? '4', 10)
  if (!Number.isInteger(perListing) || perListing < 0) throw new Error('--per-listing must be a whole number (0 = no cap)')
  const timeoutSeconds = Number.parseInt(arg(argv, '--timeout-seconds') ?? '120', 10)
  if (!Number.isInteger(timeoutSeconds) || timeoutSeconds <= 0) throw new Error('--timeout-seconds must be a positive whole number')
  const maxEdge = Number.parseInt(arg(argv, '--max-edge') ?? '1024', 10)
  if (!Number.isInteger(maxEdge) || maxEdge < 0) throw new Error('--max-edge must be a whole number of pixels (0 = send the original)')
  const model = arg(argv, '--model')
  const url = arg(argv, '--url')
  const sourceId = arg(argv, '--source')
  const persist = argv.includes('--persist')
  const onlyGaps = !argv.includes('--include-resolved')
  const requireFinishedStages = !argv.includes('--include-unfinished')
  const plan = argv.includes('--plan')
  if (plan && (persist || url)) throw new Error('--plan lists database images only; it cannot be combined with --persist or --url')
  if (persist && url) throw new Error('--persist cannot be combined with --url (no database image to attach to)')
  if (persist && providerName === 'noop') throw new Error('--persist with the noop provider would store empty results')
  return {
    provider: createImageAnalysisProvider(providerName, {
      ...(model ? { model } : {}),
      timeoutMs: timeoutSeconds * 1000,
      maxImageEdgePx: maxEdge,
    }),
    ...(url ? { url } : {}),
    limit: limit === 0 ? undefined : limit,
    perListing: perListing === 0 ? undefined : perListing,
    onlyGaps,
    requireFinishedStages,
    ...(sourceId ? { sourceId } : {}),
    persist,
    plan,
    outPath: arg(argv, '--out') ?? join(tmpdir(), `semantic-image-analyze-${Date.now()}.json`),
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const options = parseArgs([...argvFromEnv(process.env), ...process.argv.slice(2)])
    const entries = await runLocalAnalysis(options)
    const totals = summarizeUsage(entries)
    await writeFile(
      options.outPath,
      JSON.stringify({ provider: options.provider.name, model: options.provider.model, persisted: options.persist, totals, entries }, null, 2),
    )
    const counts = entries.reduce<Record<string, number>>((acc, e) => ({ ...acc, [e.outcome]: (acc[e.outcome] ?? 0) + 1 }), {})
    console.log(`\n${entries.length} image(s): ${JSON.stringify(counts)}`)
    if (totals.photos > 0) {
      const cost = totals.costUsd === null
        ? 'cost not reported by this CLI'
        : `$${totals.costUsd.toFixed(3)} API-equivalent: $${totals.costPerListing}/listing, about $${totals.costPer1000Photos} per 1,000 photos`
      console.log(`Usage: ${totals.photos} photo(s) in ${totals.calls} call(s), ${totals.inputTokens} input / ${totals.outputTokens} output tokens, avg ${totals.avgSecondsPerPhoto}s/photo, ${cost}`)
    }
    console.log(`Report: ${options.outPath}`)
    if (options.url && entries[0]?.result) console.log(JSON.stringify(entries[0].result, null, 2))
  } catch (err) {
    console.error(err instanceof Error ? err.message : err)
    process.exit(1)
  }
}
