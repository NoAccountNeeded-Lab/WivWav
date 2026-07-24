import { makePanelId } from './workspace-types'
import type { PanelId, PanelSpan, WorkspacePanelState, WorkspaceState } from './workspace-types'

/**
 * Serializes/deserializes `WorkspaceState` to/from the URL's query string, so
 * the full open-panel set, order, spans, and maximized state reproduce the
 * exact workspace on reload or share (#854, decision record section 3
 * "URL state"). Pure functions, deliberately React-free, so they can be unit
 * tested without a DOM or router mock — `useWorkspaceState.ts` is the only
 * caller.
 */

const PANELS_PARAM = 'panels'
const MAXIMIZED_PARAM = 'max'
const MINIMIZED_PARAM = 'min'
const PANEL_SEPARATOR = ','
const FIELD_SEPARATOR = ':'

function encodePanelEntry(panel: WorkspacePanelState): string {
  return [panel.entityType, panel.entityId, String(panel.span)].map(encodeURIComponent).join(FIELD_SEPARATOR)
}

function decodeSpan(raw: string): PanelSpan | null {
  if (raw === 'full') return 'full'
  if (raw === '1') return 1
  if (raw === '2') return 2
  return null
}

function decodePanelEntry(entry: string): WorkspacePanelState | null {
  const fields = entry.split(FIELD_SEPARATOR)
  if (fields.length !== 3) return null

  const [entityTypeRaw, entityIdRaw, spanRaw] = fields
  const entityType = decodeURIComponent(entityTypeRaw ?? '')
  const entityId = decodeURIComponent(entityIdRaw ?? '')
  const span = decodeSpan(decodeURIComponent(spanRaw ?? ''))
  if (!entityType || !entityId || span === null) return null

  return { entityType, entityId, span, id: makePanelId(entityType, entityId) }
}

/**
 * Reads `WorkspaceState` from `searchParams`. Malformed panel entries are
 * dropped rather than throwing (a hand-edited or stale URL should degrade to
 * "that one panel doesn't open", not break the whole workspace); duplicate
 * ids keep only the first occurrence, preserving order; a `max` value that
 * doesn't name a currently-open panel is dropped.
 */
export function decodeWorkspaceState(searchParams: URLSearchParams): WorkspaceState {
  const raw = searchParams.get(PANELS_PARAM)
  const seen = new Set<PanelId>()
  const panels: WorkspacePanelState[] = []

  if (raw) {
    for (const entry of raw.split(PANEL_SEPARATOR)) {
      if (!entry) continue
      const decoded = decodePanelEntry(entry)
      if (!decoded || seen.has(decoded.id)) continue
      seen.add(decoded.id)
      panels.push(decoded)
    }
  }

  const maximizedRaw = searchParams.get(MAXIMIZED_PARAM)
  const maximizedId = maximizedRaw && seen.has(maximizedRaw as PanelId) ? (maximizedRaw as PanelId) : null

  const minimizedRaw = searchParams.get(MINIMIZED_PARAM)
  const minimizedId = minimizedRaw && seen.has(minimizedRaw as PanelId) ? (minimizedRaw as PanelId) : null

  return { panels, maximizedId, minimizedId }
}

/**
 * Writes `state` onto a copy of `base` (an existing `URLSearchParams`,
 * typically the current URL's), returning a new `URLSearchParams`. Removes
 * both params entirely when the workspace has no open panels, so an empty
 * workspace never leaves a stray `?panels=` in the URL.
 */
export function encodeWorkspaceState(state: WorkspaceState, base: URLSearchParams): URLSearchParams {
  const next = new URLSearchParams(base)

  if (state.panels.length === 0) {
    next.delete(PANELS_PARAM)
    next.delete(MAXIMIZED_PARAM)
    next.delete(MINIMIZED_PARAM)
    return next
  }

  next.set(PANELS_PARAM, state.panels.map(encodePanelEntry).join(PANEL_SEPARATOR))

  const maximizedIsOpen = state.maximizedId !== null && state.panels.some(p => p.id === state.maximizedId)
  if (maximizedIsOpen && state.maximizedId) {
    next.set(MAXIMIZED_PARAM, state.maximizedId)
  } else {
    next.delete(MAXIMIZED_PARAM)
  }

  const minimizedIsOpen = state.minimizedId !== null && state.panels.some(p => p.id === state.minimizedId)
  if (minimizedIsOpen && state.minimizedId) {
    next.set(MINIMIZED_PARAM, state.minimizedId)
  } else {
    next.delete(MINIMIZED_PARAM)
  }

  return next
}
