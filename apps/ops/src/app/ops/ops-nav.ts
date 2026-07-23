/**
 * `primary` renders as a single flat list with no group heading. `advanced`
 * is the only group whose heading renders — it's the sole titled section
 * left after flattening (#759).
 */
export type OpsNavGroupId =
  | 'primary'
  | 'advanced'

export interface OpsNavItem {
  /**
   * For internal Next.js routes: the pathname (e.g. `/ops/queues`).
   * For API-hosted destinations: the path relative to the API origin (e.g. `/admin/board`).
   * When `apiOrigin` is true, callers must build the URL from the public API base URL rather than
   * rendering a same-origin Next `Link`.
   */
  href: string
  title: string
  desc: string
  /** True when `href` lives on the API origin rather than the Next.js web origin. */
  apiOrigin?: boolean
  /** True when the destination should open in a new tab (may be combined with `apiOrigin`). */
  external?: boolean
  shell?: {
    placement?: 'primary' | 'advanced'
    mobileTab?: {
      label: string
      order: number
    }
  }
}

export interface OpsNavGroup {
  id: OpsNavGroupId
  title: string
  items: OpsNavItem[]
}

type OpsNavMobileTabItem = OpsNavItem & {
  shell: NonNullable<OpsNavItem['shell']> & {
    mobileTab: NonNullable<NonNullable<OpsNavItem['shell']>['mobileTab']>
  }
}

function hasMobileTab(item: OpsNavItem): item is OpsNavMobileTabItem {
  return item.shell?.mobileTab !== undefined
}

export const OPS_NAV_GROUPS: OpsNavGroup[] = [
  {
    id: 'primary',
    title: '',
    items: [
      {
        href: '/ops',
        title: 'Operations overview',
        desc: 'Open the operator home dashboard with service health, attention items, and quick links.',
        shell: {
          placement: 'primary',
          mobileTab: {
            label: 'Overview',
            order: 0,
          },
        },
      },
      {
        href: '/ops/readiness',
        title: 'Site readiness',
        desc: 'Launch and handoff checklist — service health, inventory, search, schedules, queues, and recent scrape activity.',
        shell: {
          placement: 'primary',
        },
      },
      {
        href: '/status',
        title: 'System status',
        desc: 'Check whether the API, database, search index, cache, and background services are reachable.',
        shell: {
          placement: 'primary',
        },
      },
      {
        href: '/ops/refresh-listings',
        title: 'Listing refresh workflow',
        desc: 'Step through scrape, detail extract, geocode, deduplication, and search-index sync with guided status checks.',
        shell: {
          placement: 'primary',
          mobileTab: {
            label: 'Refresh',
            order: 1,
          },
        },
      },
      {
        href: '/ops/problems',
        title: 'Problems',
        desc: 'Every active problem across services, sources, queues, schedules, Grafana alerts, and Sentry issues — with first-seen, last-seen, occurrence count, severity, and acknowledgement.',
        shell: {
          placement: 'primary',
        },
      },
      {
        href: '/ops/sources',
        title: 'Source health',
        desc: 'Review source status, listing counts, last scrape time, errors, and run a source immediately.',
        shell: {
          placement: 'primary',
          mobileTab: {
            label: 'Sources',
            order: 2,
          },
        },
      },
      {
        href: '/ops/runs',
        title: 'Listing import activity',
        desc: 'Review recent source runs, new listing counts, updates, failures, and long-running imports.',
        shell: {
          placement: 'primary',
        },
      },
      {
        href: '/ops/schedules',
        title: 'Recurring jobs',
        desc: 'Enable, disable, or edit automatic listing refresh, geocoding, and safety-data schedules.',
        shell: {
          placement: 'primary',
        },
      },
      {
        href: '/ops/logs',
        title: 'Application logs',
        desc: 'Search recent API, listing import, background job, and browser error logs by service and severity.',
        shell: {
          placement: 'primary',
        },
      },
      {
        href: '/ops/ai',
        title: 'Source repair',
        desc: 'Check AI service health and sources whose page layout changed enough to need remapping.',
        shell: {
          placement: 'primary',
        },
      },
      {
        href: '/ops/field-conflicts',
        title: 'Field conflicts',
        desc: 'Review listings whose entry type or ramp type has conflicting evidence (#499) and is excluded from side/rear and ramp-type search filters until resolved.',
        shell: {
          placement: 'primary',
        },
      },
    ],
  },
  {
    id: 'advanced',
    title: 'Advanced',
    items: [
      {
        href: '/ops/queues',
        title: 'Queue diagnostics',
        desc: 'Inspect raw background job counts, pause or resume workers, trigger jobs, and open job activity.',
        shell: {
          placement: 'advanced',
          mobileTab: {
            label: 'Queues',
            order: 3,
          },
        },
      },
      {
        href: '/ops/config',
        title: 'AI provider settings',
        desc: 'Edit AI providers, model names, API key config IDs, and encrypted provider secrets.',
        shell: {
          placement: 'advanced',
        },
      },
      {
        href: '/admin/board',
        title: 'Bull Board diagnostics',
        desc: 'Open the full raw queue inspector for payloads, retry details, and stack traces.',
        apiOrigin: true,
        external: true,
        shell: {
          placement: 'advanced',
        },
      },
    ],
  },
]

export function getOpsMobileTabs(groups: OpsNavGroup[] = OPS_NAV_GROUPS): Array<{
  href: string
  label: string
  order: number
}> {
  return groups
    .flatMap(group => group.items)
    .filter(hasMobileTab)
    .map(item => ({
      href: item.href,
      label: item.shell.mobileTab.label,
      order: item.shell.mobileTab.order,
    }))
    .sort((a, b) => a.order - b.order)
}

/**
 * Looks up an item's registry `title` by its exact `href` (E8/#735): the
 * single source of truth for a route's document `<title>`, so page-level
 * metadata can't drift from the nav registry's own label for that
 * destination. Returns `undefined` for routes that intentionally aren't in
 * the registry (e.g. a dynamic `/ops/sources/[id]` detail page) — callers
 * supply their own literal title in that case.
 */
export function getOpsNavTitle(href: string, groups: OpsNavGroup[] = OPS_NAV_GROUPS): string | undefined {
  return groups.flatMap(group => group.items).find(item => item.href === href)?.title
}
