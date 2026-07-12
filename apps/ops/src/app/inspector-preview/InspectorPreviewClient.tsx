'use client'

import { OpsShell } from '@/components/OpsShell'
import { OpsNav } from '@/components/OpsNav/OpsNav'
import { InspectorPanel } from '@/components/Inspector/InspectorPanel'
import { useInspectorParam } from '@/components/Inspector/useInspectorParam'
import styles from './inspector-preview.module.css'

const DEMO_PARAM = 'inspect'

/**
 * See `page.tsx` for why this route exists. Resize the window across
 * 1280px (--ops-breakpoint-xl) to see the same `?inspect=` state render as a
 * docked panel vs. a full-screen sheet, and reload with the param present
 * in the URL to confirm the state reproduces.
 */
export function InspectorPreviewClient() {
  const inspector = useInspectorParam(DEMO_PARAM)

  return (
    <OpsShell
      sectionTitle="Inspector preview"
      nav={<OpsNav />}
      inspector={
        <InspectorPanel isOpen={inspector.isOpen} title="Demo inspector" onClose={inspector.close}>
          <p className={styles.bodyText}>
            Deep-linked value: <strong>{inspector.value}</strong>
          </p>
          <p className={styles.bodyText}>
            This state comes entirely from the <code>?{DEMO_PARAM}=</code> URL param. Reload this
            page to confirm the same value — and the same open/closed state — reproduces.
          </p>
        </InspectorPanel>
      }
    >
      <main id="main-content" className={styles.main}>
        <div className={styles.container}>
          <h1 className={styles.heading}>Inspector preview</h1>
          <p className={styles.intro}>
            Dev-only harness for #733 — no production route consumes the inspector yet
            (F1/F2 are follow-ups). Resize across 1280px to switch between the docked and sheet
            presentations; both come from the same <code>?{DEMO_PARAM}=</code> URL state.
          </p>
          <button type="button" className={styles.openButton} onClick={() => inspector.open('demo-job-123')}>
            Open inspector
          </button>
          <p className={styles.stateText}>
            Current param value: <code>{inspector.value ?? 'none'}</code>
          </p>
        </div>
      </main>
    </OpsShell>
  )
}
