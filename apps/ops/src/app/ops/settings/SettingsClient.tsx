'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { OPERATOR_SETTING_GROUPS, OPERATOR_SETTINGS, type OperatorSettingGroupKey, type OperatorSettingKey } from '@wivwav/types/operator-settings'
import { SettingRef } from './SettingRef'
import { useSettings, type SettingEntry } from './SettingsProvider'
import css from './settings.module.css'

function title(key: string): string { return key.replace(/[._]/g, ' ') }

export function SettingsClient({ selectedKey }: { selectedKey?: OperatorSettingKey }) {
  const { entries, loading, error, reset, apiBaseUrl, mutationRevision } = useSettings()
  const [history, setHistory] = useState<SettingEntry[]>([])
  const [actionError, setActionError] = useState<string | null>(null)
  const keys = Object.keys(OPERATOR_SETTINGS) as OperatorSettingKey[]
  const selectedDefinition = selectedKey ? OPERATOR_SETTINGS[selectedKey] : undefined
  const groups = (Object.keys(OPERATOR_SETTING_GROUPS) as OperatorSettingGroupKey[]).map(groupKey => ({
    key: groupKey,
    ...OPERATOR_SETTING_GROUPS[groupKey],
    keys: keys.filter(key => OPERATOR_SETTINGS[key].group === groupKey),
  })).filter(group => group.keys.length > 0)

  useEffect(() => {
    if (!selectedKey) return
    let active = true
    fetch(`${apiBaseUrl}/admin/config/${encodeURIComponent(selectedKey)}/history`, { cache: 'no-store' })
      .then(async response => response.status === 404 ? { data: [] } : response.ok ? await response.json() as { data: SettingEntry[] } : Promise.reject(new Error(`History failed (${response.status})`)))
      .then(body => { if (active) { setHistory(body.data); setActionError(null) } })
      .catch(err => { if (active) setActionError(err instanceof Error ? err.message : 'History could not load') })
    return () => { active = false }
  }, [apiBaseUrl, selectedKey, mutationRevision])

  function renderSetting(key: OperatorSettingKey) {
    const definition = OPERATOR_SETTINGS[key]
    const row = entries.get(key)
    const unit = 'unit' in definition ? definition.unit : undefined
    return <section className={css.row} key={key} aria-label={key}>
      <h2><Link href={`/ops/settings/${encodeURIComponent(key)}`}>{key}</Link></h2>
      <p>{definition.description}</p>
      <dl className={css.facts}>
        <div><dt>Group</dt><dd>{OPERATOR_SETTING_GROUPS[definition.group].label}</dd></div>
        <div><dt>Current</dt><dd><SettingRef settingKey={key} /></dd></div>
        <div><dt>Default</dt><dd>{definition.defaultValue}{unit && <> {unit}</>}</dd></div>
        {definition.type === 'number' && <>
          <div><dt>Minimum</dt><dd>{definition.min}{unit && <> {unit}</>}</dd></div>
          <div><dt>Maximum</dt><dd>{definition.max}{unit && <> {unit}</>}</dd></div>
        </>}
      </dl>
      <button type="button" aria-label={`Reset ${key} to default`} disabled={!row} onClick={() => void reset(key).then(() => setActionError(null)).catch(err => setActionError(err instanceof Error ? err.message : 'Reset failed'))}>Reset to default</button>
    </section>
  }

  const relatedKeys = selectedKey && selectedDefinition
    ? keys.filter(key => key !== selectedKey && OPERATOR_SETTINGS[key].group === selectedDefinition.group)
    : []
  const selectedGroup = selectedDefinition ? OPERATOR_SETTING_GROUPS[selectedDefinition.group] : undefined

  return <main className={css.main} id="main-content">
    <nav aria-label="Breadcrumb"><Link href="/ops">Operations</Link>{selectedKey && <> / <Link href="/ops/settings">Settings</Link></>}</nav>
    <h1>{selectedKey ? title(selectedKey) : 'Operator settings'}</h1>
    <p>Changes take effect within about 60 seconds. Values outside the allowed range are clamped when read.</p>
    {loading && <p role="status">Loading settings…</p>}
    {error && <p role="alert">{error}</p>}
    {actionError && <p role="alert">{actionError}</p>}
    {!loading && !error && <>
      {selectedKey
        ? renderSetting(selectedKey)
        : <div className={css.groups}>
          {groups.map(group => <details className={css.group} key={group.key}>
            <summary>
              <span className={css.groupHeading}>{group.label}</span>
              <span className={css.groupCount}>{group.keys.length} {group.keys.length === 1 ? 'setting' : 'settings'}</span>
            </summary>
            <p className={css.groupDescription}>{group.description}</p>
            <div className={css.groupSettings}>{group.keys.map(renderSetting)}</div>
          </details>)}
        </div>}
    </>}
    {selectedKey && selectedGroup && <section className={css.related} aria-labelledby="related-settings-heading">
      <h2 id="related-settings-heading">Related settings</h2>
      <p><strong>{selectedGroup.label}.</strong> {selectedGroup.description}</p>
      {relatedKeys.length > 0
        ? <ul>{relatedKeys.map(key => <li key={key}><Link href={`/ops/settings/${encodeURIComponent(key)}`}>{key}</Link><span> — {OPERATOR_SETTINGS[key].description}</span></li>)}</ul>
        : <p>No other settings are in this group.</p>}
    </section>}
    {selectedKey && <section className={css.history} aria-labelledby="settings-history-heading">
      <h2 id="settings-history-heading">History</h2>
      {history.length === 0 ? <p>No saved values yet.</p> : <ol>{history.map(row => <li key={row.id}><time dateTime={row.createdAt}>{new Date(row.createdAt).toLocaleString()}</time>: {row.value === null ? 'Reset to default' : String(row.value)}{row.createdBy && ` by ${row.createdBy}`}</li>)}</ol>}
    </section>}
  </main>
}
