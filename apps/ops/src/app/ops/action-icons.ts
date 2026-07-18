import {
  Activity,
  CheckCircle2,
  Pause,
  Pencil,
  Play,
  RefreshCw,
  Save,
  Trash2,
  XCircle,
  Zap,
  type LucideIcon,
} from 'lucide-react'

/**
 * verb → icon lookup shared by every ops action button so the same action
 * always reads with the same glyph, regardless of which page renders it
 * (mirrors `OPS_NAV_ICONS` in `OpsNav/nav-icons.ts` for navigation
 * destinations). Resume/Enable and Pause/Disable are deliberately distinct
 * glyphs so paired opposite actions stay easy to tell apart at a glance.
 *
 * Icons here are decorative — always pair with the button's existing text
 * label and render with `aria-hidden="true"`.
 */
export const ACTION_ICONS = {
  pause: Pause,
  resume: Play,
  disable: XCircle,
  enable: CheckCircle2,
  trigger: Zap,
  activity: Activity,
  refresh: RefreshCw,
  edit: Pencil,
  save: Save,
  delete: Trash2,
} as const satisfies Record<string, LucideIcon>
