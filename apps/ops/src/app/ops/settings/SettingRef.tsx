'use client'

import { useState } from 'react'
import Link from 'next/link'
import { OPERATOR_SETTINGS, type OperatorSettingKey } from '@wivwav/types/operator-settings'
import { useOptionalSettings } from './SettingsProvider'
import { resolveOperatorSetting } from '@wivwav/types/operator-settings'
import css from './settings.module.css'

export function SettingRef({ settingKey }: { settingKey: OperatorSettingKey }) {
  const settings = useOptionalSettings()
  const loading = settings?.loading ?? false
  const error = settings?.error ?? null
  const row = settings?.entries.get(settingKey)
  const value = resolveOperatorSetting(settingKey, row ?? null)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [saveError, setSaveError] = useState<string | null>(null)
  const definition = OPERATOR_SETTINGS[settingKey]
  const href = `/ops/settings/${encodeURIComponent(settingKey)}`

  if (loading) return <span aria-live="polite">Loading setting…</span>
  if (error) return <span role="alert">Setting unavailable</span>

  async function commit() {
    const number = Number(draft)
    if (!Number.isInteger(number) || number < definition.min || number > definition.max) {
      setSaveError(`Enter an integer from ${definition.min} to ${definition.max}`)
      return
    }
    if (!settings) return
    try {
      await settings.save(settingKey, number)
      setEditing(false)
      setSaveError(null)
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Save failed')
    }
  }

  const marker = !settings ? 'default; settings unavailable' : !row ? 'default' : null
  return <span className={css.ref}>
    <Link href={href} className={css.chip} aria-label={`${settingKey}: ${value}${marker ? ` (${marker})` : ''}. Open setting details`}>{value}</Link>
    {marker && <span> ({marker})</span>}
    {settings && <button type="button" className={css.smallButton} aria-label={`Edit ${settingKey}`} aria-expanded={editing} onClick={() => { setDraft(String(value)); setEditing(current => !current); setSaveError(null) }}>Edit</button>}
    {editing && <span className={css.inlineForm}>
      <label>{settingKey}<input type="number" min={definition.min} max={definition.max} step="1" value={draft} onChange={event => setDraft(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); void commit() } }} /></label>
      <button type="button" onClick={() => void commit()}>Save</button>
      <button type="button" onClick={() => setEditing(false)}>Cancel</button>
      {saveError && <span role="alert">{saveError}</span>}
    </span>}
  </span>
}
