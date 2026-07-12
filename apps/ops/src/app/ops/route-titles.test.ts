// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { getOpsNavTitle, OPS_NAV_GROUPS } from './ops-nav'
import * as overviewPage from './page'
import * as readinessPage from './readiness/page'
import * as refreshListingsPage from './refresh-listings/page'
import * as sourcesPage from './sources/page'
import * as sourcePipelinePage from './sources/[id]/page'
import * as runsPage from './runs/page'
import * as aiPage from './ai/page'
import * as schedulesPage from './schedules/page'
import * as logsPage from './logs/page'
import * as queuesPage from './queues/page'
import * as configPage from './config/page'
import * as statusPage from '../status/page'

// #735 (E8): every /ops route must set a distinct document title. Each
// entry pairs a page module with the href it serves so its title can be
// checked against the nav registry's own label for that destination — the
// single source of truth both the header breadcrumb and this test read
// from (getOpsNavTitle in ops-nav.ts).
const ROUTE_PAGES: ReadonlyArray<{ href: string; mod: { metadata?: { title?: unknown } } }> = [
  { href: '/ops', mod: overviewPage },
  { href: '/ops/readiness', mod: readinessPage },
  { href: '/ops/refresh-listings', mod: refreshListingsPage },
  { href: '/ops/sources', mod: sourcesPage },
  { href: '/ops/runs', mod: runsPage },
  { href: '/ops/ai', mod: aiPage },
  { href: '/ops/schedules', mod: schedulesPage },
  { href: '/ops/logs', mod: logsPage },
  { href: '/ops/queues', mod: queuesPage },
  { href: '/ops/config', mod: configPage },
  { href: '/status', mod: statusPage },
]

describe('ops route document titles', () => {
  it('every registered nav destination has a page metadata title matching its registry label', () => {
    for (const { href, mod } of ROUTE_PAGES) {
      const navTitle = getOpsNavTitle(href, OPS_NAV_GROUPS)
      expect(navTitle, `no nav registry entry found for ${href}`).toBeDefined()
      expect(mod.metadata?.title, `${href} is missing export const metadata.title`).toBe(`${navTitle} · WivWav Ops`)
    }
  })

  it('the dynamic source pipeline route (not in the nav registry) sets its own literal title', () => {
    expect(sourcePipelinePage.metadata?.title).toBe('Source pipeline · WivWav Ops')
  })

  it('every /ops route (and /status) has a distinct document title', () => {
    const titles = [...ROUTE_PAGES.map(({ mod }) => mod.metadata?.title), sourcePipelinePage.metadata?.title]
    expect(new Set(titles).size).toBe(titles.length)
  })
})
