'use client'

import { OpsShell } from '@/components/OpsShell'
import { OpsNav } from '@/components/OpsNav/OpsNav'
import { useWorkspaceState, WorkspaceGrid, WorkspaceResizableSplit } from '@/components/Workspace'
import type { WorkspacePanelContent } from '@/components/Workspace'
import type { WorkspacePanelState } from '@/components/Workspace/workspace-types'
import styles from './workspace-preview.module.css'

const DEMO_ENTITIES = [
  { entityType: 'run', entityId: '1234', label: 'Run 1234' },
  { entityType: 'source', entityId: 'blvd', label: 'Source blvd' },
  { entityType: 'queue', entityId: 'scrape', label: 'Queue scrape' },
] as const

function renderDemoPanel(panel: WorkspacePanelState): WorkspacePanelContent {
  const title = `${panel.entityType} · ${panel.entityId}`

  if (panel.entityType === 'queue') {
    return {
      title,
      actions: [
        { id: 'retry', label: 'Retry failed jobs', onSelect: () => window.alert('Retry failed jobs') },
        { id: 'pause', label: 'Pause queue', onSelect: () => window.alert('Pause queue') },
        { id: 'drain', label: 'Drain queue', onSelect: () => window.alert('Drain queue') },
      ],
      content: (
        <WorkspaceResizableSplit
          label={`${title} logs and metrics split`}
          first={<p className={styles.paneText}>Logs pane. Drag the divider to resize.</p>}
          second={<p className={styles.paneText}>Metrics pane.</p>}
        />
      ),
    }
  }

  return {
    title,
    actions: [
      { id: 'open-source', label: 'Open source', onSelect: () => window.alert(`Open source for ${panel.id}`) },
      { id: 'open-logs', label: 'Open logs', onSelect: () => window.alert(`Open logs for ${panel.id}`) },
    ],
    content: (
      <div className={styles.demoBody}>
        <p>
          Deep-linked panel <strong>{panel.id}</strong>, span <code>{panel.span}</code>.
        </p>
        <p>Reload this page to confirm the same panel set, order, spans, and maximized state reproduce from the URL.</p>
      </div>
    ),
  }
}

/**
 * See `page.tsx` for why this route exists. Open a few demo panels, resize
 * the "queue" panel's internal split, span a panel to 2 columns, maximize
 * one, then reload — the URL alone reproduces the exact workspace. Resize
 * the window below 1024px to see panels stack to a single column.
 */
export function WorkspacePreviewClient() {
  const workspace = useWorkspaceState()

  return (
    <OpsShell sectionTitle="Workspace preview" nav={<OpsNav />}>
      <main id="main-content" className={styles.main}>
        <div className={styles.container}>
          <h1 className={styles.heading}>Workspace preview</h1>
          <p className={styles.intro}>
            Dev-only harness for #854 — no production route consumes the workspace contract yet (#761 is the planned first
            consumer). Open a few panels below, try spanning, resizing, and maximizing, then reload to confirm the URL alone
            reproduces the workspace.
          </p>

          <div className={styles.openButtons}>
            {DEMO_ENTITIES.map(entity => (
              <button
                key={entity.entityId}
                type="button"
                className={styles.openButton}
                onClick={() => workspace.openPanel(entity.entityType, entity.entityId)}
              >
                Open {entity.label}
              </button>
            ))}
            {workspace.panels.length > 0 && (
              <button
                type="button"
                className={styles.openButton}
                onClick={() => workspace.setSpan(workspace.panels[0]!.id, workspace.panels[0]!.span === 1 ? 2 : 1)}
              >
                Toggle first panel's span
              </button>
            )}
          </div>

          <WorkspaceGrid
            workspace={workspace}
            renderPanel={renderDemoPanel}
            emptyState={<p className={styles.empty}>No panels open — use the buttons above.</p>}
          />
        </div>
      </main>
    </OpsShell>
  )
}
