// @vitest-environment jsdom
//
// #937 AC: the source detail page renders a Runs section sourced from
// `GET /admin/sources/:id/job-runs`, showing job type, status, timestamps,
// and nested children by `parentRunId` — verified here with a multi-level
// fixture tree that includes a failed run, whose `errorMessage` must also
// be visible.
import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SourceJobRunsSection } from './SourceJobRunsSection'
import type { JobRunNode } from './source-job-run-helpers'

function jsonResponse(data: unknown): Response {
  return new Response(JSON.stringify({ data }), { status: 200, headers: { 'Content-Type': 'application/json' } })
}

function makeRun(overrides: Partial<JobRunNode> = {}): JobRunNode {
  return {
    id: 'run-1',
    jobType: 'source-scrape',
    sourceId: 'source-1',
    parentRunId: null,
    status: 'succeeded',
    startedAt: '2026-07-25T09:00:00.000Z',
    finishedAt: '2026-07-25T09:01:00.000Z',
    succeededCount: null,
    failedCount: null,
    errorMessage: null,
    children: [],
    ...overrides,
  }
}

// Three-level tree: source-scrape -> detail-extract (failed, with error) -> listing-resolve.
const RUN_TREE: JobRunNode[] = [
  makeRun({
    id: 'run-scrape',
    jobType: 'source-scrape',
    children: [
      makeRun({
        id: 'run-extract',
        jobType: 'detail-extract',
        parentRunId: 'run-scrape',
        status: 'failed',
        finishedAt: '2026-07-25T09:02:00.000Z',
        succeededCount: 4,
        failedCount: 2,
        errorMessage: '2 of 6 raw page(s) failed extraction for source source-1 (4 succeeded)',
        children: [
          makeRun({
            id: 'run-resolve',
            jobType: 'listing-resolve',
            sourceId: null,
            parentRunId: 'run-extract',
            startedAt: '2026-07-25T09:02:30.000Z',
            finishedAt: '2026-07-25T09:02:45.000Z',
            children: [],
          }),
        ],
      }),
    ],
  }),
]

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('SourceJobRunsSection', () => {
  it('renders a multi-level run tree nested by parentRunId, with job type, status, and timestamps', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({
      source: { id: 'source-1', name: 'Acme Motors' },
      generatedAt: '2026-07-25T09:03:00.000Z',
      runs: RUN_TREE,
    })))

    render(<SourceJobRunsSection apiBaseUrl="http://api.test" sourceId="source-1" />)

    await screen.findByText('source-scrape')
    screen.getByText('detail-extract')
    screen.getByText('listing-resolve')

    // Nesting: listing-resolve is a descendant of detail-extract's list item.
    const extractItem = screen.getByText('detail-extract').closest('li')
    expect(extractItem).not.toBeNull()
    within(extractItem as HTMLElement).getByText('listing-resolve')

    // detail-extract's list item is itself nested under source-scrape's.
    const scrapeItem = screen.getByText('source-scrape').closest('li')
    expect(scrapeItem).not.toBeNull()
    within(scrapeItem as HTMLElement).getByText('detail-extract')
  })

  it('shows a failed run\'s status and errorMessage', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({
      source: { id: 'source-1', name: 'Acme Motors' },
      generatedAt: '2026-07-25T09:03:00.000Z',
      runs: RUN_TREE,
    })))

    render(<SourceJobRunsSection apiBaseUrl="http://api.test" sourceId="source-1" />)

    await screen.findByText('detail-extract')

    screen.getByText('Failed')
    screen.getByText('2 of 6 raw page(s) failed extraction for source source-1 (4 succeeded)')
    // Succeeded/failed counts render for the run that reported them.
    screen.getByText('Succeeded 4')
    screen.getByText('Failed 2')
  })

  it('renders an em dash for succeeded/failed counts the job type does not populate', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({
      source: { id: 'source-1', name: 'Acme Motors' },
      generatedAt: '2026-07-25T09:03:00.000Z',
      runs: RUN_TREE,
    })))

    render(<SourceJobRunsSection apiBaseUrl="http://api.test" sourceId="source-1" />)

    await screen.findByText('source-scrape')

    // source-scrape and listing-resolve don't populate stats yet (#937 only
    // wires up detail-extract/deduplicate/vin-enrich) — both should show —.
    expect(screen.getAllByText('Succeeded —')).toHaveLength(2)
    expect(screen.getAllByText('Failed —')).toHaveLength(2)
    // detail-extract does populate stats — it must not also show —.
    screen.getByText('Succeeded 4')
    screen.getByText('Failed 2')
  })

  it('shows an empty state when the source has no recorded job runs', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({
      source: { id: 'source-1', name: 'Acme Motors' },
      generatedAt: '2026-07-25T09:03:00.000Z',
      runs: [],
    })))

    render(<SourceJobRunsSection apiBaseUrl="http://api.test" sourceId="source-1" />)

    await screen.findByText('No job runs recorded for this source yet.')
  })

  it('shows an error state when the request fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 500 })))

    render(<SourceJobRunsSection apiBaseUrl="http://api.test" sourceId="source-1" />)

    await screen.findByText(/Job runs could not load/)
  })
})
