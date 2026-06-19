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
  href: string
  title: string
  desc: string
  external?: boolean
}

export interface OpsNavGroup {
  id: OpsNavGroupId
  title: string
  intro: string
  items: OpsNavItem[]
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
        href: '/ops/queues',
        title: 'Listing refresh tools',
        desc: 'Run geocoding, detail refreshes, deduplication, and search-index sync tasks for current listings.',
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
        external: true,
      },
    ],
  },
]
