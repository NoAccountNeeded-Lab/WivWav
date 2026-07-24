import type { PanelSpan } from '@/components/Workspace/workspace-types'

/** Singleton entity id for the three nav-mapped panels — there is only ever
 *  one `readiness`/`problems`/`queues` panel, unlike `source`/`logs` panels
 *  (opened per source id / job id via entity relationship links). */
export const SINGLETON_ENTITY_ID = 'main'

export interface NavPanelMapping {
  entityType: string
  entityId: string
  span: PanelSpan
}

/**
 * Nav hrefs this route intercepts into a workspace panel open/focus instead
 * of navigation (#913). Hrefs not listed here fall through to normal
 * `<Link>` navigation — e.g. AI provider settings, Bull Board, Field
 * conflicts have no panel yet.
 */
export const NAV_PANEL_MAP: Record<string, NavPanelMapping> = {
  '/ops/readiness': { entityType: 'readiness', entityId: SINGLETON_ENTITY_ID, span: 1 },
  '/ops/problems': { entityType: 'problems', entityId: SINGLETON_ENTITY_ID, span: 2 },
  '/ops/queues': { entityType: 'queues', entityId: SINGLETON_ENTITY_ID, span: 2 },
}
