// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { InspectorPortal } from './InspectorPortal'
import { OPS_INSPECTOR_SLOT_ID } from './inspector-slot'

afterEach(() => {
  cleanup()
  document.body.innerHTML = ''
})

describe('InspectorPortal', () => {
  it('renders nothing when the OpsShell inspector slot is not present in the DOM', () => {
    render(<InspectorPortal><p>Panel content</p></InspectorPortal>)

    expect(screen.queryByText('Panel content')).toBeNull()
  })

  it('portals children into the OpsShell inspector slot when present', async () => {
    const slot = document.createElement('div')
    slot.id = OPS_INSPECTOR_SLOT_ID
    document.body.appendChild(slot)

    render(<InspectorPortal><p>Panel content</p></InspectorPortal>)

    expect(await screen.findByText('Panel content')).toBeDefined()
    expect(slot.textContent).toContain('Panel content')
  })

  it('renders nothing for closed inspector content (InspectorPanel returns null when isOpen is false)', () => {
    const slot = document.createElement('div')
    slot.id = OPS_INSPECTOR_SLOT_ID
    document.body.appendChild(slot)

    render(<InspectorPortal>{null}</InspectorPortal>)

    expect(slot.textContent).toBe('')
  })
})
