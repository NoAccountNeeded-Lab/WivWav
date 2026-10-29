import {
  Activity,
  AlertTriangle,
  Bot,
  Calendar,
  CircleHelp,
  Compass,
  Cpu,
  Globe,
  Layers,
  KeyRound,
  LayoutDashboard,
  LockKeyhole,
  RefreshCw,
  SlidersHorizontal,
  Settings2,
  ShieldCheck,
  Terminal,
  Wrench,
  type LucideIcon,
} from 'lucide-react'

/**
 * href → icon lookup shared by every nav surface (bottom tabs, rail, column,
 * More sheet, and overview quick links). Keep this as the single icon map so
 * destinations do not drift between separate mirrors.
 */
export const OPS_NAV_ICONS: Record<string, LucideIcon> = {
  '/ops': LayoutDashboard,
  '/ops/readiness': Compass,
  '/status': ShieldCheck,
  '/ops/refresh-listings': RefreshCw,
  '/ops/sources': Globe,
  '/ops/problems': AlertTriangle,
  '/ops/runs': Activity,
  '/ops/ai': Bot,
  '/ops/schedules': Calendar,
  '/ops/logs': Terminal,
  '/ops/queues': Layers,
  '/ops/workers': Cpu,
  '/ops/settings': SlidersHorizontal,
  '/ops/config': Settings2,
  '/ops/api-keys': KeyRound,
  '/ops/privacy-requests': LockKeyhole,
  '/ops/field-conflicts': AlertTriangle,
  '/admin/board': Wrench,
}

export const OPS_NAV_FALLBACK_ICON: LucideIcon = CircleHelp

export function getOpsNavIcon(href: string): LucideIcon {
  return OPS_NAV_ICONS[href] ?? OPS_NAV_FALLBACK_ICON
}
