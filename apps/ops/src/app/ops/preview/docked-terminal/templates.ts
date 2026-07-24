import type { PanelSpan } from '@/components/Workspace/workspace-types'
import { SINGLETON_ENTITY_ID } from './panel-nav-map'

export interface WorkspaceTemplatePanel {
  entityType: string
  entityId: string
  span: PanelSpan
}

export interface WorkspaceTemplate {
  id: string
  name: string
  panels: WorkspaceTemplatePanel[]
}

/**
 * Named, curated workspace layouts (#915) — "perspectives" in the
 * Eclipse-IDE sense, not a new state system. Each template is just a
 * predefined panel list that gets pushed through the same
 * `replacePanels`/`workspace-url.ts` encoding a manual open/close sequence
 * would produce, so the resulting URL is indistinguishable from one an
 * operator built by hand (#854's URL-state contract, reused rather than
 * duplicated).
 *
 * Limited to the three "singleton" panel types (`readiness`, `problems`,
 * `queues` — see `panel-nav-map.ts`) that have a single, always-valid
 * `entityId`. `source`/`logs` panels are keyed to one specific source or job
 * and only make sense opened via their entity-relationship drill-down links
 * (#913), so there is no meaningful *static* id to preset for them here.
 *
 * Developer-defined config only — no template-authoring UI in this
 * iteration (see issue #915 "Notes").
 */
export const WORKSPACE_TEMPLATES: WorkspaceTemplate[] = [
  {
    id: 'triage',
    name: 'Triage',
    panels: [
      { entityType: 'problems', entityId: SINGLETON_ENTITY_ID, span: 2 },
      { entityType: 'queues', entityId: SINGLETON_ENTITY_ID, span: 2 },
    ],
  },
  {
    id: 'health-check',
    name: 'Health check',
    panels: [
      { entityType: 'readiness', entityId: SINGLETON_ENTITY_ID, span: 1 },
      { entityType: 'problems', entityId: SINGLETON_ENTITY_ID, span: 2 },
    ],
  },
]
