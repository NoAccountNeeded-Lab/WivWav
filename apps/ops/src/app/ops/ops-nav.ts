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
}

export interface OpsNavGroup {
  id: OpsNavGroupId
  title: string
  intro: string
  items: OpsNavItem[]
}

/**
 * True when `pathname` is the current location for `item`.
 *
 * API-origin destinations (Bull Board) are full-navigation external links and
 * are never treated as an "active" in-app route — the operator has left the
 * SPA-feeling shell entirely while there.
 *
 * Internal items match on exact pathname or on a `/segment` boundary so a
 * dynamic child route (e.g. `/ops/sources/abc123`) still activates its
 * parent nav item (`/ops/sources`) without `/ops/sourcesx` false-matching.
 */
export function isNavItemActive(pathname: string, item: OpsNavItem): boolean {
  if (item.apiOrigin) return false
  return pathname === item.href || pathname.startsWith(`${item.href}/`)
}

/**
 * Finds the nav group/item pair whose href matches `pathname`, preferring the
 * longest (most specific) href when more than one item could match a nested
 * route. Returns `undefined` for routes with no nav entry (e.g. the `/ops`
 * overview root itself), so callers can fall back to a generic heading.
 */
export function getActiveNavItem(
  pathname: string,
): { group: OpsNavGroup; item: OpsNavItem } | undefined {
  let best: { group: OpsNavGroup; item: OpsNavItem } | undefined
  for (const group of OPS_NAV_GROUPS) {
    for (const item of group.items) {
      if (!isNavItemActive(pathname, item)) continue
      if (!best || item.href.length > best.item.href.length) {
        best = { group, item }
      }
    }
  }
  return best
}

export const OPS_NAV_GROUPS: OpsNavGroup[] = [
  {
    id: 'overview',
    title: 'Overview',
    intro: 'Start with service health and the most common operator checks.',
    items: [
      {
        href: '/ops/readiness',
        title: 'Site readiness',
        desc: 'Launch and handoff checklist — service health, inventory, search, schedules, queues, and recent scrape activity.',
      },
      {
        href: '/status',
        title: 'System status',
        desc: 'Check whether the API, database, search index, cache, and background services are reachable.',
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
      },
      {
        href: '/ops/config',
        title: 'AI provider settings',
        desc: 'Edit AI providers, model names, API key config IDs, and encrypted provider secrets.',
      },
      {
        href: '/admin/board',
        title: 'Bull Board diagnostics',
        desc: 'Open the full raw queue inspector for payloads, retry details, and stack traces.',
        apiOrigin: true,
        external: true,
      },
    ],
  },
]
