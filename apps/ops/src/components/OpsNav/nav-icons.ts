import {
  Activity,
  Bot,
  Calendar,
  Compass,
  Globe,
  Layers,
  LayoutDashboard,
  RefreshCw,
  Settings2,
  ShieldCheck,
  Terminal,
  Wrench,
  type LucideIcon,
} from 'lucide-react'

/**
 * href → icon lookup shared by every nav surface (bottom tabs, rail, column,
 * More sheet). Mirrors `OPS_LINK_ICONS` in `OpsOverviewClient.tsx` so the same
 * destination always reads with the same glyph everywhere in the shell.
 */
export const OPS_NAV_ICONS: Record<string, LucideIcon> = {
  '/ops': LayoutDashboard,
  '/ops/readiness': Compass,
  '/status': ShieldCheck,
  '/ops/refresh-listings': RefreshCw,
  '/ops/sources': Globe,
  '/ops/runs': Activity,
  '/ops/ai': Bot,
  '/ops/schedules': Calendar,
  '/ops/logs': Terminal,
  '/ops/queues': Layers,
  '/ops/config': Settings2,
  '/admin/board': Wrench,
}

export function getOpsNavIcon(href: string): LucideIcon | undefined {
  return OPS_NAV_ICONS[href]
}
