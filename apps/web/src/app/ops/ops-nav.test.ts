import { describe, expect, it } from 'vitest'
import { OPS_NAV_GROUPS, type OpsNavGroupId } from './ops-nav'

describe('OPS_NAV_GROUPS', () => {
  it('should cover the operator intent groups required by the ops navigation', () => {
    const required: OpsNavGroupId[] = [
      'overview',
      'inventory',
      'sources',
      'workflows',
      'failures',
      'schedules',
      'logs',
      'advanced',
    ]

    expect(OPS_NAV_GROUPS.map(group => group.id)).toEqual(required)
  })

  it('should preserve all existing operational destinations', () => {
    const hrefs = new Set(OPS_NAV_GROUPS.flatMap(group => group.items.map(item => item.href)))

    expect(hrefs).toEqual(new Set([
      '/status',
      '/ops/queues',
      '/ops/sources',
      '/ops/runs',
      '/ops/ai',
      '/ops/schedules',
      '/ops/logs',
      '/ops/config',
      '/admin/board',
    ]))
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
})
