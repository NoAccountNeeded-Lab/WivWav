'use client'

import { useEffect, useRef, type ReactNode } from 'react'
import { Group, Panel, Separator } from 'react-resizable-panels'
import { ActionAnnouncer } from '../ActionAnnouncer'
import { useHelm } from '../helm-context'
import { sectionElementId } from '../HelmNav'
import { hasSelection } from '../helm-url'
import shell from '../helm-shell.module.css'
import { INSPECTOR_TITLE_ID, InspectorContent } from './InspectorContent'
import { InspectorDialog } from './InspectorDialog'
import { useFocusReturn } from './use-focus-return'
import { useIsDesktop } from './use-is-desktop'
import styles from './helm-inspector.module.css'

interface InspectorHostProps {
  header: ReactNode
  nav: ReactNode
  main: ReactNode
}

/**
 * Chooses the inspector container from the viewport and renders the
 * inspector content exactly once:
 * - 1280px and wider: a nonmodal, keyboard- and pointer-resizable side
 *   panel next to a still-usable overview (no focus trap).
 * - Narrower: a full-screen modal dialog; everything else becomes `inert`.
 * Focus returns to the opener (or the current section heading) on close.
 */
export function InspectorHost({ header, nav: navigation, main }: InspectorHostProps) {
  const { nav } = useHelm()
  const open = hasSelection(nav.location.selection)
  const desktop = useIsDesktop()
  const asideRef = useRef<HTMLElement | null>(null)

  useFocusReturn(open, sectionElementId(nav.location.section))

  // Desktop has no modal behaviour, so move focus to the inspector once when it opens.
  useEffect(() => {
    if (open && desktop) document.getElementById(INSPECTOR_TITLE_ID)?.focus()
  }, [open, desktop])

  const closeRef = useRef(nav.closeInspector)
  closeRef.current = nav.closeInspector
  useEffect(() => {
    if (!open || !desktop) return undefined
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape' && asideRef.current?.contains(document.activeElement)) closeRef.current()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open, desktop])

  const dialogOpen = open && !desktop

  return (
    <div className={shell.page}>
      <div className={shell.pageBody} inert={dialogOpen}>
        {header}
        {navigation}
        <div className={shell.workspace}>
          {desktop ? (
            <Group id="helm-workspace" orientation="horizontal" className={styles.group} resizeTargetMinimumSize={{ coarse: 48, fine: 16 }}>
              <Panel id="helm-main" minSize="35" className={styles.pane}>{main}</Panel>
              {open && <Separator id="helm-resize" className={styles.separator} aria-label="Resize inspector" />}
              {open && (
                <Panel id="helm-inspector" defaultSize="38" minSize="24" maxSize="65" className={styles.pane}>
                  <aside ref={asideRef} className={styles.aside} aria-labelledby={INSPECTOR_TITLE_ID}>
                    <InspectorContent onClose={nav.closeInspector} />
                  </aside>
                </Panel>
              )}
            </Group>
          ) : main}
        </div>
      </div>
      <ActionAnnouncer />
      {dialogOpen && (
        <InspectorDialog titleId={INSPECTOR_TITLE_ID} onClose={nav.closeInspector}>
          <InspectorContent onClose={nav.closeInspector} />
        </InspectorDialog>
      )}
    </div>
  )
}
