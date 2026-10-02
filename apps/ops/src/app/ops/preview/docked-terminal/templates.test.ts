import { describe, expect, it } from 'vitest'
import { NAV_PANEL_MAP, SINGLETON_ENTITY_ID } from './panel-nav-map'
import { WORKSPACE_TEMPLATES } from './templates'

describe('NAV_PANEL_MAP', () => {
  it('maps nav hrefs to singleton panels', () => {
    expect(Object.keys(NAV_PANEL_MAP).sort()).toEqual(['/ops/problems', '/ops/queues', '/ops/readiness'])
    for (const mapping of Object.values(NAV_PANEL_MAP)) {
      expect(mapping.entityId).toBe(SINGLETON_ENTITY_ID)
    }
  })
})

describe('WORKSPACE_TEMPLATES', () => {
  it('has unique ids and names', () => {
    expect(new Set(WORKSPACE_TEMPLATES.map((t) => t.id)).size).toBe(WORKSPACE_TEMPLATES.length)
    expect(new Set(WORKSPACE_TEMPLATES.map((t) => t.name)).size).toBe(WORKSPACE_TEMPLATES.length)
  })

  it('only uses nav-mapped singleton panels, with spans matching the nav map', () => {
    const mappings = Object.values(NAV_PANEL_MAP)
    for (const template of WORKSPACE_TEMPLATES) {
      expect(template.panels.length).toBeGreaterThan(0)
      for (const panel of template.panels) {
        expect(panel.entityId).toBe(SINGLETON_ENTITY_ID)
        expect(mappings).toContainEqual(panel)
      }
    }
  })
})
