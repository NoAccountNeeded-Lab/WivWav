export type { PanelId, PanelIdentity, PanelSpan, WorkspacePanelState, WorkspaceState } from './workspace-types'
export { DEFAULT_PANEL_SPAN, EMPTY_WORKSPACE_STATE, makePanelId, parsePanelId } from './workspace-types'

export { decodeWorkspaceState, encodeWorkspaceState } from './workspace-url'

export { useWorkspaceState } from './useWorkspaceState'
export type { WorkspaceApi } from './useWorkspaceState'

export { WorkspacePanel } from './WorkspacePanel'
export type { WorkspaceAction, WorkspacePanelHandle, WorkspacePanelProps } from './WorkspacePanel'

export { WorkspaceGrid } from './WorkspaceGrid'
export type { WorkspaceGridProps, WorkspacePanelContent } from './WorkspaceGrid'

export { WorkspaceResizableSplit } from './WorkspaceResizableSplit'
export type { WorkspaceResizableSplitProps } from './WorkspaceResizableSplit'
