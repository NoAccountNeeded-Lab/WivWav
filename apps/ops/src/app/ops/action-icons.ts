import {
  Activity,
  Archive,
  Ban,
  CheckCircle2,
  Download,
  Eye,
  EyeOff,
  FastForward,
  Hash,
  Pause,
  Pencil,
  Play,
  RefreshCw,
  RotateCw,
  ShieldCheck,
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
  download: Download,
  cancelJob: Ban,
  retryJob: RotateCw,
  makeReady: FastForward,
  decodeVin: Hash,
  hideListing: EyeOff,
  unhideListing: Eye,
  markGone: Archive,
  releaseQuarantine: ShieldCheck,
} as const satisfies Record<string, LucideIcon>
