/**
 * Shared type contract for the Ops workspace/panel system (#854, implementing
 * section 3 of `docs/design/ui-boundary-and-ops-workspace.md`). A "panel" is a
 * contextual view onto one entity (a run, a source, a queue, a log window);
 * the workspace is the set of panels currently open, their order, their grid
 * column span, and which one (if any) is maximized.
 */

/** Declarable CSS Grid column span for a panel. `'full'` spans every column. */
export type PanelSpan = 1 | 2 | 'full'

export const DEFAULT_PANEL_SPAN: PanelSpan = 1

/** Identifies the entity a panel is showing. `entityType` is a short slug
 *  (`run`, `source`, `queue`, `log`); `entityId` is that entity's own id. */
export interface PanelIdentity {
  entityType: string
  entityId: string
}

/** Stable, URL-addressable panel id of the form `{entityType}:{entityId}`
 *  (e.g. `run:1234`, `source:blvd`). Two panels for the same entity always
 *  produce the same id, which is what lets `openPanel` focus rather than
 *  duplicate an already-open panel. */
export type PanelId = `${string}:${string}`

export interface WorkspacePanelState extends PanelIdentity {
  id: PanelId
  span: PanelSpan
}

export interface WorkspaceState {
  /** Open panels in display order. */
  panels: WorkspacePanelState[]
  /** The single maximized panel's id, or `null` when no panel is maximized. */
  maximizedId: PanelId | null
}

export const EMPTY_WORKSPACE_STATE: WorkspaceState = { panels: [], maximizedId: null }

export function makePanelId(entityType: string, entityId: string): PanelId {
  return `${entityType}:${entityId}`
}

/** Splits a `PanelId` back into its `{entityType}:{entityId}` parts. Panel ids
 *  are always produced by `makePanelId`, so the first `:` is the separator
 *  even if `entityId` itself later contains one (see `workspace-url.ts` for
 *  how ids round-trip through the URL, where each field is escaped
 *  separately rather than split back out of the joined id). */
export function parsePanelId(id: PanelId): PanelIdentity {
  const separatorIndex = id.indexOf(':')
  return { entityType: id.slice(0, separatorIndex), entityId: id.slice(separatorIndex + 1) }
}
