'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { OPERATOR_SETTINGS, type OperatorSettingKey } from '@wivwav/types/operator-settings'
import { SettingRef } from './SettingRef'
import { useSettings, type SettingEntry } from './SettingsProvider'
import css from './settings.module.css'

function title(key: string): string { return key.replace(/[._]/g, ' ') }

export function SettingsClient({ selectedKey }: { selectedKey?: OperatorSettingKey }) {
  const { entries, loading, error, reset, apiBaseUrl, mutationRevision } = useSettings()
  const [history, setHistory] = useState<SettingEntry[]>([])
  const [actionError, setActionError] = useState<string | null>(null)
  const keys = selectedKey ? [selectedKey] : Object.keys(OPERATOR_SETTINGS) as OperatorSettingKey[]

  useEffect(() => {
    if (!selectedKey) return
    let active = true
    fetch(`${apiBaseUrl}/admin/config/${encodeURIComponent(selectedKey)}/history`, { cache: 'no-store' })
      .then(async response => response.status === 404 ? { data: [] } : response.ok ? await response.json() as { data: SettingEntry[] } : Promise.reject(new Error(`History failed (${response.status})`)))
      .then(body => { if (active) { setHistory(body.data); setActionError(null) } })
      .catch(err => { if (active) setActionError(err instanceof Error ? err.message : 'History could not load') })
    return () => { active = false }
  }, [apiBaseUrl, selectedKey, mutationRevision])

  return <main className={css.main} id="main-content">
    <nav aria-label="Breadcrumb"><Link href="/ops">Operations</Link>{selectedKey && <> / <Link href="/ops/settings">Settings</Link></>}</nav>
    <h1>{selectedKey ? title(selectedKey) : 'Operator settings'}</h1>
    <p>Changes take effect within about 60 seconds. Values outside the allowed range are clamped when read.</p>
    {loading && <p role="status">Loading settings…</p>}
    {error && <p role="alert">{error}</p>}
    {actionError && <p role="alert">{actionError}</p>}
    {!loading && !error && <div className={css.list}>
      {keys.map(key => {
        const definition = OPERATOR_SETTINGS[key]
        const row = entries.get(key)
        return <section className={css.row} key={key} aria-label={key}>
          <h2><Link href={`/ops/settings/${encodeURIComponent(key)}`}>{key}</Link></h2>
          <p>{definition.description} {key === 'detail_crawl.batch_size' && <>Paired with <SettingRef settingKey="detail_crawl.rate_limit_ms" /> ms pacing.</>}{key === 'detail_crawl.rate_limit_ms' && <>Paired with <SettingRef settingKey="detail_crawl.batch_size" /> pages per run.</>}</p>
          <dl className={css.facts}>
            <div><dt>Group</dt><dd>{key.split('.')[0]?.replace(/_/g, ' ')}</dd></div>
            <div><dt>Current</dt><dd><SettingRef settingKey={key} /></dd></div>
            <div><dt>Default</dt><dd>{definition.defaultValue}</dd></div>
            {definition.type === 'number' && <><div><dt>Minimum</dt><dd>{definition.min}</dd></div>
            <div><dt>Maximum</dt><dd>{definition.max}</dd></div></>}
          </dl>
          <button type="button" aria-label={`Reset ${key} to default`} disabled={!row} onClick={() => void reset(key).then(() => setActionError(null)).catch(err => setActionError(err instanceof Error ? err.message : 'Reset failed'))}>Reset to default</button>
          {selectedKey && <><h3>Where this is used</h3><ul>{definition.relatedPages.map(page => <li key={page}><Link href={page}>{page}</Link></li>)}</ul></>}
        </section>
      })}
    </div>}
    {selectedKey && <section><h2>History</h2>{history.length === 0 ? <p>No saved values yet.</p> : <ol>{history.map(row => <li key={row.id}><time dateTime={row.createdAt}>{new Date(row.createdAt).toLocaleString()}</time>: {row.value === null ? 'Reset to default' : String(row.value)}{row.createdBy && ` by ${row.createdBy}`}</li>)}</ol>}</section>}
  </main>
}
