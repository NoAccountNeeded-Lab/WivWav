import { describe, expect, it } from 'vitest'
import { getOpsMobileTabs, OPS_NAV_GROUPS, type OpsNavGroupId } from './ops-nav'

/**
 * All known Next.js page routes under apps/web/src/app.
 * Update this set whenever a new page.tsx is added.
 */
const KNOWN_NEXT_ROUTES = new Set([
  '/ops',
  '/ops/ai',
  '/ops/config',
  '/ops/field-conflicts',
  '/ops/logs',
  '/ops/queues',
  '/ops/readiness',
  '/ops/refresh-listings',
  '/ops/runs',
  '/ops/schedules',
  '/ops/sources',
  '/status',
  '/filters',
  '/filters/[id]',
  '/listings/[id]',
  '/discover',
  '/privacy',
  '/terms',
  '/vin',
  '/vin/[vin]',
])

describe('OPS_NAV_GROUPS', () => {
  it('should render a flat primary list plus a single titled advanced section', () => {
    const required: OpsNavGroupId[] = ['primary', 'advanced']

    expect(OPS_NAV_GROUPS.map(group => group.id)).toEqual(required)
  })

  it('should never introduce a single-item group heading (a future group of one fails here)', () => {
    for (const group of OPS_NAV_GROUPS) {
      if (group.id === 'advanced') continue
      expect(group.title, `group "${group.id}" must have no heading (only "advanced" is titled)`).toBe('')
    }

    const advanced = OPS_NAV_GROUPS.find(group => group.id === 'advanced')
    expect(advanced?.title).toBe('Advanced')
  })

  it('should preserve all existing operational destinations', () => {
    const hrefs = new Set(OPS_NAV_GROUPS.flatMap(group => group.items.map(item => item.href)))

    expect(hrefs).toEqual(new Set([
      '/ops',
      '/ops/readiness',
      '/status',
      '/ops/refresh-listings',
      '/ops/sources',
      '/ops/runs',
      '/ops/ai',
      '/ops/field-conflicts',
      '/ops/schedules',
      '/ops/logs',
      '/ops/queues',
      '/ops/config',
      '/admin/board',
    ]))
  })

  it('should expose the shell mobile tabs in the agreed order', () => {
    expect(getOpsMobileTabs()).toEqual([
      { href: '/ops', label: 'Overview', order: 0 },
      { href: '/ops/refresh-listings', label: 'Refresh', order: 1 },
      { href: '/ops/sources', label: 'Sources', order: 2 },
      { href: '/ops/queues', label: 'Queues', order: 3 },
    ])
  })

  it('should keep raw queue tools under advanced diagnostics', () => {
    const advanced = OPS_NAV_GROUPS.find(group => group.id === 'advanced')

    expect(advanced?.items.map(item => item.href)).toContain('/ops/queues')
  })

  it('should keep Bull Board under advanced diagnostics', () => {
    const advanced = OPS_NAV_GROUPS.find(group => group.id === 'advanced')

    expect(advanced?.items).toContainEqual(expect.objectContaining({
      href: '/admin/board',
      external: true,
      title: expect.stringContaining('diagnostics'),
    }))
  })

  it('should use operator-facing labels outside advanced diagnostics', () => {
    const primaryTitles = OPS_NAV_GROUPS
      .filter(group => group.id !== 'advanced')
      .flatMap(group => [group.title, ...group.items.map(item => item.title)])
      .join(' ')

    expect(primaryTitles).not.toMatch(/BullMQ|Meilisearch|scraper|queue/i)
  })

  it('should send inventory operators to the guided refresh-listings workflow, not raw queues', () => {
    const primary = OPS_NAV_GROUPS.find(group => group.id === 'primary')

    expect(primary?.items.map(item => item.href)).toContain('/ops/refresh-listings')
    expect(primary?.items.map(item => item.href)).not.toContain('/ops/queues')
  })

  it('should map every internal (non-apiOrigin) href to a known Next.js app route', () => {
    const internalItems = OPS_NAV_GROUPS
      .flatMap(group => group.items)
      .filter(item => !item.apiOrigin)

    for (const item of internalItems) {
      expect(
        KNOWN_NEXT_ROUTES.has(item.href),
        `"${item.href}" (title: "${item.title}") is not a known Next.js route`,
      ).toBe(true)
    }
  })

  it('should mark every API-origin destination with apiOrigin: true and external: true', () => {
    const apiOriginItems = OPS_NAV_GROUPS
      .flatMap(group => group.items)
      .filter(item => item.apiOrigin)

    // There must be at least one API-origin item (Bull Board)
    expect(apiOriginItems.length).toBeGreaterThanOrEqual(1)

    for (const item of apiOriginItems) {
      expect(item.external, `"${item.title}" has apiOrigin but is missing external: true`).toBe(true)
    }
  })

  it('should never render /admin/board as a same-origin Next.js route', () => {
    const bullBoardItems = OPS_NAV_GROUPS
      .flatMap(group => group.items)
      .filter(item => item.href === '/admin/board')

    expect(bullBoardItems.length).toBeGreaterThanOrEqual(1)

    for (const item of bullBoardItems) {
      expect(item.apiOrigin, 'Bull Board must have apiOrigin: true so renderers use the API base URL').toBe(true)
    }
  })
})
