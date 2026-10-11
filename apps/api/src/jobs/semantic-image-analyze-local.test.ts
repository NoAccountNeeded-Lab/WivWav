import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ImageAnalysisProvider, ImageAnalysisResult } from '../images/image-analysis-provider.js'

const findEligible = vi.fn()
const hashImage = vi.fn()
const analyzeListingImage = vi.fn()
const disconnect = vi.fn(async () => {})

vi.mock('@wivwav/db', () => ({ getDb: () => ({ $disconnect: disconnect, listing: { findMany: (...args: unknown[]) => listingFindMany(...args) }, listingImageSemanticAnalysis: { findMany: (...args: unknown[]) => analysisFindMany(...args) } }) }))
vi.mock('../images/semantic-analysis-eligibility.js', () => ({ findEligibleImagesForSemanticAnalysis: findEligible }))
vi.mock('../images/image-hasher.js', () => ({ hashImage }))
vi.mock('../images/semantic-image-analysis.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  analyzeListingImage,
}))

import { CliOutputError } from '../images/cli-output-parsers.js'

const { filterPhotoCandidates, runLocalAnalysis, selectImages, selectPhotos, summarizeUsage } = await import('./semantic-image-analyze-local.js')
const { parseArgs } = await import('./semantic-image-analyze-local-cli.js')

const GOOD: ImageAnalysisResult = { schemaVersion: '1', altText: 'a', summary: null, labels: [{ label: 'ramp', confidence: 0.9 }], fieldClaims: [] }
const images = [
  { id: 'i1', listingId: 'l1', originalUrl: 'u1', normalizedUrl: 'https://x/1.jpg', position: 0 },
  { id: 'i2', listingId: 'l1', originalUrl: 'u2', normalizedUrl: 'https://x/2.jpg', position: 1 },
]
const downloaded = { ok: true, exactHash: 'h', pHash: 'p', contentType: 'image/jpeg', byteSize: 3, bytes: Buffer.from([1, 2, 3]) }

function provider(analyze = vi.fn(async () => GOOD)): ImageAnalysisProvider {
  return { name: 'test', model: null, analyze }
}

const listingFindMany = vi.fn()
const analysisFindMany = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  listingFindMany.mockResolvedValue([{ id: 'l1', sourceId: 's1', conversionType: 'unknown', rampType: 'unknown', detailScrapedAt: null }])
  analysisFindMany.mockResolvedValue([])
  findEligible.mockResolvedValue(images)
  hashImage.mockResolvedValue(downloaded)
})

describe('parseArgs', () => {
  it('requires a known provider', () => {
    expect(() => parseArgs([])).toThrow(/--provider/)
    expect(() => parseArgs(['--provider', 'banana'])).toThrow(/--provider/)
  })

  it('defaults to a limit of 5 and treats 0 as no limit', () => {
    expect(parseArgs(['--provider', 'noop']).limit).toBe(5)
    expect(parseArgs(['--provider', 'noop', '--limit', '0']).limit).toBeUndefined()
    expect(parseArgs(['--provider', 'noop', '--limit', '12']).limit).toBe(12)
  })

  it('analyzes only gaps in finished listings unless told otherwise', () => {
    const defaults = parseArgs(['--provider', 'noop'])
    expect([defaults.onlyGaps, defaults.requireFinishedStages]).toEqual([true, true])
    const lifted = parseArgs(['--provider', 'noop', '--include-resolved', '--include-unfinished'])
    expect([lifted.onlyGaps, lifted.requireFinishedStages]).toEqual([false, false])
  })

  it('defaults to 4 photos per listing and treats 0 as no cap', () => {
    expect(parseArgs(['--provider', 'noop']).perListing).toBe(4)
    expect(parseArgs(['--provider', 'noop', '--per-listing', '0']).perListing).toBeUndefined()
    expect(() => parseArgs(['--provider', 'noop', '--per-listing', '-2'])).toThrow(/per-listing/)
  })

  it('defaults to a 1024px photo edge and rejects a negative size', () => {
    expect(() => parseArgs(['--provider', 'noop', '--max-edge', '-5'])).toThrow(/max-edge/)
    expect(() => parseArgs(['--provider', 'noop', '--max-edge', '0'])).not.toThrow()
  })

  it('rejects a negative or non-numeric limit', () => {
    expect(() => parseArgs(['--provider', 'noop', '--limit', '-1'])).toThrow(/whole number/)
    expect(() => parseArgs(['--provider', 'noop', '--limit', 'abc'])).toThrow(/whole number/)
  })

  it('rejects a zero, negative or non-numeric timeout', () => {
    for (const bad of ['0', '-3', 'abc']) {
      expect(() => parseArgs(['--provider', 'noop', '--timeout-seconds', bad])).toThrow(/timeout-seconds/)
    }
    expect(() => parseArgs(['--provider', 'noop', '--timeout-seconds', '30'])).not.toThrow()
  })

  it('rejects unsafe flag combinations', () => {
    expect(() => parseArgs(['--provider', 'claude-cli', '--persist', '--url', 'https://x/1.jpg'])).toThrow(/--url/)
    expect(() => parseArgs(['--provider', 'noop', '--persist'])).toThrow(/noop/)
    expect(() => parseArgs(['--provider', 'claude-cli', '--plan', '--persist'])).toThrow(/--plan/)
  })

  it('does not persist or plan unless asked', () => {
    const options = parseArgs(['--provider', 'claude-cli'])
    expect(options.persist).toBe(false)
    expect(options.plan).toBe(false)
  })
})

describe('filterPhotoCandidates', () => {
  const img = (id: string, listingId: string) => ({ id, listingId, originalUrl: id, normalizedUrl: id, position: 0 })
  const photos = [img('a', 'blvd-done'), img('b', 'blvd-pending'), img('c', 'other'), img('d', 'resolved')]
  const info = (sourceId: string, conversionType: string, rampType: string, detailScrapedAt: Date | null) => ({ sourceId, conversionType, rampType, detailScrapedAt })
  const listings = new Map([
    ['blvd-done', info('blvd', 'unknown', 'unknown', new Date())],
    ['blvd-pending', info('blvd', 'unknown', 'unknown', null)],
    ['other', info('dealer', 'unknown', 'fold_out', null)],
    ['resolved', info('dealer', 'side_entry', 'fold_out', null)],
  ])

  it('skips listings still waiting on their source detail crawl, and resolved ones', () => {
    const result = filterPhotoCandidates(photos, listings, { onlyGaps: true, requireFinishedStages: true })
    expect(result.images.map((i) => i.id)).toEqual(['a', 'c'])
    expect(result).toMatchObject({ skippedUnfinished: 1, skippedResolved: 1 })
  })

  it('treats a source with no detail stage as finished', () => {
    const result = filterPhotoCandidates([img('c', 'other')], listings, { onlyGaps: false, requireFinishedStages: true })
    expect(result.images).toHaveLength(1)
  })

  it('keeps everything when both rules are lifted', () => {
    const result = filterPhotoCandidates(photos, listings, { onlyGaps: false, requireFinishedStages: false })
    expect(result.images).toHaveLength(4)
    expect(result).toMatchObject({ skippedUnfinished: 0, skippedResolved: 0 })
  })

  it('keeps photos whose listing is not found', () => {
    expect(filterPhotoCandidates([img('z', 'ghost')], listings, { onlyGaps: true, requireFinishedStages: true }).images).toHaveLength(1)
  })
})

describe('selectPhotos', () => {
  const img = (id: string, listingId: string, position: number) => ({ id, listingId, originalUrl: id, normalizedUrl: id, position })
  const many = [img('a2', 'A', 2), img('a0', 'A', 0), img('a1', 'A', 1), img('b0', 'B', 0), img('b1', 'B', 1)]

  it('takes the first N photos of each listing in gallery order', () => {
    expect(selectPhotos(many, 2, undefined).map((i) => i.id)).toEqual(['a0', 'a1', 'b0', 'b1'])
  })

  it('applies no per-listing cap when undefined, and the overall limit after the cap', () => {
    expect(selectPhotos(many, undefined, undefined)).toHaveLength(5)
    expect(selectPhotos(many, 2, 3).map((i) => i.id)).toEqual(['a0', 'a1', 'b0'])
  })
})

describe('runLocalAnalysis', () => {
  const base = {
    limit: 5 as number | undefined,
    perListing: 4 as number | undefined,
    onlyGaps: true,
    requireFinishedStages: true,
    persist: false,
    plan: false,
    outPath: '/tmp/x.json',
  }

  it('scans all eligible images for the source, then applies the limits itself', async () => {
    await runLocalAnalysis({ ...base, provider: provider(), plan: true, sourceId: 's1' })
    expect(findEligible).toHaveBeenCalledWith(expect.anything(), { sourceId: 's1' })
    await runLocalAnalysis({ ...base, provider: provider(), plan: true })
    expect(findEligible).toHaveBeenLastCalledWith(expect.anything(), {})
  })

  it('skips resolved and unfinished listings before analysis', async () => {
    listingFindMany.mockResolvedValue([{ id: 'l1', sourceId: 's1', conversionType: 'side_entry', rampType: 'fold_out', detailScrapedAt: null }])
    const entries = await runLocalAnalysis({ ...base, provider: provider(), plan: true })
    expect(entries).toEqual([])
    const kept = await runLocalAnalysis({ ...base, provider: provider(), plan: true, onlyGaps: false })
    expect(kept).toHaveLength(2)
  })

  it('honours the per-listing cap and the overall limit', async () => {
    const entries = await runLocalAnalysis({ ...base, provider: provider(), plan: true, perListing: 1 })
    expect(entries.map((e) => e.imageId)).toEqual(['i1'])
    const limited = await runLocalAnalysis({ ...base, provider: provider(), plan: true, limit: 1 })
    expect(limited).toHaveLength(1)
  })

  it('plan mode lists images without downloading, calling the model or storing', async () => {
    const p = provider()
    const entries = await runLocalAnalysis({ ...base, provider: p, plan: true })
    expect(entries.map((e) => e.outcome)).toEqual(['planned', 'planned'])
    expect(hashImage).not.toHaveBeenCalled()
    expect(p.analyze).not.toHaveBeenCalled()
    expect(analyzeListingImage).not.toHaveBeenCalled()
  })

  it('dry run validates results and stores nothing', async () => {
    const p = provider()
    const entries = await runLocalAnalysis({ ...base, provider: p })
    expect(entries.map((e) => e.outcome)).toEqual(['valid', 'valid'])
    expect(entries[0]!.imageId).toBe('i1')
    expect(entries[0]!.listingId).toBe('l1')
    expect(analyzeListingImage).not.toHaveBeenCalled()
  })

  it('keeps extras in the report entry', async () => {
    const extras = { color: 'silver', conversionManufacturer: null, viewAngle: 'side' as const, photoQuality: 'good' as const }
    const p = provider(vi.fn(async () => ({ ...GOOD, extras })))
    const entries = await runLocalAnalysis({ ...base, provider: p })
    expect(entries[0]!.extras).toEqual(extras)
  })

  it('reports an invalid provider result, a provider error and a failed download per image', async () => {
    const analyze = vi
      .fn()
      .mockResolvedValueOnce({ nonsense: true })
      .mockRejectedValueOnce(new Error('boom'))
    const bad = await runLocalAnalysis({ ...base, provider: provider(analyze as never) })
    expect(bad.map((e) => e.outcome)).toEqual(['invalid', 'error'])
    expect(bad[1]!.detail).toBe('boom')

    hashImage.mockResolvedValue({ ok: false, kind: 'http_error' })
    const failed = await runLocalAnalysis({ ...base, provider: provider() })
    expect(failed.map((e) => e.outcome)).toEqual(['download_failed', 'download_failed'])
  })

  describe('batching', () => {
    const usage = { model: 'm', costUsd: 0.02, inputTokens: 200, outputTokens: 20, cachedInputTokens: 0, durationMs: 1000 }
    function batchProvider(analyzeBatch: ImageAnalysisProvider['analyzeBatch']) {
      return { ...provider(), analyzeBatch, getLastUsage: () => usage } as ImageAnalysisProvider
    }

    it('analyzes a listing in one call and splits the usage across its photos', async () => {
      const analyzeBatch = vi.fn(async (inputs: unknown[]) => inputs.map(() => GOOD))
      const entries = await runLocalAnalysis({ ...base, provider: batchProvider(analyzeBatch) })
      expect(analyzeBatch).toHaveBeenCalledTimes(1)
      expect(entries.map((e) => e.outcome)).toEqual(['valid', 'valid'])
      expect(entries[0]!.batchSize).toBe(2)
      expect(entries[0]!.usage!.costUsd).toBeCloseTo(0.01)
    })

    it('does not retry one by one after a timeout, missing binary or non-zero exit', async () => {
      const analyzeBatch = vi.fn(async () => {
        throw new Error('claude CLI timed out after 1000ms')
      })
      const single = vi.fn(async () => GOOD)
      const p = { ...batchProvider(analyzeBatch), analyze: single } as ImageAnalysisProvider
      const entries = await runLocalAnalysis({ ...base, provider: p })
      expect(single).not.toHaveBeenCalled()
      expect(entries.map((e) => e.outcome)).toEqual(['error', 'error'])
      expect(entries[0]!.detail).toMatch(/timed out/)
    })

    it('falls back to one call per photo when the batch is unparseable or returns the wrong count', async () => {
      for (const analyzeBatch of [
        vi.fn(async () => {
          throw new CliOutputError('No JSON array found in CLI output')
        }),
        vi.fn(async () => [GOOD]),
      ]) {
        const single = vi.fn(async () => GOOD)
        const p = { ...batchProvider(analyzeBatch), analyze: single } as ImageAnalysisProvider
        const entries = await runLocalAnalysis({ ...base, provider: p })
        expect(single).toHaveBeenCalledTimes(2)
        expect(entries.map((e) => e.outcome)).toEqual(['valid', 'valid'])
        expect(entries[0]!.batchSize).toBe(1)
      }
    })
  })

  it('persist mode stores only validated results, through analyzeListingImage', async () => {
    analyzeListingImage.mockResolvedValue({ status: 'success', errorMessage: null })
    const entries = await runLocalAnalysis({ ...base, provider: provider(), persist: true })
    expect(entries.map((e) => e.outcome)).toEqual(['stored', 'stored'])
    expect(analyzeListingImage).toHaveBeenCalledTimes(2)
    expect(analyzeListingImage.mock.calls[0]![2]).toMatchObject({ listingImageId: 'i1', contentHash: 'h' })
    // the stored provider replays the already-analysed result rather than calling the model again
    const replay = analyzeListingImage.mock.calls[0]![1] as ImageAnalysisProvider
    await expect(replay.analyze({ imageBytes: new Uint8Array(), contentType: 'image/jpeg', schemaVersion: '1' })).resolves.toEqual(GOOD)
  })

  it('persist mode records the model reported by the CLI when --model was not given', async () => {
    analyzeListingImage.mockResolvedValue({ status: 'success', errorMessage: null })
    const usage = { model: 'reported-model', costUsd: null, inputTokens: null, outputTokens: null, cachedInputTokens: null, durationMs: null }
    const p = { ...provider(), getLastUsage: () => usage } as ImageAnalysisProvider
    await runLocalAnalysis({ ...base, provider: p, persist: true })
    expect((analyzeListingImage.mock.calls[0]![1] as ImageAnalysisProvider).model).toBe('reported-model')
    const named = { ...p, model: 'chosen' } as ImageAnalysisProvider
    await runLocalAnalysis({ ...base, provider: named, persist: true })
    expect((analyzeListingImage.mock.calls[2]![1] as ImageAnalysisProvider).model).toBe('chosen')
  })

  it('persist mode drops images that already have a row for this version before the limit, so a re-run reaches new photos', async () => {
    analysisFindMany.mockResolvedValue([{ listingImageId: 'i1' }])
    analyzeListingImage.mockResolvedValue({ status: 'success', errorMessage: null })
    const p = provider()
    const entries = await runLocalAnalysis({ ...base, provider: p, persist: true, limit: 1 })
    expect(entries.map((e) => [e.imageId, e.outcome])).toEqual([['i2', 'stored']])
    expect(p.analyze).toHaveBeenCalledTimes(1)
    expect(hashImage).toHaveBeenCalledTimes(1)
  })

  it('persist mode never stores a provider error or a malformed result', async () => {
    const analyze = vi.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce({ nonsense: true })
    const entries = await runLocalAnalysis({ ...base, provider: provider(analyze as never), persist: true })
    expect(entries.map((e) => e.outcome)).toEqual(['error', 'invalid'])
    expect(analyzeListingImage).not.toHaveBeenCalled()
  })

  it('url mode analyzes one image with no database access', async () => {
    const entries = await runLocalAnalysis({ ...base, provider: provider(), url: 'https://x/1.jpg' })
    expect(entries).toHaveLength(1)
    expect(entries[0]!.outcome).toBe('valid')
    expect(findEligible).not.toHaveBeenCalled()
  })

  it('always disconnects the database', async () => {
    await runLocalAnalysis({ ...base, provider: provider(), plan: true })
    expect(disconnect).toHaveBeenCalled()
  })
})

describe('summarizeUsage', () => {
  const usage = (costUsd: number | null) => ({ model: 'm', costUsd, inputTokens: 100, outputTokens: 10, cachedInputTokens: 0, durationMs: 1 })
  const entry = (costUsd: number | null, seconds: number, listingId = 'l1', batchSize = 1) => ({
    imageId: null,
    listingId,
    url: 'u',
    outcome: 'valid' as const,
    seconds,
    batchSize,
    usage: usage(costUsd),
  })

  it('totals cost and tokens, counts a batch as one call, and projects cost per listing and per 1,000 photos', () => {
    const totals = summarizeUsage([entry(0.02, 8, 'l1', 2), entry(0.02, 8, 'l1', 2), entry(0.04, 10, 'l2', 1)])
    expect(totals).toMatchObject({ photos: 3, listings: 2, calls: 2, inputTokens: 300, outputTokens: 30, avgSecondsPerPhoto: 8.7 })
    expect(totals.costUsd).toBeCloseTo(0.08)
    expect(totals.costPerListing).toBeCloseTo(0.04)
    expect(totals.costPer1000Photos).toBeCloseTo(26.67)
  })

  it('reports no cost when the provider reports none, and ignores entries without usage', () => {
    const totals = summarizeUsage([entry(null, 5), { imageId: null, url: 'u', outcome: 'planned' as const, seconds: 0 }])
    expect(totals).toMatchObject({ photos: 1, costUsd: null, costPer1000Photos: null, costPerListing: null })
  })

  it('handles an empty run', () => {
    expect(summarizeUsage([])).toMatchObject({ photos: 0, calls: 0, costUsd: null, avgSecondsPerPhoto: 0 })
  })
})

describe('argvFromEnv', () => {
  it('maps ANALYZE_* variables to flags and keeps a quote in the URL intact', async () => {
    const { argvFromEnv } = await import('./semantic-image-analyze-local-cli.js')
    expect(argvFromEnv({ ANALYZE_PROVIDER: 'claude-cli', ANALYZE_URL: "https://x/it's", ANALYZE_PERSIST: '1' })).toEqual([
      '--provider', 'claude-cli', '--url', "https://x/it's", '--persist',
    ])
    expect(argvFromEnv({})).toEqual([])
  })
})

describe('selectImages', () => {
  const db = { listing: { findMany: listingFindMany }, listingImageSemanticAnalysis: { findMany: analysisFindMany } } as never
  const options = { provider: provider(), limit: undefined, perListing: undefined, onlyGaps: true, requireFinishedStages: true, persist: false, plan: false, outPath: '/tmp/x.json' }

  it('returns the eligible photos and does not look up stored rows unless persisting', async () => {
    expect((await selectImages(db, options)).map((i) => i.id)).toEqual(['i1', 'i2'])
    expect(analysisFindMany).not.toHaveBeenCalled()
  })

  it('drops photos that already have a stored row when persisting, before the limit', async () => {
    analysisFindMany.mockResolvedValue([{ listingImageId: 'i1' }])
    expect((await selectImages(db, { ...options, persist: true, limit: 1 })).map((i) => i.id)).toEqual(['i2'])
  })
})
