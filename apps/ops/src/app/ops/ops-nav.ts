export type OpsNavGroupId =
  | 'overview'
  | 'inventory'
  | 'sources'
  | 'workflows'
  | 'failures'
  | 'schedules'
  | 'logs'
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
    overviewQuickLink?: {
      label: string
      order: number
    }
  }
}

export interface OpsNavGroup {
  id: OpsNavGroupId
  title: string
  intro: string
  items: OpsNavItem[]
}

type OpsNavOverviewLinkItem = OpsNavItem & {
  shell: NonNullable<OpsNavItem['shell']> & {
    overviewQuickLink: NonNullable<NonNullable<OpsNavItem['shell']>['overviewQuickLink']>
  }
}

type OpsNavMobileTabItem = OpsNavItem & {
  shell: NonNullable<OpsNavItem['shell']> & {
    mobileTab: NonNullable<NonNullable<OpsNavItem['shell']>['mobileTab']>
  }
}

function hasOverviewQuickLink(item: OpsNavItem): item is OpsNavOverviewLinkItem {
  return item.shell?.overviewQuickLink !== undefined
}

function hasMobileTab(item: OpsNavItem): item is OpsNavMobileTabItem {
  return item.shell?.mobileTab !== undefined
}

export const OPS_NAV_GROUPS: OpsNavGroup[] = [
  {
    id: 'overview',
    title: 'Overview',
    intro: 'Start with service health and the most common operator checks.',
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
          overviewQuickLink: {
            label: 'System Status',
            order: 8,
          },
        },
      },
    ],
  },
  {
    id: 'inventory',
    title: 'Inventory',
    intro: 'Keep listings searchable and visible to shoppers.',
    items: [
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
          overviewQuickLink: {
            label: 'Refresh Listings',
            order: 0,
          },
        },
      },
    ],
  },
  {
    id: 'sources',
    title: 'Sources',
    intro: 'Manage the websites WivWav imports listings from.',
    items: [
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
          overviewQuickLink: {
            label: 'Sources',
            order: 2,
          },
        },
      },
    ],
  },
  {
    id: 'workflows',
    title: 'Workflows',
    intro: 'Follow recent work and confirm that listing updates are moving.',
    items: [
      {
        href: '/ops/runs',
        title: 'Listing import activity',
        desc: 'Review recent source runs, new listing counts, updates, failures, and long-running imports.',
        shell: {
          placement: 'primary',
          overviewQuickLink: {
            label: 'Runs',
            order: 3,
          },
        },
      },
    ],
  },
  {
    id: 'failures',
    title: 'Failures',
    intro: 'Find repair work that needs operator attention.',
    items: [
      {
        href: '/ops/ai',
        title: 'Source repair',
        desc: 'Check AI service health and sources whose page layout changed enough to need remapping.',
        shell: {
          placement: 'primary',
          overviewQuickLink: {
            label: 'AI',
            order: 6,
          },
        },
      },
      {
        href: '/ops/field-conflicts',
        title: 'Field conflicts',
        desc: 'Review listings whose entry type or ramp type has conflicting evidence (#499) and is excluded from side/rear and ramp-type search filters until resolved.',
        shell: {
          placement: 'primary',
          overviewQuickLink: {
            label: 'Field Conflicts',
            order: 9,
          },
        },
      },
    ],
  },
  {
    id: 'schedules',
    title: 'Schedules',
    intro: 'Control when recurring operational jobs run.',
    items: [
      {
        href: '/ops/schedules',
        title: 'Recurring jobs',
        desc: 'Enable, disable, or edit automatic listing refresh, geocoding, and safety-data schedules.',
        shell: {
          placement: 'primary',
          overviewQuickLink: {
            label: 'Schedules',
            order: 4,
          },
        },
      },
    ],
  },
  {
    id: 'logs',
    title: 'Logs',
    intro: 'Inspect recent application events without leaving the operator console.',
    items: [
      {
        href: '/ops/logs',
        title: 'Application logs',
        desc: 'Search recent API, listing import, background job, and browser error logs by service and severity.',
        shell: {
          placement: 'primary',
          overviewQuickLink: {
            label: 'Logs',
            order: 5,
          },
        },
      },
    ],
  },
  {
    id: 'advanced',
    title: 'Advanced',
    intro: 'Diagnostics for maintainers who need raw job internals or provider configuration.',
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
          overviewQuickLink: {
            label: 'Queues',
            order: 1,
          },
        },
      },
      {
        href: '/ops/config',
        title: 'AI provider settings',
        desc: 'Edit AI providers, model names, API key config IDs, and encrypted provider secrets.',
        shell: {
          placement: 'advanced',
          overviewQuickLink: {
            label: 'AI Config',
            order: 7,
          },
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

export function getOpsOverviewLinks(groups: OpsNavGroup[] = OPS_NAV_GROUPS): OpsNavItem[] {
  return groups
    .flatMap(group => group.items)
    .filter(hasOverviewQuickLink)
    .sort((a, b) => a.shell.overviewQuickLink.order - b.shell.overviewQuickLink.order)
}

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
