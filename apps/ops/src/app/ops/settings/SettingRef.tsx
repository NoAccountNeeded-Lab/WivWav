'use client'

import { useState } from 'react'
import Link from 'next/link'
import { CircleDot } from 'lucide-react'
import { OPERATOR_SETTINGS, type OperatorSettingKey, type OperatorSettingValue } from '@wivwav/types/operator-settings'
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
    if (!settings) return
    try {
      let next: number | boolean
      if (definition.type === 'boolean') next = draft === 'true'
      else {
        const number = Number(draft)
        const allowsFraction = 'integer' in definition && definition.integer === false
        if (!Number.isFinite(number) || (!allowsFraction && !Number.isInteger(number)) || number < definition.min || number > definition.max) {
          setSaveError(`Enter a ${allowsFraction ? 'number' : 'integer'} from ${definition.min} to ${definition.max}`)
          return
        }
        next = number
      }
      await settings.save(settingKey, next as OperatorSettingValue<typeof settingKey>)
      setEditing(false)
      setSaveError(null)
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Save failed')
    }
  }

  const marker = !settings ? 'default; settings unavailable' : !row ? 'default' : null
  const changed = row !== undefined && !Object.is(value, definition.defaultValue)
  const unit = 'unit' in definition ? definition.unit : undefined
  return <span className={css.ref}>
    <Link href={href} className={css.chip} aria-label={`${settingKey}: ${value}${unit ? ` ${unit}` : ''}${marker ? ` (${marker})` : ''}. Open setting details`}>{value}{unit && <span className={css.unit}> {unit}</span>}</Link>
    {marker && <span> ({marker})</span>}
    {changed && <span className={css.changed}><CircleDot size={14} aria-hidden="true" /><span>Changed from default</span></span>}
    {settings && <button type="button" className={css.smallButton} aria-label={`Edit ${settingKey}`} aria-expanded={editing} onClick={() => { setDraft(String(value)); setEditing(current => !current); setSaveError(null) }}>Edit</button>}
    {editing && <span className={css.inlineForm}>
      <label>{settingKey}{definition.type === 'boolean' ? <select value={draft} onChange={event => setDraft(event.target.value)}><option value="false">Off</option><option value="true">On</option></select> : <input type="number" min={definition.min} max={definition.max} step={'integer' in definition && definition.integer === false ? 'any' : '1'} value={draft} onChange={event => setDraft(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); void commit() } }} />}</label>
      <button type="button" onClick={() => void commit()}>Save</button>
      <button type="button" onClick={() => setEditing(false)}>Cancel</button>
      {saveError && <span role="alert">{saveError}</span>}
    </span>}
  </span>
}
