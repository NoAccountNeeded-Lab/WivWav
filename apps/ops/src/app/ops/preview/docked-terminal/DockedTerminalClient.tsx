'use client'

import { useCallback, useEffect, useRef } from 'react'
import type { ChangeEvent } from 'react'
import type { OpsNavItem } from '@/app/ops/ops-nav'
import { useRegisterNavItemInterceptor } from '@/components/OpsNav/nav-item-interceptor'
import { useWorkspaceState, WorkspacePanel, WorkspaceResizableSplit } from '@/components/Workspace'
import type { PanelId, WorkspaceAction, WorkspacePanelHandle, WorkspacePanelState } from '@/components/Workspace'
import { useOverviewResources } from '../../use-overview-resources'
import { LogsPanelContent } from './LogsPanelContent'
import { NAV_PANEL_MAP, SINGLETON_ENTITY_ID } from './panel-nav-map'
import { ProblemsPanelContent } from './ProblemsPanelContent'
import { QueuesPanelContent } from './QueuesPanelContent'
import { ReadinessPanelContent } from './ReadinessPanelContent'
import { SourcePanelContent } from './SourcePanelContent'
import { WORKSPACE_TEMPLATES } from './templates'
import styles from './docked-terminal.module.css'

interface DockedTerminalClientProps {
  apiBaseUrl: string
}

interface PanelContent {
  title: string
  actions?: WorkspaceAction[]
  content: React.ReactNode
}

const DEFAULT_PANELS: Array<{ entityType: string; entityId: string }> = [
  { entityType: 'readiness', entityId: SINGLETON_ENTITY_ID },
  { entityType: 'problems', entityId: SINGLETON_ENTITY_ID },
  { entityType: 'queues', entityId: SINGLETON_ENTITY_ID },
]

/**
 * `/ops/preview/docked-terminal` (#913) — the "docked terminal" candidate
 * Overview treatment: fixed docked panes (readiness on the left; problems,
 * queues, and their entity-relationship-linked source/logs panels stacked on
 * the right) with a draggable divider between them, built on the real
 * `useWorkspaceState`/`WorkspacePanel` contract from #854 rather than
 * `workspace-preview`'s demo fixtures. Compare against #912's dashboard-grid
 * candidate and the current `/ops`; see `page.tsx` for the dev-only gate.
 */
export function DockedTerminalClient({ apiBaseUrl }: DockedTerminalClientProps) {
  const workspace = useWorkspaceState()
  const {
    panels,
    maximizedId,
    minimizedId,
    focusTarget,
    consumeFocusTarget,
    closePanel,
    maximize,
    restore,
    minimize,
    restoreMinimized,
    openPanel,
    replacePanels,
  } = workspace
  const overviewResources = useOverviewResources(apiBaseUrl)
  const panelRefs = useRef(new Map<PanelId, WorkspacePanelHandle | null>())
  // Captured once from the very first render only (`useRef`'s initializer is
  // ignored on later renders) — true only when the URL had no `panels` param
  // at all when this route was first visited.
  const shouldBootstrapDefaults = useRef(panels.length === 0)
  const defaultsBootstrapped = useRef(false)

  // Default to the three "always docked" panels open when the route is
  // visited with no `panels` URL state yet — the docked-terminal candidate
  // is meant to show live data immediately, not require a nav click first.
  // `openPanel` closes over the workspace's *current* `panels` (see
  // `useWorkspaceState`), so opening three panels synchronously in one tick
  // would have each call overwrite the previous one's still-stale closure
  // instead of accumulating. Opening exactly one missing default per render
  // — driven by the `panels` dependency below — converges to all three over
  // a few renders instead. Once every default has been opened at least once,
  // `defaultsBootstrapped` latches so a later, deliberate close of all three
  // by the operator never springs them back open.
  useEffect(() => {
    if (!shouldBootstrapDefaults.current || defaultsBootstrapped.current) return
    const missing = DEFAULT_PANELS.find(
      ({ entityType, entityId }) => !panels.some(p => p.entityType === entityType && p.entityId === entityId),
    )
    if (missing) {
      openPanel(missing.entityType, missing.entityId)
      return
    }
    defaultsBootstrapped.current = true
  }, [panels, openPanel])

  useEffect(() => {
    if (!focusTarget) return
    const handle = panelRefs.current.get(focusTarget)
    if (!handle) return
    handle.focusHeading()
    consumeFocusTarget()
  }, [focusTarget, consumeFocusTarget, panels])

  useEffect(() => {
    if (!maximizedId) return undefined
    function handleKeydown(event: KeyboardEvent) {
      if (event.key === 'Escape') restore()
    }
    document.addEventListener('keydown', handleKeydown)
    return () => document.removeEventListener('keydown', handleKeydown)
  }, [maximizedId, restore])

  const openSourcePanel = useCallback((sourceId: string) => {
    openPanel('source', sourceId)
  }, [openPanel])

  const openLogsForJob = useCallback((jobId: string) => {
    openPanel('logs', jobId)
  }, [openPanel])

  // Selecting a template is a full swap (#915), not an addition — cancel the
  // default-panel bootstrap outright so it can never race a template
  // selection and re-add a default panel the template deliberately left out.
  const handleTemplateChange = useCallback(
    (event: ChangeEvent<HTMLSelectElement>) => {
      const templateId = event.target.value
      event.target.value = ''
      const template = WORKSPACE_TEMPLATES.find(t => t.id === templateId)
      if (!template) return
      shouldBootstrapDefaults.current = false
      defaultsBootstrapped.current = true
      replacePanels(template.panels)
    },
    [replacePanels],
  )

  const renderPanel = useCallback((panel: WorkspacePanelState): PanelContent => {
    switch (panel.entityType) {
      case 'readiness':
        return { title: 'Site readiness', content: <ReadinessPanelContent apiBaseUrl={apiBaseUrl} /> }
      case 'problems':
        return {
          title: 'Problems',
          content: (
            <ProblemsPanelContent apiBaseUrl={apiBaseUrl} overviewResources={overviewResources} onOpenSource={openSourcePanel} />
          ),
        }
      case 'queues':
        return { title: 'Queue diagnostics', content: <QueuesPanelContent apiBaseUrl={apiBaseUrl} onOpenLogsForJob={openLogsForJob} /> }
      case 'source':
        return {
          title: `Source · ${panel.entityId}`,
          content: <SourcePanelContent sourceId={panel.entityId} sources={overviewResources.sources.data} />,
        }
      case 'logs':
        return { title: `Logs · job ${panel.entityId}`, content: <LogsPanelContent apiBaseUrl={apiBaseUrl} jobId={panel.entityId} /> }
      default:
        return { title: panel.id, content: null }
    }
  }, [apiBaseUrl, overviewResources, openSourcePanel, openLogsForJob])

  function renderSlot(panel: WorkspacePanelState) {
    const { title, actions, content } = renderPanel(panel)
    return (
      <div key={panel.id} className={styles.paneSlot}>
        <WorkspacePanel
          ref={handle => {
            panelRefs.current.set(panel.id, handle)
          }}
          title={title}
          actions={actions ?? []}
          isMaximized={false}
          onClose={() => closePanel(panel.id)}
          onMaximize={() => maximize(panel.id)}
          onRestore={restore}
          isMinimized={false}
          onMinimize={() => minimize(panel.id)}
        >
          {content}
        </WorkspacePanel>
      </div>
    )
  }

  const interceptNavItem = useCallback(
    (item: OpsNavItem) => {
      const mapping = NAV_PANEL_MAP[item.href]
      if (!mapping) return false
      openPanel(mapping.entityType, mapping.entityId, { span: mapping.span })
      return true
    },
    [openPanel],
  )
  useRegisterNavItemInterceptor(interceptNavItem)

  const maximizedPanel = maximizedId ? panels.find(p => p.id === maximizedId) : undefined
  const minimizedPanel = minimizedId ? panels.find(p => p.id === minimizedId) : undefined

  const dockable = panels.filter(p => p.id !== minimizedId)
  const leftPanels = dockable.filter(p => p.entityType === 'readiness')
  const rightPanels = dockable.filter(p => p.entityType !== 'readiness')

  return (
    <main id="main-content" className={styles.main}>
      <div className={styles.container}>
        <div>
          <h1 className={styles.heading}>Docked terminal — Overview comparison</h1>
          <p className={styles.intro}>
            Live readiness, problems, and queue diagnostics as real workspace panels — compare against the dashboard-grid
            candidate and the current Operations overview. Dev/operator only; not linked from the nav.
          </p>
        </div>

        <div className={styles.headerControls}>
          <div className={styles.statusStrip}>
            <span className={styles.statusDot} aria-hidden="true" />
            <span>Live — auto-refreshing every 15–30s per panel</span>
          </div>

          <div className={styles.templatesControl}>
            <label htmlFor="docked-terminal-templates">Templates</label>
            <select id="docked-terminal-templates" value="" onChange={handleTemplateChange}>
              <option value="" disabled>Choose a template…</option>
              {WORKSPACE_TEMPLATES.map(template => (
                <option key={template.id} value={template.id}>{template.name}</option>
              ))}
            </select>
          </div>
        </div>

        {maximizedPanel ? (() => {
          const { title, actions, content } = renderPanel(maximizedPanel)
          return (
            <div className={styles.maximizedWrap}>
              <WorkspacePanel
                ref={handle => {
                  panelRefs.current.set(maximizedPanel.id, handle)
                }}
                title={title}
                actions={actions ?? []}
                isMaximized
                onClose={() => closePanel(maximizedPanel.id)}
                onMaximize={() => maximize(maximizedPanel.id)}
                onRestore={restore}
              >
                {content}
              </WorkspacePanel>
            </div>
          )
        })() : (
          <>
            <div className={styles.splitWrap}>
              <WorkspaceResizableSplit
                label="Docked terminal panes"
                defaultFirstSize={35}
                first={(
                  <div className={styles.dock}>
                    {leftPanels.length > 0
                      ? leftPanels.map(renderSlot)
                      : <p className={styles.dockEmpty}>Open Site readiness from the nav to dock it here.</p>}
                  </div>
                )}
                second={(
                  <div className={styles.dockStack}>
                    {rightPanels.length > 0
                      ? rightPanels.map(renderSlot)
                      : <p className={styles.dockEmpty}>Open Problems or Queue diagnostics from the nav to dock them here.</p>}
                  </div>
                )}
              />
            </div>

            {minimizedPanel && (() => {
              const { title, actions, content } = renderPanel(minimizedPanel)
              return (
                <div className={styles.minimizedStrip} aria-label="Minimized panels">
                  <div className={styles.minimizedItem}>
                    <WorkspacePanel
                      ref={handle => {
                        panelRefs.current.set(minimizedPanel.id, handle)
                      }}
                      title={title}
                      actions={actions ?? []}
                      isMaximized={false}
                      onClose={() => closePanel(minimizedPanel.id)}
                      onMaximize={() => maximize(minimizedPanel.id)}
                      onRestore={restore}
                      isMinimized
                      onMinimize={() => restoreMinimized(minimizedPanel.id)}
                    >
                      {content}
                    </WorkspacePanel>
                  </div>
                </div>
              )
            })()}
          </>
        )}
      </div>
    </main>
  )
}
